// Vault & Market Comparator — scoring RISK-ADJUSTED, transparent et auditable.
//
// Risk Score (0 = risqué, 100 = sûr) = moyenne pondérée de sous-scores explicites :
//   utilization 25% · LLTV 15% · oracle 25% · collateral/depeg 20% · concentration 15% (vaults)
// Risk-Adjusted APY = netApy × (riskScore / 100).
// Chaque sous-score expose {raw, score, weight} → tooltip auditable (pas de boîte noire).

import { getVault, discoverVaults, discoverMarkets, fetchCurators } from "./morpho";
import { analyzeOracle } from "./oracleRisk";
import { oracleVendor } from "./explorer";
import { lookup } from "./knowledge";
import { getPegMap, resolvePeg } from "./stablecoins";
import { cached } from "./cache";
import type { Market } from "./types";

async function getCuratorMap(): Promise<Record<string, string>> {
  const { data } = await cached("curators", 30 * 60 * 1000, fetchCurators);
  return data;
}

const clamp = (x: number) => Math.max(0, Math.min(100, x));
const round = (x: number, p = 2) => Math.round(x * 10 ** p) / 10 ** p;

// --- sous-scores (exportés pour transparence/test) ---
export const utilScore = (utilFrac: number) => clamp(100 * (1 - Math.max(0, utilFrac - 0.8) / 0.2)); // 80%→100, 90%→50, 100%→0
export const lltvScore = (lltvFrac: number) => clamp((100 * (0.96 - lltvFrac)) / (0.96 - 0.5)); // 50%→100, 96%→0
export const pegScore = (devFrac: number, synthetic: boolean) => {
  const base = clamp(100 * (1 - devFrac / 0.1)); // depeg 10%→0
  return synthetic ? Math.min(base, 80) : base; // dollar synthétique plafonné (risque structurel)
};
export const concentrationScore = (maxWeightFrac: number) => clamp(100 * (1 - Math.max(0, maxWeightFrac - 0.25) / 0.75)); // ≤25%→100, 100%→0
export function oracleScore(flags: string[]): number {
  const b = flags.join(" ").toLowerCase();
  if (b.includes("opaque") || b.includes("price_derivation") || b.includes("bad_debt")) return 0;
  if (b.includes("nav_dependency") || b.includes("hardcoded_peg")) return 30; // le péché Resolv
  if (b.includes("peg_assumption")) return 85; // hardcode d'un stable majeur = mineur
  return 100;
}

function benchmarkOf(sym: string): string {
  const s = sym.toLowerCase();
  if (["weth", "eth", "wsteth", "reth", "cbeth", "steth", "weeth", "ezeth"].includes(s)) return "ETH";
  if (["eurc", "eurcv", "eure", "ageur", "eur"].includes(s)) return "EUR";
  return "USD";
}
// collatéral = dollar synthétique (delta-neutral) ? -> plafonne le pegScore
function isSynthetic(sym: string, depth = 0): boolean {
  const info = lookup(sym);
  if (!info || depth > 4) return false;
  if (info.kind === "synthetic_dollar" || info.mechanism === "delta_neutral_perp") return true;
  return (info.underlying ?? []).some((u) => isSynthetic(u, depth + 1));
}
// collatéral = bluechip volatil (ETH/BTC) -> pas de "peg" à évaluer
function isVolatileBluechip(sym: string, depth = 0): boolean {
  const info = lookup(sym);
  if (!info || depth > 4) return false;
  if (info.kind === "eth" || info.kind === "btc") return true;
  return (info.underlying ?? []).some((u) => isVolatileBluechip(u, depth + 1));
}

export type ScoreFactor = { key: string; label: string; raw: string; score: number; weight: number };
export type CompareRow = {
  kind: "market" | "vault";
  id: string; chain: string; label: string;
  collateral?: { symbol: string; address: string };
  loan?: { symbol: string; address: string };
  netApyPct: number;
  tvlUsd: number;
  utilPct?: number; lltvPct?: number; liquidityUsd?: number;
  oracleAddr?: string; oracleVendor?: string;
  pegDeviationPct?: number; concentrationPct?: number;
  curatorAddr?: string; curatorName?: string;
  benchmark: string;
  factors: ScoreFactor[];
  riskScore: number;
  riskAdjApyPct: number;
  address?: string;
};

