// Gearbox (passive pools) — light via DefiLlama yields (sans clé). APY net + TVL.
// util/collateral non scorés (light) -> placeholder honnête dans le score.

import { cached } from "./cache";

const DL_CHAIN: Record<string, string> = {
  ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", optimism: "Optimism",
};

export type GearboxPool = { id: string; chain: string; assetSymbol: string; netApyPct: number; tvlUsd: number };

async function fetchGearbox(): Promise<GearboxPool[]> {
  try {
    const res = await fetch("https://yields.llama.fi/pools", { cache: "no-store" });
    const body = await res.json();
    return (body.data ?? [])
      .filter((p: { project?: string }) => p.project === "gearbox")
      .map((p: { pool: string; chain: string; symbol?: string; tvlUsd?: number; apy?: number; apyBase?: number }) => ({
        id: p.pool, chain: p.chain, assetSymbol: String(p.symbol ?? ""),
        netApyPct: Math.round(Number(p.apy ?? p.apyBase ?? 0) * 100) / 100, tvlUsd: Number(p.tvlUsd ?? 0),
      }));
  } catch { return []; }
}
const gbPools = async () => (await cached("dl-gearbox", 10 * 60 * 1000, fetchGearbox)).data;

export async function getGearbox(chain: string, assetFilter = ""): Promise<GearboxPool[]> {
  let pools = (await gbPools()).filter((p) => p.chain === DL_CHAIN[chain]);
  if (assetFilter) pools = pools.filter((p) => p.assetSymbol.toUpperCase() === assetFilter.toUpperCase());
  return pools.filter((p) => p.tvlUsd >= 10_000).sort((a, b) => b.tvlUsd - a.tvlUsd);
}
