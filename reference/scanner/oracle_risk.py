"""Analyse de fiabilité des oracles Morpho (la leçon Resolv).

Le vrai péché du hack Resolv : un oracle qui valorisait le collatéral à un peg
hardcodé / une NAV contrôlée par l'émetteur, alors que le prix marché s'effondrait.
On détecte programmatiquement ces patterns depuis `oracle.data` + `warnings`.
"""
from __future__ import annotations

ZERO = "0x0000000000000000000000000000000000000000"

# Hardcoder le peg d'un stable majeur (USDC=$1) est standard sur Morpho et peu
# risqué. Le danger Resolv venait du hardcode/NAV sur un collatéral exotique.
MAJOR_STABLES = {"usdc", "usdt", "dai", "usds", "frax", "ausd"}


def _addr(feed: dict | None) -> str | None:
    if not feed:
        return None
    a = feed.get("address")
    return None if (a is None or a == ZERO) else a


def analyze_oracle(market: dict) -> dict:
    """Renvoie les flags de risque oracle d'un marché."""
    o = market.get("oracle") or {}
    data = o.get("data") or {}
    flags: list[str] = []
    otype = o.get("type")

    # 1. oracle opaque / non reconnu
    if otype in (None, "Unknown", "CustomOracle") or data.get("__typename") is None:
        flags.append("opaque_oracle")

    # 2. peg hardcodé : une jambe de feed à 0x0 => prix de cette jambe = 1.
    #    Côté quote (loan) nul avec un stable => "assume <loan> = $1".
    if data.get("__typename") == "MorphoChainlinkOracleV2Data":
        qf1 = _addr(data.get("quoteFeedOne"))
        bf1 = _addr(data.get("baseFeedOne"))
        loan = (market.get("loanAsset") or {}).get("symbol", "?")
        col = (market.get("collateralAsset") or {}).get("symbol", "?")
        if qf1 is None and not _vault(data.get("quoteOracleVault")):
            kind = "peg_assumption" if loan.lower() in MAJOR_STABLES else "hardcoded_peg"
            flags.append(f"{kind}(assume {loan}=$1)")
        if bf1 is None and not _vault(data.get("baseOracleVault")):
            kind = "peg_assumption" if col.lower() in MAJOR_STABLES else "hardcoded_peg"
            flags.append(f"{kind}(assume {col}=$1)")

        # 3. dépendance NAV / exchange-rate (ERC-4626 mis à jour par l'émetteur)
        if _vault(data.get("baseOracleVault")):
            flags.append("nav_dependency(collateral)")
        if _vault(data.get("quoteOracleVault")):
            flags.append("nav_dependency(loan)")

    # 4. warnings émis directement par Morpho (les plus forts)
    for w in (market.get("warnings") or []):
        t = w.get("type")
        lvl = w.get("level")
        if t == "oracle_price_derivation":
            flags.append(f"PRICE_DERIVATION_DIVERGENCE[{lvl}]")
        elif t in ("bad_debt_unrealized", "bad_debt_realized"):
            flags.append(f"{t.upper()}[{lvl}]")
        elif t in ("unrecognized_collateral_asset", "unrecognized_loan_asset"):
            flags.append(t)

    return {
        "oracle_type": otype,
        "oracle_address": o.get("address"),
        "flags": flags,
        "severity": _severity(flags),
    }


def _vault(v: dict | None) -> bool:
    return bool(v and v.get("address") and v["address"] != ZERO)


def _severity(flags: list[str]) -> str:
    blob = " ".join(flags).lower()
    if "price_derivation" in blob or "bad_debt" in blob or "opaque" in blob:
        return "RED"
    if "hardcoded_peg" in blob or "nav_dependency" in blob:
        return "YELLOW"
    return "OK"


def contagion_buckets(positions: list[dict]) -> dict:
    """Regroupe les positions par hypothèse oracle partagée.

    positions: [{label, usd, oracle: <analyze_oracle result>}]
    -> 'si telle hypothèse casse, $X exposés sur N marchés'.
    """
    buckets: dict[str, dict] = {}
    for p in positions:
        for f in p["oracle"]["flags"]:
            key = f.split("[")[0]  # normalise les niveaux
            b = buckets.setdefault(key, {"usd": 0.0, "markets": 0, "examples": []})
            b["usd"] += p["usd"]
            b["markets"] += 1
            if len(b["examples"]) < 4:
                b["examples"].append(p["label"])
    return dict(sorted(buckets.items(), key=lambda kv: -kv[1]["usd"]))
