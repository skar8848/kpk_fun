// Vault & Market Comparator — scoring RISK-ADJUSTED, transparent et auditable.
//
// Risk Score (0 = risqué, 100 = sûr) = moyenne pondérée de sous-scores explicites :
//   utilization 25% · LLTV 15% · oracle 25% · collateral/depeg 20% · concentration 15% (vaults)
// Risk-Adjusted APY = netApy × (riskScore / 100).
// Chaque sous-score expose {raw, score, weight} → tooltip auditable (pas de boîte noire).

import { getVault, discoverVaults, discoverMarkets, fetchCurators, listAllVaults, listVaultsLight } from "./morpho";
import { analyzeOracle } from "./oracleRisk";
import { oracleVendor } from "./explorer";
import { lookup } from "./knowledge";
import { getPegMap, resolvePeg } from "./stablecoins";
import { getEulerVaults, type EulerVault } from "./euler";
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
export type VaultAllocation = { label: string; collateral: string; weightPct: number; supplyUsd: number; netApyPct: number; lltvPct: number; utilPct?: number; oracleVendor: string };
export type CompareRow = {
  kind: "market" | "vault";
  protocol: "Morpho" | "Euler";
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
  allocations?: VaultAllocation[]; // décompo Morpho-like (vaults)
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
    kind: "market", protocol: "Morpho", id: m.marketId, chain,
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
  // curator : l'adresse on-chain curator est parfois 0x0 -> retomber sur owner ;
  // résoudre le nom via le registre Morpho (sur curator OU owner).
  const ZERO = "0x0000000000000000000000000000000000000000";
  const candidates = [v.curatorAddr, v.ownerAddr].filter((a): a is string => !!a && a !== ZERO);
  let curatorAddr: string | undefined; let curatorName: string | undefined;
  for (const a of candidates) { if (curatorMap[a.toLowerCase()]) { curatorAddr = a; curatorName = curatorMap[a.toLowerCase()]; break; } }
  if (!curatorAddr) curatorAddr = candidates[0];
  // util/lltv pondérés pour affichage
  const wUtil = v.allocations.reduce((s, a) => s + (a.market.state?.utilization ?? 0) * (a.supplyUsd / total), 0);
  const wLltv = v.allocations.reduce((s, a) => s + (Number(a.market.lltv ?? 0) / 1e18) * (a.supplyUsd / total), 0);
  // décompo Morpho-like : allocations du vault
  const allocations: VaultAllocation[] = v.allocations.map((a) => {
    const m = a.market;
    return {
      label: `${m.collateralAsset?.symbol ?? "?"} / ${m.loanAsset?.symbol ?? "?"}`,
      collateral: m.collateralAsset?.symbol ?? "?",
      weightPct: round((a.supplyUsd / total) * 100, 1),
      supplyUsd: a.supplyUsd,
      netApyPct: round((m.state?.netSupplyApy ?? m.state?.supplyApy ?? 0) * 100, 2),
      lltvPct: round((Number(m.lltv ?? 0) / 1e18) * 100, 1),
      utilPct: m.state?.utilization != null ? round(m.state.utilization * 100, 1) : undefined,
      oracleVendor: oracleVendor(m.oracle?.type, m.oracle?.address, m.oracle?.data?.__typename),
    };
  }).sort((x, y) => y.supplyUsd - x.supplyUsd);
  return {
    kind: "vault", protocol: "Morpho", id: address, chain, label: v.name ?? "vault",
    netApyPct: round(netApy, 2), tvlUsd: v.tvlUsd,
    utilPct: round(wUtil * 100, 1), lltvPct: round(wLltv * 100, 1),
    concentrationPct: round(maxW * 100, 0),
    curatorAddr, curatorName,
    benchmark: benchmarkOf(v.asset?.symbol ?? "USDC"),
    allocations,
    factors, riskScore, riskAdjApyPct: round((netApy * riskScore) / 100, 2),
    address,
  };
}

