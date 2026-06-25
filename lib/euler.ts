// Euler v2 (EVK) — version "light" : subgraph Goldsky (sans clé) + DefiLlama (TVL/rewards).
// Un vault Euler = un asset prêtable (ERC-4626). util = totalBorrows/(totalBorrows+cash).
// supplyApy subgraph = base (RAY 1e27) ; net (rewards inclus) via DefiLlama.
// LTV/oracle on-chain = phase 2 (full).

import { cached } from "./cache";

const SUBGRAPH: Record<string, string> = {
  ethereum: "mainnet", base: "base", arbitrum: "arbitrum", optimism: "optimism", unichain: "unichain",
};
const DL_CHAIN: Record<string, string> = {
  ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", optimism: "Optimism", unichain: "Unichain",
};
const subUrl = (net: string) =>
  `https://api.goldsky.com/api/public/project_cm4iagnemt1wp01xn4gh1agft/subgraphs/euler-v2-${net}/latest/gn`;

// governor KPK sur Euler (karpatkey) -> curator
const KPK_EULER_GOV = "0x060db084bf41872861f175d83f3cb1b5566dfea3";

export type EulerVault = {
  address: string; chain: string; name: string; symbol: string; assetSymbol: string;
  netApyPct: number; tvlUsd: number; utilPct: number; oracleAddr: string; governorAddr: string;
  curatorName?: string;
};

async function fetchDefiLlamaEuler(): Promise<Record<string, { tvlUsd: number; apy: number }>> {
  const map: Record<string, { tvlUsd: number; apy: number }> = {};
  try {
    const res = await fetch("https://yields.llama.fi/pools", { cache: "no-store" });
    const body = await res.json();
    for (const p of body.data ?? []) {
      if (p.project !== "euler-v2") continue;
      const sym = String(p.poolMeta ?? "").replace("EVK Vault ", "").trim();
      if (!sym) continue;
      map[`${p.chain}:${sym}`] = { tvlUsd: Number(p.tvlUsd ?? 0), apy: Number(p.apy ?? p.apyBase ?? 0) };
    }
  } catch { /* best-effort */ }
  return map;
}
const dlEuler = async () => (await cached("dl-euler", 10 * 60 * 1000, fetchDefiLlamaEuler)).data;

function parseAsset(symbol: string): string {
  const m = symbol.match(/^e(.+)-\d+$/);
  return m ? m[1] : symbol;
}

type SubVault = {
  id: string; name: string | null; symbol: string; asset: string; oracle: string | null;
  governonAdmin: string | null; state: { totalBorrows: string; cash: string; supplyApy: string } | null;
};

export async function getEulerVaults(chain: string, assetFilter = ""): Promise<EulerVault[]> {
  const net = SUBGRAPH[chain];
  if (!net) return [];
  const q = `query($f:String){ eulerVaults(first:60, where:{symbol_contains:$f}){ id name symbol asset oracle governonAdmin state{ totalBorrows cash supplyApy } } }`;
  let items: SubVault[] = [];
  try {
    const res = await fetch(subUrl(net), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, variables: { f: assetFilter } }), cache: "no-store",
    });
    const body = await res.json();
    items = body.data?.eulerVaults ?? [];
  } catch { return []; }

  const dl = await dlEuler();
  const out: EulerVault[] = [];
  for (const v of items) {
    const st = v.state;
    if (!st) continue;
    const tb = Number(st.totalBorrows), cash = Number(st.cash);
    const util = tb + cash > 0 ? (tb / (tb + cash)) * 100 : 0;
    const baseApy = Number(st.supplyApy) / 1e27 * 100;
    const d = dl[`${DL_CHAIN[chain]}:${v.symbol}`];
    const tvlUsd = d?.tvlUsd ?? 0;
    if (tvlUsd < 10_000) continue; // dust / pas de prix
    const gov = (v.governonAdmin ?? "").toLowerCase();
    out.push({
      address: v.id, chain, name: (v.name || v.symbol).replace("EVK Vault ", ""), symbol: v.symbol, assetSymbol: parseAsset(v.symbol),
      netApyPct: Math.round((d?.apy ?? baseApy) * 100) / 100,
      tvlUsd, utilPct: Math.round(util * 10) / 10,
      oracleAddr: v.oracle ?? "", governorAddr: v.governonAdmin ?? "",
      curatorName: gov === KPK_EULER_GOV ? "KPK" : undefined,
    });
  }
  return out;
}
