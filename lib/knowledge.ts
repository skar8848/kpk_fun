// Carte de dépendances des actifs yield-bearing — le cerveau de la récursion.
// Port TS de reference/scanner/knowledge.py. Curé à la main, extensible :
// tout token non mappé est FLAGGÉ (jamais de faux négatif silencieux).

export type DepInfo = {
  terminal?: boolean;
  underlying?: string[];
  protocol?: string;
  mechanism?: string;
  yield_source?: string;
  kind?: string;
  risk?: string;
  _unmapped?: boolean;
};

export const DEPS: Record<string, DepInfo> = {
  // terminaux : fiat-backed / actifs de base
  usdc: { terminal: true, kind: "fiat_stable", protocol: "Circle" },
  usdt: { terminal: true, kind: "fiat_stable", protocol: "Tether" },
  dai: { terminal: true, kind: "cdp_stable", protocol: "Sky/Maker" },
  usds: { terminal: true, kind: "cdp_stable", protocol: "Sky" },
  frax: { terminal: true, kind: "hybrid_stable", protocol: "Frax" },
  weth: { terminal: true, kind: "eth", protocol: "-" },
  eth: { terminal: true, kind: "eth", protocol: "-" },
  wbtc: { terminal: true, kind: "btc", protocol: "-" },
  btc: { terminal: true, kind: "btc", protocol: "-" },
  ausd: { terminal: true, kind: "fiat_stable", protocol: "Agora" },

  // BTC wrappers
  lbtc: { underlying: ["btc"], protocol: "Lombard", mechanism: "wrapped_btc", yield_source: "babylon_staking", risk: "bridge + babylon" },
  tbtc: { underlying: ["btc"], protocol: "Threshold", mechanism: "wrapped_btc" },
  cbbtc: { underlying: ["btc"], protocol: "Coinbase", mechanism: "wrapped_btc" },

  // Ethena
  usde: { underlying: ["usdt"], protocol: "Ethena", mechanism: "delta_neutral_perp", yield_source: "perp_funding + staking", kind: "synthetic_dollar", risk: "funding_negative + custody(CEX)" },
  susde: { underlying: ["usde"], protocol: "Ethena", mechanism: "staked_wrapper", yield_source: "usde_yield" },

  // Sky / Maker
  sdai: { underlying: ["dai"], protocol: "Sky", mechanism: "staked_wrapper", yield_source: "DSR" },
  susds: { underlying: ["usds"], protocol: "Sky", mechanism: "staked_wrapper", yield_source: "SSR" },

  // LST / LRT ETH
  steth: { underlying: ["eth"], protocol: "Lido", mechanism: "lst", yield_source: "eth_staking" },
  wsteth: { underlying: ["steth"], protocol: "Lido", mechanism: "wrapped_lst", yield_source: "eth_staking" },
  weeth: { underlying: ["eth"], protocol: "EtherFi", mechanism: "lrt", yield_source: "eth_staking + restaking", risk: "eigenlayer_avs" },
  ezeth: { underlying: ["eth"], protocol: "Renzo", mechanism: "lrt", yield_source: "eth_staking + restaking", risk: "eigenlayer_avs" },
  reth: { underlying: ["eth"], protocol: "RocketPool", mechanism: "lst", yield_source: "eth_staking" },
  cbeth: { underlying: ["eth"], protocol: "Coinbase", mechanism: "lst", yield_source: "eth_staking" },
  oeth: { underlying: ["eth"], protocol: "Origin", mechanism: "lst", yield_source: "eth_staking" },
  rseth: { underlying: ["eth"], protocol: "Kelp", mechanism: "lrt", yield_source: "eth_staking + restaking", risk: "eigenlayer_avs" },

  // Resolv (notre case study)
  usr: { underlying: ["usdc", "eth"], protocol: "Resolv", mechanism: "delta_neutral_perp", yield_source: "perp_funding", kind: "synthetic_dollar", risk: "issuance_key(SERVICE_ROLE) + RLP_insurance_depth" },
  wstusr: { underlying: ["usr"], protocol: "Resolv", mechanism: "staked_wrapper", yield_source: "usr_yield" },
  rlp: { underlying: ["usr"], protocol: "Resolv", mechanism: "insurance_tranche", yield_source: "residual_funding", risk: "first_loss_tranche" },

  // stables yield-bearing fréquents
  stcusd: { underlying: ["usdc"], protocol: "?", mechanism: "staked_wrapper" },
  jrusde: { underlying: ["usde"], protocol: "?", mechanism: "tranche" },
  srnusd: { underlying: ["usde"], protocol: "?", mechanism: "tranche" },
};

// PT-xxx-DATE : zéro-coupon Pendle → underlying = token wrappé.
function pendlePt(symbol: string): DepInfo | null {
  const s = symbol.toLowerCase();
  if (!s.startsWith("pt-")) return null;
  const core = s.slice(3);
  const idx = core.lastIndexOf("-");
  const underlying = idx > 0 ? core.slice(0, idx) : core;
  return {
    underlying: [underlying],
    protocol: "Pendle",
    mechanism: "pt_zero_coupon",
    yield_source: "fixed_discount",
    risk: "pre_maturity_price_sensitivity",
  };
}

// Adresses de contrat (Ethereum mainnet) des tokens connus -> liens explorer.
export const TOKEN_ADDR: Record<string, string> = {
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  eth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  usdc: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  dai: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  usds: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
  wbtc: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  steth: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  wsteth: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  weeth: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
  ezeth: "0xbf5495Efe5DB9ce00f80364C8B423567e58d2110",
  reth: "0xae78736Cd615f374D3085123A210448E74Fc6393",
  susde: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
  usde: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
  susds: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
  sdai: "0x83F20F44975D03b1b09e64809B757c47f942BEeA",
  rlp: "0x4956b52aE2fF65D74CA2d61207523288e4528f96",
  usr: "0x66a1e37c9b0eaddca17d3662d6c05f4decf3e110",
  wstusr: "0x1202f5c7b4b9e47a1a484e8b270be34dbbc75055",
  cbbtc: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  lbtc: "0x8236a87084f8B84306f72007F36F2618A5634494",
  tbtc: "0x18084fbA666a33d37592fA2633fD49a74DD93a88",
  oeth: "0x856c4Efb76C1D1AE02e20CEB03A2A6a08b0b8dC3",
};

export function tokenAddr(symbol: string): string | undefined {
  return TOKEN_ADDR[symbol.toLowerCase()];
}

export function lookup(symbol: string | null | undefined): DepInfo | null {
  if (!symbol) return null;
  const s = symbol.toLowerCase().trim();
  if (DEPS[s]) return DEPS[s];
  return pendlePt(s);
}

export function unknownToken(): DepInfo {
  return { terminal: true, kind: "UNMAPPED", protocol: "?", risk: "unknown_dependency", _unmapped: true };
}
