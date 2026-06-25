// Lecture on-chain Euler v2 (phase 2) : TVL + LTV via viem multicall.
// Capte les vaults absents de DefiLlama et donne le vrai facteur LTV.

import { createPublicClient, http, type Address, type Chain } from "viem";
import { mainnet, base, arbitrum } from "viem/chains";

const CHAINS: Record<string, { chain: Chain; rpc: string }> = {
  ethereum: { chain: mainnet, rpc: "https://ethereum-rpc.publicnode.com" },
  base: { chain: base, rpc: "https://base-rpc.publicnode.com" },
  arbitrum: { chain: arbitrum, rpc: "https://arbitrum-one-rpc.publicnode.com" },
};

const EVAULT_ABI = [
  { name: "totalAssets", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "LTVList", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { name: "LTVLiquidation", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint16" }] },
] as const;
const ERC20_ABI = [
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export type EulerOnchain = { totalAssets: bigint; decimals: number; maxLiqLtvPct: number };

export async function enrichEuler(
  chain: string, vaults: { address: string; asset: string }[],
): Promise<Map<string, EulerOnchain>> {
  const out = new Map<string, EulerOnchain>();
  const cfg = CHAINS[chain];
  if (!cfg || !vaults.length) return out;
  const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });

  // round 1 : totalAssets + LTVList (par vault) + decimals (par asset)
  const r1 = await client.multicall({
    allowFailure: true,
    contracts: vaults.flatMap((v) => [
      { address: v.address as Address, abi: EVAULT_ABI, functionName: "totalAssets" },
      { address: v.address as Address, abi: EVAULT_ABI, functionName: "LTVList" },
      { address: v.asset as Address, abi: ERC20_ABI, functionName: "decimals" },
    ]),
  });

  // round 2 : LTVLiquidation(collateral) pour chaque (vault, collateral)
  const ltvCalls: { vault: string; collateral: Address }[] = [];
  const base: Record<string, { totalAssets: bigint; decimals: number; collaterals: Address[] }> = {};
  vaults.forEach((v, i) => {
    const ta = r1[i * 3].result as bigint | undefined;
    const cols = (r1[i * 3 + 1].result as Address[] | undefined) ?? [];
    const dec = r1[i * 3 + 2].result as number | undefined;
    base[v.address] = { totalAssets: ta ?? 0n, decimals: Number(dec ?? 18), collaterals: cols };
    for (const c of cols) ltvCalls.push({ vault: v.address, collateral: c });
  });

  const r2 = ltvCalls.length
    ? await client.multicall({
        allowFailure: true,
        contracts: ltvCalls.map((c) => ({ address: c.vault as Address, abi: EVAULT_ABI, functionName: "LTVLiquidation", args: [c.collateral] })),
      })
    : [];
  const maxLtv: Record<string, number> = {};
  ltvCalls.forEach((c, i) => {
    const v = Number((r2[i]?.result as number | undefined) ?? 0) / 100; // uint16 1e4 -> %
    maxLtv[c.vault] = Math.max(maxLtv[c.vault] ?? 0, v);
  });

  for (const v of vaults) {
    const b = base[v.address];
    out.set(v.address.toLowerCase(), { totalAssets: b.totalAssets, decimals: b.decimals, maxLiqLtvPct: maxLtv[v.address] ?? 0 });
  }
  return out;
}
