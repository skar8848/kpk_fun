"""Carte de dépendances des actifs yield-bearing.

Le cœur de l'analyse d'exposition transitive : un collatéral n'est pas une feuille,
c'est un nœud qui dépend d'un underlying et d'une source de yield. On déplie
récursivement jusqu'aux "primitives de risque" (terminaux).

⚠️ Carte CURÉE à la main (extensible). Ce n'est pas exhaustif et c'est le point
faible assumé : à compléter au fil des marchés rencontrés. `unknown_token()`
signale tout ce qui n'est pas mappé pour qu'on ne fasse jamais de faux négatif
silencieux.
"""
from __future__ import annotations

# Chaque entrée: underlying (liste de symboles), protocol, mechanism, yield_source.
# terminal=True => primitive de risque, on arrête la récursion.
DEPS: dict[str, dict] = {
    # --- terminaux: fiat-backed / actifs de base ---
    "usdc":  {"terminal": True, "kind": "fiat_stable", "protocol": "Circle"},
    "usdt":  {"terminal": True, "kind": "fiat_stable", "protocol": "Tether"},
    "dai":   {"terminal": True, "kind": "cdp_stable",  "protocol": "Sky/Maker"},
    "usds":  {"terminal": True, "kind": "cdp_stable",  "protocol": "Sky"},
    "frax":  {"terminal": True, "kind": "hybrid_stable", "protocol": "Frax"},
    "weth":  {"terminal": True, "kind": "eth", "protocol": "-"},
    "eth":   {"terminal": True, "kind": "eth", "protocol": "-"},
    "wbtc":  {"terminal": True, "kind": "btc", "protocol": "-"},
    "btc":   {"terminal": True, "kind": "btc", "protocol": "-"},
    "ausd":  {"terminal": True, "kind": "fiat_stable", "protocol": "Agora"},

    # --- BTC wrappers ---
    "lbtc":  {"underlying": ["btc"], "protocol": "Lombard", "mechanism": "wrapped_btc",
              "yield_source": "babylon_staking", "risk": "bridge + babylon"},
    "tbtc":  {"underlying": ["btc"], "protocol": "Threshold", "mechanism": "wrapped_btc"},
    "cbbtc": {"underlying": ["btc"], "protocol": "Coinbase", "mechanism": "wrapped_btc"},

    # --- Ethena ---
    "usde":  {"underlying": ["usdt"], "protocol": "Ethena",
              "mechanism": "delta_neutral_perp", "yield_source": "perp_funding + staking",
              "kind": "synthetic_dollar", "risk": "funding_negative + custody(CEX)"},
    "susde": {"underlying": ["usde"], "protocol": "Ethena",
              "mechanism": "staked_wrapper", "yield_source": "usde_yield"},

    # --- Sky / Maker ---
    "sdai":  {"underlying": ["dai"], "protocol": "Sky", "mechanism": "staked_wrapper",
              "yield_source": "DSR"},
    "susds": {"underlying": ["usds"], "protocol": "Sky", "mechanism": "staked_wrapper",
              "yield_source": "SSR"},

    # --- LST/LRT ETH ---
    "steth":  {"underlying": ["eth"], "protocol": "Lido", "mechanism": "lst",
               "yield_source": "eth_staking"},
    "wsteth": {"underlying": ["steth"], "protocol": "Lido", "mechanism": "wrapped_lst",
               "yield_source": "eth_staking"},
    "weeth":  {"underlying": ["eth"], "protocol": "EtherFi", "mechanism": "lrt",
               "yield_source": "eth_staking + restaking", "risk": "eigenlayer_avs"},
    "ezeth":  {"underlying": ["eth"], "protocol": "Renzo", "mechanism": "lrt",
               "yield_source": "eth_staking + restaking", "risk": "eigenlayer_avs"},
    "reth":   {"underlying": ["eth"], "protocol": "RocketPool", "mechanism": "lst",
               "yield_source": "eth_staking"},
    "cbeth":  {"underlying": ["eth"], "protocol": "Coinbase", "mechanism": "lst",
               "yield_source": "eth_staking"},

    # --- Resolv (le cas de notre case study) ---
    "usr":    {"underlying": ["usdc", "eth"], "protocol": "Resolv",
               "mechanism": "delta_neutral_perp", "yield_source": "perp_funding",
               "kind": "synthetic_dollar",
               "risk": "issuance_key(SERVICE_ROLE) + RLP_insurance_depth"},
    "wstusr": {"underlying": ["usr"], "protocol": "Resolv", "mechanism": "staked_wrapper",
               "yield_source": "usr_yield"},
    "rlp":    {"underlying": ["usr"], "protocol": "Resolv", "mechanism": "insurance_tranche",
               "yield_source": "residual_funding", "risk": "first_loss_tranche"},

    # --- divers stables yield-bearing fréquents en collatéral Morpho ---
    "stcusd": {"underlying": ["usdc"], "protocol": "?", "mechanism": "staked_wrapper"},
    "jrusde": {"underlying": ["usde"], "protocol": "?", "mechanism": "tranche"},
    "srnusd": {"underlying": ["usde"], "protocol": "?", "mechanism": "tranche"},
}

# Préfixes spéciaux gérés dynamiquement (Pendle Principal Tokens).
def _pendle_pt(symbol: str) -> dict | None:
    """PT-xxx-DATE : zéro-coupon Pendle. L'underlying est le token wrappé (xxx)."""
    s = symbol.lower()
    if not s.startswith("pt-"):
        return None
    core = s[3:]
    # retire un éventuel suffixe -date (ex: pt-susde-2apr2026)
    parts = core.rsplit("-", 1)
    underlying = parts[0] if len(parts) == 2 else core
    return {
        "underlying": [underlying], "protocol": "Pendle",
        "mechanism": "pt_zero_coupon", "yield_source": "fixed_discount",
        "risk": "pre_maturity_price_sensitivity",
    }


def lookup(symbol: str) -> dict | None:
    if not symbol:
        return None
    s = symbol.lower().strip()
    if s in DEPS:
        return DEPS[s]
    pt = _pendle_pt(s)
    if pt:
        return pt
    return None


def unknown_token(symbol: str) -> dict:
    """Nœud non mappé : traité comme terminal mais explicitement flaggé."""
    return {"terminal": True, "kind": "UNMAPPED", "protocol": "?",
            "risk": "unknown_dependency", "_unmapped": True}
