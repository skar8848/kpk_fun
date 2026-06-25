// Client Morpho GraphQL (port TS de reference/scanner/morpho.py).
// API publique gratuite, sans clé.

import type { Market, VaultNorm } from "./types";

const ENDPOINT = "https://api.morpho.org/graphql";

export const CHAIN_IDS: Record<string, number> = {
  ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10,
  polygon: 137, unichain: 130, katana: 747474,
};

async function gql<T>(query: string, variables: Record<string, unknown> = {}, retries = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        // pas de cache : on veut l'état live
        cache: "no-store",
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      const body = await res.json();
      if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors.slice(0, 2))}`);
      return body.data as T;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`GraphQL failed after ${retries} tries: ${last}`);
}

const ORACLE_FRAG = `
oracle {
  address type
  data {
    __typename
    ... on MorphoChainlinkOracleV2Data {
      baseFeedOne { address } baseFeedTwo { address }
      quoteFeedOne { address } quoteFeedTwo { address }
      baseOracleVault { address } quoteOracleVault { address }
    }
  }
}`;

const MARKET_FRAG = `
marketId lltv
collateralAsset { symbol address decimals }
loanAsset { symbol address decimals }
warnings { type level }
state { supplyAssetsUsd borrowAssetsUsd collateralAssetsUsd liquidityAssetsUsd utilization supplyApy borrowApy netSupplyApy netBorrowApy }
${ORACLE_FRAG}`;

type VaultResp = {
  vaultByAddress: {
    name: string | null;
    asset: { symbol: string; address: string; decimals: number } | null;
    state: { totalAssetsUsd: string | null; netApy: number | null; curator: string | null; allocation: { supplyAssetsUsd: string | null; market: Market }[] | null } | null;
  } | null;
};

export async function getVaultV1(address: string, chain: string): Promise<VaultNorm> {
  const cid = CHAIN_IDS[chain];
  if (!cid) throw new Error(`chaîne inconnue: ${chain}`);
  const q = `query($a:String!,$c:Int!){
    vaultByAddress(address:$a, chainId:$c){
      name asset{symbol address decimals}
      state{ totalAssetsUsd netApy curator allocation{ supplyAssetsUsd market{ ${MARKET_FRAG} } } }
    }
  }`;
  const data = await gql<VaultResp>(q, { a: address, c: cid });
  const v = data.vaultByAddress;
  if (!v) throw new Error(`vault v1 ${address} introuvable sur ${chain}`);
  const st = v.state ?? { totalAssetsUsd: "0", netApy: null, curator: null, allocation: [] };
  const allocations = (st.allocation ?? [])
    .map((a) => ({ supplyUsd: Number(a.supplyAssetsUsd ?? 0), market: a.market }))
    .filter((a) => a.supplyUsd > 0 && a.market)
    .sort((x, y) => y.supplyUsd - x.supplyUsd);
  return {
    address, chain, name: v.name, version: "v1", asset: v.asset,
    tvlUsd: Number(st.totalAssetsUsd ?? 0),
    apyPct: st.netApy != null ? Math.round(st.netApy * 1e4) / 100 : undefined,
    curatorAddr: st.curator ?? undefined,
    allocations,
  };
}

export async function getMarket(marketId: string, chain: string): Promise<Market> {
  const cid = CHAIN_IDS[chain];
  const q = `query($id:String!,$c:Int!){ marketById(marketId:$id, chainId:$c){ ${MARKET_FRAG} } }`;
  const d = await gql<{ marketById: Market | null }>(q, { id: marketId, c: cid });
  if (!d.marketById) throw new Error(`marché ${marketId} introuvable`);
  return d.marketById;
}

type V2Resp = {
  vaultV2ByAddress: {
    name: string | null;
    asset: { symbol: string; address: string; decimals: number } | null;
    totalAssetsUsd: string | null;
    netApy: number | null;
    curator: { address: string } | null;
    adapters: {
      items: {
        __typename: string;
        positions?: { items: { state: { supplyAssetsUsd: string | null } | null; market: { marketId: string } }[] };
        metaMorpho?: { address: string } | null;
        innerVault?: { address: string } | null;
      }[];
    } | null;
  } | null;
};

// Vault v2 : résout les adapters -> marchés sous-jacents (sans RPC).
// Requête légère (marketId seul) puis fetch des marchés (sinon complexité GraphQL explose).
export async function getVaultV2(address: string, chain: string, depth = 0): Promise<VaultNorm> {
  const cid = CHAIN_IDS[chain];
  if (!cid) throw new Error(`chaîne inconnue: ${chain}`);
  const q = `query($a:String!,$c:Int!){
    vaultV2ByAddress(address:$a, chainId:$c){
      name asset{symbol address decimals} totalAssetsUsd netApy curator{ address }
      adapters{ items {
        __typename
        ... on MorphoMarketV1Adapter { positions { items { state { supplyAssetsUsd } market { marketId } } } }
        ... on MetaMorphoAdapter { metaMorpho { address } }
        ... on MorphoVaultV2Adapter { innerVault { address } }
      } }
    }
  }`;
  const v = (await gql<V2Resp>(q, { a: address, c: cid })).vaultV2ByAddress;
  if (!v) throw new Error(`vault v2 ${address} introuvable sur ${chain}`);

  const allocations: { supplyUsd: number; market: Market }[] = [];
  const needMarkets = new Map<string, number>(); // marketId -> supplyUsd
  for (const ad of v.adapters?.items ?? []) {
    if (ad.__typename === "MorphoMarketV1Adapter") {
      for (const p of ad.positions?.items ?? []) {
        const usd = Number(p.state?.supplyAssetsUsd ?? 0);
        if (usd > 100 && p.market?.marketId) needMarkets.set(p.market.marketId, (needMarkets.get(p.market.marketId) ?? 0) + usd); // ignore la poussière
      }
    } else if (ad.__typename === "MetaMorphoAdapter" && ad.metaMorpho?.address) {
      try { allocations.push(...(await getVaultV1(ad.metaMorpho.address, chain)).allocations); } catch {}
    } else if (ad.__typename === "MorphoVaultV2Adapter" && ad.innerVault?.address && depth < 3) {
      try { allocations.push(...(await getVaultV2(ad.innerVault.address, chain, depth + 1)).allocations); } catch {}
    }
  }
  // fetch des marchés directs (parallèle)
  const fetched = await Promise.all(
    [...needMarkets.entries()].map(async ([id, usd]) => {
      try { return { supplyUsd: usd, market: await getMarket(id, chain) }; } catch { return null; }
    }),
  );
  for (const f of fetched) if (f) allocations.push(f);
  // fusionne les doublons de marché (un même marché via plusieurs adapters)
  const byMkt = new Map<string, { supplyUsd: number; market: Market }>();
  for (const a of allocations) {
    const ex = byMkt.get(a.market.marketId);
    if (ex) ex.supplyUsd += a.supplyUsd; else byMkt.set(a.market.marketId, { ...a });
  }
  const merged = [...byMkt.values()].sort((x, y) => y.supplyUsd - x.supplyUsd);
  return {
    address, chain, name: v.name, version: "v2", asset: v.asset,
    tvlUsd: Number(v.totalAssetsUsd ?? 0),
    apyPct: v.netApy != null ? Math.round(v.netApy * 1e4) / 100 : undefined,
    curatorAddr: v.curator?.address,
    allocations: merged,
  };
}

// Auto-détection : essaie v1 puis v2.
export async function getVault(address: string, chain: string): Promise<VaultNorm> {
  try { return await getVaultV1(address, chain); }
  catch { return await getVaultV2(address, chain); }
}

// Map adresse(lowercase) -> nom de curator (toutes chaînes).
export async function fetchCurators(): Promise<Record<string, string>> {
  const q = `query{ curators(first:500){ items { name addresses { address } } } }`;
  const map: Record<string, string> = {};
  try {
    const d = await gql<{ curators: { items: { name: string; addresses: { address: string }[] }[] } }>(q);
    for (const c of d.curators.items) for (const a of c.addresses ?? []) if (a.address) map[a.address.toLowerCase()] = c.name;
  } catch { /* best-effort */ }
  return map;
}

// Découverte : top vaults v1 pour un asset (par TVL).
export async function discoverVaults(chain: string, symbol: string, limit = 12): Promise<string[]> {
  const cid = CHAIN_IDS[chain];
  if (!cid) return [];
  const q = `query($s:[String!]!,$c:[Int!]!,$n:Int!){ vaults(first:$n, where:{assetSymbol_in:$s, chainId_in:$c}, orderBy:TotalAssetsUsd, orderDirection:Desc){ items { address } } }`;
  try {
    const d = await gql<{ vaults: { items: { address: string }[] } }>(q, { s: [symbol], c: [cid], n: limit });
    return d.vaults.items.map((v) => v.address);
  } catch { return []; }
}

// Découverte : top marchés (full data) dont le loan asset = symbol, par supply.
export async function discoverMarkets(chain: string, symbol: string, limit = 10): Promise<Market[]> {
  const cid = CHAIN_IDS[chain];
  if (!cid) return [];
  const aq = `query($s:[String!]!,$c:[Int!]!){ assets(first:10, where:{symbol_in:$s, chainId_in:$c}){ items { address symbol } } }`;
  const ad = await gql<{ assets: { items: { address: string; symbol: string }[] } }>(aq, { s: [symbol], c: [cid] });
  const addrs = ad.assets.items.filter((a) => a.symbol.toLowerCase() === symbol.toLowerCase()).map((a) => a.address);
  if (!addrs.length) return [];
  const mq = `query($a:[String!]!,$c:[Int!]!,$n:Int!){ markets(first:$n, where:{loanAssetAddress_in:$a, chainId_in:$c}, orderBy:SupplyAssetsUsd, orderDirection:Desc){ items { ${MARKET_FRAG} } } }`;
  const md = await gql<{ markets: { items: Market[] } }>(mq, { a: addrs, c: [cid], n: limit });
  return md.markets.items;
}

export async function getVaultV2Brief(address: string, chain: string): Promise<{ name: string | null; tvlUsd: number }> {
  const cid = CHAIN_IDS[chain];
  if (!cid) throw new Error(`chaîne inconnue: ${chain}`);
  const q = `query($a:String!,$c:Int!){ vaultV2ByAddress(address:$a, chainId:$c){ name totalAssetsUsd } }`;
  const d = await gql<{ vaultV2ByAddress: { name: string | null; totalAssetsUsd: string | null } | null }>(q, { a: address, c: cid });
  const v = d.vaultV2ByAddress;
  return { name: v?.name ?? null, tvlUsd: Number(v?.totalAssetsUsd ?? 0) };
}