// Euler v2 (light) : score = utilization + peg de l'asset (renormalisé). LTV/oracle = phase 2.
export function buildEulerRow(ev: EulerVault, pegMap: Record<string, number>): CompareRow {
  const util = ev.utilPct / 100;
  const price = resolvePeg(ev.assetSymbol, pegMap);
  const factors: ScoreFactor[] = [
    { key: "util", label: "Utilization", raw: `${ev.utilPct}%`, score: round(utilScore(util), 0), weight: 25 },
  ];
  if (price != null) {
    const synth = isSynthetic(ev.assetSymbol);
    factors.push({ key: "peg", label: `Asset peg${synth ? " (synthetic)" : ""}`, raw: `${round((price - 1) * 100, 2)}%`, score: round(pegScore(Math.abs(price - 1), synth), 0), weight: 20 });
  }
  // transparence : LTV/oracle Euler pas encore scorés (phase 2) -> discount honnête
  factors.push({ key: "todo", label: "Collateral / oracle (phase 2)", raw: "not scored", score: 50, weight: 25 });
  const riskScore = combine(factors);
  return {
    kind: "vault", protocol: "Euler", id: ev.address, chain: ev.chain, label: ev.name,
    netApyPct: ev.netApyPct, tvlUsd: ev.tvlUsd, utilPct: ev.utilPct,
    oracleAddr: ev.oracleAddr || undefined, oracleVendor: "?",
    curatorName: ev.curatorName, curatorAddr: ev.governorAddr || undefined,
    benchmark: benchmarkOf(ev.assetSymbol),
    factors, riskScore, riskAdjApyPct: round((ev.netApyPct * riskScore) / 100, 2),
    address: ev.address,
  };
}

// Construit les lignes : par asset (auto-découverte) et/ou listes explicites.
export async function compare(opts: {
  chain: string; asset?: string; assets?: string[]; search?: string;
  vaults?: string[]; markets?: Market[];
}): Promise<CompareRow[]> {
  const [pegMap, curatorMap] = await Promise.all([getPegMap(), getCuratorMap()]);
  const rows: CompareRow[] = [];

  let vaultAddrs = opts.vaults ?? [];
  let markets = opts.markets ?? [];
  // recherche par nom de vault OU nom de curator
  if (opts.search) {
    const q = opts.search.toLowerCase();
    const light = await listVaultsLight(opts.chain);
    const matches = light.filter((v) => {
      if ((v.name ?? "").toLowerCase().includes(q)) return true;
      const cn = [v.curator, v.owner].map((a) => a && curatorMap[a.toLowerCase()]).find(Boolean);
      return !!cn && cn.toLowerCase().includes(q);
    }).slice(0, 25);
    vaultAddrs = [...new Set([...vaultAddrs, ...matches.map((m) => m.address)])];
  }
  const assetList = [...(opts.assets ?? []), ...(opts.asset ? [opts.asset] : [])];
  if (assetList.length) {
    const discovered = await Promise.all(
      assetList.map(async (a) => ({ v: await discoverVaults(opts.chain, a), m: await discoverMarkets(opts.chain, a) })),
    );
    const seenV = new Set(vaultAddrs.map((a) => a.toLowerCase()));
    const seenM = new Set(markets.map((m) => m.marketId));
    for (const d of discovered) {
      for (const a of d.v) if (!seenV.has(a.toLowerCase())) { seenV.add(a.toLowerCase()); vaultAddrs.push(a); }
      for (const m of d.m) if (!seenM.has(m.marketId)) { seenM.add(m.marketId); markets.push(m); }
    }
  }

  const vaultRows = await Promise.all(vaultAddrs.map((a) => buildVaultRow(a, opts.chain, pegMap, curatorMap)));
  for (const r of vaultRows) if (r) rows.push(r);
  for (const m of markets) rows.push(buildMarketRow(m, opts.chain, pegMap));

  // Euler v2 (par asset)
  if (assetList.length) {
    const ev = (await Promise.all(assetList.map((a) => getEulerVaults(opts.chain, a)))).flat();
    const seen = new Set<string>();
    for (const e of ev) if (!seen.has(e.address.toLowerCase())) { seen.add(e.address.toLowerCase()); rows.push(buildEulerRow(e, pegMap)); }
  }

  return finalize(rows);
}

// Tous les vaults Morpho, paginés (par TVL desc).
export async function compareAllVaults(chain: string, skip: number, limit: number): Promise<{ rows: CompareRow[]; total: number }> {
  const [pegMap, curatorMap] = await Promise.all([getPegMap(), getCuratorMap()]);
  const { addresses, total } = await listAllVaults(chain, skip, limit);
  const built = await Promise.all(addresses.map((a) => buildVaultRow(a, chain, pegMap, curatorMap)));
  return { rows: finalize(built.filter((r): r is CompareRow => !!r)), total };
}

function finalize(rows: CompareRow[]): CompareRow[] {
  // APY > 100% sur un marché de prêt = distressed/non-soutenable (depeg, manip, dust),
  // pas une cible d'allocation de trésorerie -> exclu. TVL < $10k = dust -> exclu.
  return rows
    .filter((r) => r.netApyPct <= 100 && r.tvlUsd >= 10_000)
    .sort((a, b) => b.riskAdjApyPct - a.riskAdjApyPct); // tri défaut : risk-adjusted APY desc
}