// agrège des facteurs pondérés -> score 0-100 (renormalisé sur les poids présents)
function combine(factors: ScoreFactor[]): number {
  const w = factors.reduce((s, f) => s + f.weight, 0) || 1;
  return round(factors.reduce((s, f) => s + f.score * f.weight, 0) / w, 1);
}

// facteurs d'un marché (util, lltv, oracle, peg)
function marketFactors(m: Market, pegMap: Record<string, number>): ScoreFactor[] {
  const util = m.state?.utilization ?? 0;
  const lltv = Number(m.lltv ?? 0) / 1e18;
  const orc = analyzeOracle(m);
  const col = m.collateralAsset?.symbol ?? "?";
  const price = resolvePeg(col, pegMap);
  const factors: ScoreFactor[] = [
    { key: "util", label: "Utilization", raw: `${round(util * 100, 1)}%`, score: round(utilScore(util), 0), weight: 25 },
    { key: "lltv", label: "LLTV margin", raw: `${round(lltv * 100, 1)}%`, score: round(lltvScore(lltv), 0), weight: 15 },
    { key: "oracle", label: `Oracle (${oracleVendor(m.oracle?.type, m.oracle?.address, m.oracle?.data?.__typename)})`, raw: orc.flags.length ? orc.flags.join(", ") : "market price", score: oracleScore(orc.flags), weight: 25 },
  ];
  // collatéral : stable -> déviation réelle ; ETH/BTC -> pas de peg (N/A) ; inconnu -> pénalité
  if (price != null) {
    const synth = isSynthetic(col);
    factors.push({ key: "peg", label: `Collateral peg${synth ? " (synthetic)" : ""}`, raw: `${round((price - 1) * 100, 2)}%`, score: round(pegScore(Math.abs(price - 1), synth), 0), weight: 20 });
  } else if (!isVolatileBluechip(col)) {
    factors.push({ key: "peg", label: "Collateral (unmapped)", raw: "unknown", score: 40, weight: 20 });
  } // sinon (ETH/BTC) : pas de facteur peg, poids renormalisé
  return factors;
}

export function buildMarketRow(m: Market, chain: string, pegMap: Record<string, number>): CompareRow {
  const factors = marketFactors(m, pegMap);
  const riskScore = combine(factors);
  const st = m.state;
  const netApy = (st?.netSupplyApy ?? st?.supplyApy ?? 0) * 100;
  const col = m.collateralAsset, loan = m.loanAsset;
  const price = resolvePeg(col?.symbol ?? "", pegMap);
  return {
    kind: "market", id: m.marketId, chain,
    label: `${col?.symbol ?? "?"} / ${loan?.symbol ?? "?"}`,
    collateral: col ? { symbol: col.symbol ?? "?", address: col.address } : undefined,
    loan: loan ? { symbol: loan.symbol ?? "?", address: loan.address } : undefined,
    netApyPct: round(netApy, 2), tvlUsd: Number(st?.supplyAssetsUsd ?? 0),
    utilPct: st?.utilization != null ? round(st.utilization * 100, 1) : undefined,
    lltvPct: round((Number(m.lltv ?? 0) / 1e18) * 100, 1),
    liquidityUsd: st?.liquidityAssetsUsd != null ? Number(st.liquidityAssetsUsd) : undefined,
    oracleAddr: m.oracle?.address, oracleVendor: oracleVendor(m.oracle?.type, m.oracle?.address, m.oracle?.data?.__typename),
    pegDeviationPct: price == null ? undefined : round((price - 1) * 100, 2),
    benchmark: benchmarkOf(loan?.symbol ?? "USDC"),
    factors, riskScore, riskAdjApyPct: round((netApy * riskScore) / 100, 2),
    address: m.oracle?.address,
  };
}

