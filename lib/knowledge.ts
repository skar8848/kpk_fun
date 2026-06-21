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

export function lookup(symbol: string | null | undefined): DepInfo | null {
  if (!symbol) return null;
  const s = symbol.toLowerCase().trim();
  if (DEPS[s]) return DEPS[s];
  return pendlePt(s);
}

export function unknownToken(): DepInfo {
  return { terminal: true, kind: "UNMAPPED", protocol: "?", risk: "unknown_dependency", _unmapped: true };
}
