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
state { supplyAssetsUsd borrowAssetsUsd collateralAssetsUsd liquidityAssetsUsd utilization supplyApy borrowApy }
${ORACLE_FRAG}`;

type VaultResp = {
  vaultByAddress: {
    name: string | null;
    asset: { symbol: string; address: string; decimals: number } | null;
    state: { totalAssetsUsd: string | null; allocation: { supplyAssetsUsd: string | null; market: Market }[] | null } | null;
  } | null;
};

export async function getVaultV1(address: string, chain: string): Promise<VaultNorm> {
  const cid = CHAIN_IDS[chain];
  if (!cid) throw new Error(`chaîne inconnue: ${chain}`);
  const q = `query($a:String!,$c:Int!){
    vaultByAddress(address:$a, chainId:$c){
      name asset{symbol address decimals}
      state{ totalAssetsUsd allocation{ supplyAssetsUsd market{ ${MARKET_FRAG} } } }
    }
  }`;
  const data = await gql<VaultResp>(q, { a: address, c: cid });
  const v = data.vaultByAddress;
  if (!v) throw new Error(`vault v1 ${address} introuvable sur ${chain}`);
  const st = v.state ?? { totalAssetsUsd: "0", allocation: [] };
  const allocations = (st.allocation ?? [])
    .map((a) => ({ supplyUsd: Number(a.supplyAssetsUsd ?? 0), market: a.market }))
    .filter((a) => a.supplyUsd > 0 && a.market)
    .sort((x, y) => y.supplyUsd - x.supplyUsd);
  return {
    address, chain, name: v.name, version: "v1", asset: v.asset,
    tvlUsd: Number(st.totalAssetsUsd ?? 0),
    allocations,
  };
}

export async function getVaultV2Brief(address: string, chain: string): Promise<{ name: string | null; tvlUsd: number }> {
  const cid = CHAIN_IDS[chain];
  if (!cid) throw new Error(`chaîne inconnue: ${chain}`);
  const q = `query($a:String!,$c:Int!){ vaultV2ByAddress(address:$a, chainId:$c){ name totalAssetsUsd } }`;
  const d = await gql<{ vaultV2ByAddress: { name: string | null; totalAssetsUsd: string | null } | null }>(q, { a: address, c: cid });
  const v = d.vaultV2ByAddress;
  return { name: v?.name ?? null, tvlUsd: Number(v?.totalAssetsUsd ?? 0) };
}