export async function buildVaultRow(address: string, chain: string, pegMap: Record<string, number>, curatorMap: Record<string, string> = {}): Promise<CompareRow | null> {
  let v;
  try { v = await getVault(address, chain); } catch { return null; }
  const total = v.allocations.reduce((s, a) => s + a.supplyUsd, 0) || 1;
  // moyenne pondérée des facteurs marché, par poids d'allocation (et par présence du facteur)
  const agg: Record<string, { s: number; w: number }> = { util: { s: 0, w: 0 }, lltv: { s: 0, w: 0 }, oracle: { s: 0, w: 0 }, peg: { s: 0, w: 0 } };
  let maxW = 0;
  for (const a of v.allocations) {
    const w = a.supplyUsd / total;
    maxW = Math.max(maxW, w);
    for (const f of marketFactors(a.market, pegMap)) { agg[f.key].s += f.score * w; agg[f.key].w += w; }
  }
  const labels: Record<string, string> = { util: "Utilization (wtd)", lltv: "LLTV margin (wtd)", oracle: "Oracle (wtd)", peg: "Collateral peg (wtd)" };
  const weights: Record<string, number> = { util: 25, lltv: 15, oracle: 25, peg: 20 };
  const factors: ScoreFactor[] = (["util", "lltv", "oracle", "peg"] as const)
    .filter((k) => agg[k].w > 0)
    .map((k) => ({ key: k, label: labels[k], raw: "weighted", score: round(agg[k].s / agg[k].w, 0), weight: weights[k] }));
  factors.push({ key: "conc", label: "Concentration", raw: `max ${round(maxW * 100, 0)}%`, score: round(concentrationScore(maxW), 0), weight: 15 });
  const riskScore = combine(factors);
  const netApy = v.apyPct ?? 0;
  // util/lltv pondérés pour affichage
  const wUtil = v.allocations.reduce((s, a) => s + (a.market.state?.utilization ?? 0) * (a.supplyUsd / total), 0);
  const wLltv = v.allocations.reduce((s, a) => s + (Number(a.market.lltv ?? 0) / 1e18) * (a.supplyUsd / total), 0);
  return {
    kind: "vault", id: address, chain, label: v.name ?? "vault",
    netApyPct: round(netApy, 2), tvlUsd: v.tvlUsd,
    utilPct: round(wUtil * 100, 1), lltvPct: round(wLltv * 100, 1),
    concentrationPct: round(maxW * 100, 0),
    curatorAddr: v.curatorAddr,
    curatorName: v.curatorAddr ? curatorMap[v.curatorAddr.toLowerCase()] : undefined,
    benchmark: benchmarkOf(v.asset?.symbol ?? "USDC"),
    factors, riskScore, riskAdjApyPct: round((netApy * riskScore) / 100, 2),
    address,
  };
}

// Construit les lignes : par asset (auto-découverte) et/ou listes explicites.
export async function compare(opts: {
  chain: string; asset?: string;
  vaults?: string[]; markets?: Market[];
}): Promise<CompareRow[]> {
  const [pegMap, curatorMap] = await Promise.all([getPegMap(), getCuratorMap()]);
  const rows: CompareRow[] = [];

  let vaultAddrs = opts.vaults ?? [];
  let markets = opts.markets ?? [];
  if (opts.asset) {
    const [dv, dm] = await Promise.all([discoverVaults(opts.chain, opts.asset), discoverMarkets(opts.chain, opts.asset)]);
    vaultAddrs = [...new Set([...vaultAddrs, ...dv])];
    markets = [...markets, ...dm];
  }

  const vaultRows = await Promise.all(vaultAddrs.map((a) => buildVaultRow(a, opts.chain, pegMap, curatorMap)));
  for (const r of vaultRows) if (r) rows.push(r);
  for (const m of markets) rows.push(buildMarketRow(m, opts.chain, pegMap));

  // APY > 100% sur un marché de prêt = distressed/non-soutenable (depeg, manip, dust),
  // pas une cible d'allocation de trésorerie -> exclu. TVL < $10k = dust -> exclu.
  return rows
    .filter((r) => r.netApyPct <= 100 && r.tvlUsd >= 10_000)
    .sort((a, b) => b.riskAdjApyPct - a.riskAdjApyPct); // tri défaut : risk-adjusted APY desc
}
