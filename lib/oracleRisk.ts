// Analyse de fiabilité des oracles Morpho (la leçon Resolv).
// Port TS de reference/scanner/oracle_risk.py.

import type { Market, OracleVaultRef, OracleFeed, OracleAnalysis, Position, ContagionBucket } from "./types";

const ZERO = "0x0000000000000000000000000000000000000000";
// Hardcoder le peg d'un stable majeur (USDC=$1) est standard et peu risqué.
const MAJOR_STABLES = new Set(["usdc", "usdt", "dai", "usds", "frax", "ausd"]);

function feedAddr(feed: OracleFeed): string | null {
  if (!feed || !feed.address || feed.address === ZERO) return null;
  return feed.address;
}
function hasVault(v: OracleVaultRef): boolean {
  return !!(v && v.address && v.address !== ZERO);
}

export function analyzeOracle(market: Market): OracleAnalysis {
  const o = market.oracle ?? null;
  const data = o?.data ?? null;
  const flags: string[] = [];
  const otype = o?.type ?? null;

  // Opaque UNIQUEMENT si aucune donnée d'oracle exploitable. NB: l'API renvoie
  // souvent type="Unknown" alors que oracle.data est un MorphoChainlinkOracleV2Data
  // valide (feeds Chainlink présents) -> ne PAS le flagger opaque dans ce cas.
  if (!data?.__typename) {
    flags.push("opaque_oracle");
  }

  if (data?.__typename === "MorphoChainlinkOracleV2Data") {
    const loan = market.loanAsset?.symbol ?? "?";
    const col = market.collateralAsset?.symbol ?? "?";
    if (feedAddr(data.quoteFeedOne ?? null) === null && !hasVault(data.quoteOracleVault ?? null)) {
      const kind = MAJOR_STABLES.has(loan.toLowerCase()) ? "peg_assumption" : "hardcoded_peg";
      flags.push(`${kind}(assume ${loan}=$1)`);
    }
    if (feedAddr(data.baseFeedOne ?? null) === null && !hasVault(data.baseOracleVault ?? null)) {
      const kind = MAJOR_STABLES.has(col.toLowerCase()) ? "peg_assumption" : "hardcoded_peg";
      flags.push(`${kind}(assume ${col}=$1)`);
    }
    if (hasVault(data.baseOracleVault ?? null)) flags.push("nav_dependency(collateral)");
    if (hasVault(data.quoteOracleVault ?? null)) flags.push("nav_dependency(loan)");
  }

  for (const w of market.warnings ?? []) {
    if (w.type === "oracle_price_derivation") flags.push(`PRICE_DERIVATION_DIVERGENCE[${w.level}]`);
    else if (w.type === "bad_debt_unrealized" || w.type === "bad_debt_realized") flags.push(`${w.type.toUpperCase()}[${w.level}]`);
    else if (w.type === "unrecognized_collateral_asset" || w.type === "unrecognized_loan_asset") flags.push(w.type);
  }

  return { oracle_type: otype, oracle_address: o?.address ?? null, flags, severity: severity(flags) };
}

function severity(flags: string[]): "RED" | "YELLOW" | "OK" {
  const blob = flags.join(" ").toLowerCase();
  if (blob.includes("price_derivation") || blob.includes("bad_debt") || blob.includes("opaque")) return "RED";
  if (blob.includes("hardcoded_peg") || blob.includes("nav_dependency")) return "YELLOW";
  return "OK";
}

export function contagionBuckets(positions: Position[]): Record<string, ContagionBucket> {
  const buckets: Record<string, ContagionBucket> = {};
  for (const p of positions) {
    for (const f of p.oracle.flags) {
      const key = f.split("[")[0];
      const b = (buckets[key] ??= { usd: 0, markets: 0, examples: [] });
      b.usd += p.usd;
      b.markets += 1;
      if (b.examples.length < 4) b.examples.push(p.label);
    }
  }
  return Object.fromEntries(Object.entries(buckets).sort((a, b) => b[1].usd - a[1].usd));
}
