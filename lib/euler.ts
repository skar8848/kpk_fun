// Euler v2 (EVK). Liste pilotée par DefiLlama (triée par TVL) + vaults du governor KPK,
// métriques via subgraph Goldsky (sans clé), LTV/TVL on-chain (viem). Phase 2.

import { cached } from "./cache";
import { enrichEuler } from "./eulerOnchain";
import { resolvePeg } from "./stablecoins";

const SUBGRAPH: Record<string, string> = {
  ethereum: "mainnet", base: "base", arbitrum: "arbitrum", optimism: "optimism", unichain: "unichain",
};
const DL_CHAIN: Record<string, string> = {
  ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", optimism: "Optimism", unichain: "Unichain",
};
const subUrl = (net: string) =>
  `https://api.goldsky.com/api/public/project_cm4iagnemt1wp01xn4gh1agft/subgraphs/euler-v2-${net}/latest/gn`;

const KPK_EULER_GOV = "0x060db084bf41872861f175d83f3cb1b5566dfea3";

export type EulerVault = {
  address: string; chain: string; name: string; symbol: string; assetSymbol: string;
  netApyPct: number; tvlUsd: number; utilPct: number; oracleAddr: string; governorAddr: string;
  maxLiqLtvPct: number; curatorName?: string;
};

type DlPool = { chain: string; vaultSymbol: string; assetSymbol: string; tvlUsd: number; apy: number };
async function fetchDlPools(): Promise<DlPool[]> {
  try {
    const res = await fetch("https://yields.llama.fi/pools", { cache: "no-store" });
    const body = await res.json();
    return (body.data ?? []).filter((p: { project?: string }) => p.project === "euler-v2").map((p: { chain: string; symbol?: string; poolMeta?: string; tvlUsd?: number; apy?: number; apyBase?: number }) => ({
      chain: p.chain, vaultSymbol: String(p.poolMeta ?? "").replace("EVK Vault ", "").trim(),
      assetSymbol: String(p.symbol ?? ""), tvlUsd: Number(p.tvlUsd ?? 0), apy: Number(p.apy ?? p.apyBase ?? 0),
    })).filter((p: DlPool) => p.vaultSymbol);
  } catch { return []; }
}
const dlPools = async () => (await cached("dl-euler-pools", 10 * 60 * 1000, fetchDlPools)).data;

function parseAsset(symbol: string): string {
  const m = symbol.match(/^e(.+)-\d+$/);
  return m ? m[1] : symbol;
}

type SubVault = {
  id: string; name: string | null; symbol: string; asset: string; oracle: string | null;
  governonAdmin: string | null; state: { totalBorrows: string; cash: string; supplyApy: string } | null;
};

async function querySubgraph(net: string, where: string, vars: Record<string, unknown>): Promise<SubVault[]> {
  const q = `query($v:[String!],$g:String){ eulerVaults(first:100, where:{${where}}){ id name symbol asset oracle governonAdmin state{ totalBorrows cash supplyApy } } }`;
  try {
    const res = await fetch(subUrl(net), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, variables: vars }), cache: "no-store" });
    return (await res.json()).data?.eulerVaults ?? [];
  } catch { return []; }
}

export async function getEulerVaults(chain: string, assetFilter: string, pegMap: Record<string, number> = {}): Promise<EulerVault[]> {
  const net = SUBGRAPH[chain];
  if (!net) return [];

  // 1. candidats DefiLlama (triés TVL) pour cette chaîne, filtrés par asset si demandé
  let pools = (await dlPools()).filter((p) => p.chain === DL_CHAIN[chain]);
  if (assetFilter) {
    const f = assetFilter.toUpperCase();
    pools = pools.filter((p) => p.assetSymbol.toUpperCase() === f || p.vaultSymbol.toUpperCase().includes(f));
  }
  pools.sort((a, b) => b.tvlUsd - a.tvlUsd);
  pools = pools.slice(0, 40);

  // 2. métriques subgraph : par symbol (DefiLlama) + vaults du governor KPK
  const [bySymbol, byKpk] = await Promise.all([
    pools.length ? querySubgraph(net, "symbol_in:$v", { v: pools.map((p) => p.vaultSymbol) }) : Promise.resolve([]),
    querySubgraph(net, "governonAdmin:$g", { g: KPK_EULER_GOV }),
  ]);
  const items = new Map<string, SubVault>();
  for (const v of [...bySymbol, ...byKpk]) if (v.state) items.set(v.id.toLowerCase(), v);
  const list = [...items.values()];
  if (assetFilter) {
    // restreindre les KPK ajoutés à l'asset demandé
    const f = assetFilter.toUpperCase();
    for (const v of list) if (!v.symbol.toUpperCase().includes(f)) items.delete(v.id.toLowerCase());
  }

  return buildRows(chain, [...items.values()], pegMap);
}

// Vaults Euler du governor KPK uniquement (borné, pour le preset KPK multichain).
export async function getEulerKpk(chain: string, pegMap: Record<string, number> = {}): Promise<EulerVault[]> {
  const net = SUBGRAPH[chain];
  if (!net) return [];
  const items = (await querySubgraph(net, "governonAdmin:$g", { g: KPK_EULER_GOV })).filter((v) => v.state);
  return buildRows(chain, items, pegMap);
}

async function buildRows(chain: string, items: SubVault[], pegMap: Record<string, number>): Promise<EulerVault[]> {
  const dlMap = new Map((await dlPools()).filter((p) => p.chain === DL_CHAIN[chain]).map((p) => [p.vaultSymbol, p] as const));
  const onchain = await enrichEuler(chain, items.map((v) => ({ address: v.id, asset: v.asset })));
  const out: EulerVault[] = [];
  for (const v of items) {
    const st = v.state!;
    const tb = Number(st.totalBorrows), cash = Number(st.cash);
    const util = tb + cash > 0 ? (tb / (tb + cash)) * 100 : 0;
    const baseApy = Number(st.supplyApy) / 1e27 * 100;
    const dl = dlMap.get(v.symbol);
    const oc = onchain.get(v.id.toLowerCase());
    const assetSym = parseAsset(v.symbol);
    const price = resolvePeg(assetSym, pegMap);
    const onchainTvl = oc && price != null ? (Number(oc.totalAssets) / 10 ** oc.decimals) * price : 0;
    const tvlUsd = dl?.tvlUsd ?? onchainTvl;
    if (tvlUsd < 10_000) continue;
    const gov = (v.governonAdmin ?? "").toLowerCase();
    out.push({
      address: v.id, chain, name: (v.name || v.symbol).replace("EVK Vault ", ""), symbol: v.symbol, assetSymbol: assetSym,
      netApyPct: Math.round((dl?.apy ?? baseApy) * 100) / 100,
      tvlUsd, utilPct: Math.round(util * 10) / 10,
      oracleAddr: v.oracle ?? "", governorAddr: v.governonAdmin ?? "",
      maxLiqLtvPct: oc?.maxLiqLtvPct ?? 0,
      curatorName: gov === KPK_EULER_GOV ? "KPK" : undefined,
    });
  }
  return out.sort((a, b) => b.tvlUsd - a.tvlUsd);
}
