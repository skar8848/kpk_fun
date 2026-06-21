"""Moteur de décomposition d'exposition transitive (le différenciateur).

Vault -> marchés -> collatéral -> (récursion via knowledge) -> primitives de risque.
Agrège l'exposition transitive en $ et en %, détecte les loops, et calcule
le leverage implicite borné par les LLTV.
"""
from __future__ import annotations
from collections import defaultdict

from . import knowledge, oracle_risk


def _resolve_tree(symbol: str, usd: float, depth: int = 0, seen=None) -> dict:
    """Déplie un token en arbre de dépendances pondéré par $."""
    seen = seen or set()
    info = knowledge.lookup(symbol) or knowledge.unknown_token(symbol)
    node = {
        "symbol": symbol, "usd": usd, "depth": depth,
        "protocol": info.get("protocol"), "mechanism": info.get("mechanism"),
        "yield_source": info.get("yield_source"), "risk": info.get("risk"),
        "kind": info.get("kind"), "unmapped": info.get("_unmapped", False),
        "terminal": False, "children": [],
    }
    underlyings = info.get("underlying") or []
    s = symbol.lower()
    if info.get("terminal") or not underlyings or s in seen or depth > 6:
        node["terminal"] = True
        return node
    seen = seen | {s}
    # répartition naïve à parts égales entre underlyings (faute de poids on-chain)
    share = usd / len(underlyings)
    for u in underlyings:
        node["children"].append(_resolve_tree(u, share, depth + 1, seen))
    return node


def _leaves(node: dict, out: dict):
    if node["terminal"] or not node["children"]:
        key = node["symbol"].lower()  # normalise la casse (reUSD == reusd)
        out[key] = out.get(key, 0.0) + node["usd"]
        return
    for c in node["children"]:
        _leaves(c, out)


def decompose(vault: dict) -> dict:
    """Analyse complète d'un vault normalisé (cf. morpho.get_vault_v1)."""
    tvl = vault["tvlUsd"] or sum(a["supplyUsd"] for a in vault["allocations"])
    positions = []
    transitive = defaultdict(float)        # primitive de risque -> $
    protocol_exposure = defaultdict(float)  # protocole -> $ (tout niveau)
    loops = []

    for a in vault["allocations"]:
        m = a["market"]
        usd = a["supplyUsd"]
        col = (m.get("collateralAsset") or {}).get("symbol") or "(idle)"
        loan = (m.get("loanAsset") or {}).get("symbol") or "?"
        label = f"{col}/{loan}"

        tree = _resolve_tree(col, usd)
        leaves = {}
        _leaves(tree, leaves)
        for sym, v in leaves.items():
            transitive[sym] += v
        _collect_protocols(tree, protocol_exposure)

        orc = oracle_risk.analyze_oracle(m)

        # loop / leverage : collatéral d'un marché qui se déplie vers le loan token
        if _depends_on(tree, loan):
            lltv = int(m.get("lltv") or 0) / 1e18
            max_lev = round(1 / (1 - lltv), 2) if 0 < lltv < 1 else None
            loops.append({"market": label, "lltv_pct": round(lltv * 100, 1),
                          "max_leverage_x": max_lev})

        positions.append({
            "label": label, "usd": usd, "pct": round(100 * usd / tvl, 2),
            "lltv_pct": round(int(m.get("lltv") or 0) / 1e16, 1),
            "tree": tree, "oracle": orc,
            "unmapped_collateral": tree.get("unmapped", False),
        })

    return {
        "vault": {k: vault[k] for k in ("address", "chain", "name", "version")},
        "tvlUsd": tvl,
        "positions": positions,
        "transitive_exposure": _as_pct(transitive, tvl),
        "protocol_exposure": _as_pct(protocol_exposure, tvl),
        "loops": loops,
        "oracle_contagion": oracle_risk.contagion_buckets(positions),
        "unmapped": sorted({p["label"] for p in positions if p["unmapped_collateral"]}),
    }


def _collect_protocols(node: dict, out: dict):
    p = node.get("protocol")
    if p and p not in (None, "-", "?"):
        out[p] += node["usd"]
    for c in node["children"]:
        _collect_protocols(c, out)


def _depends_on(node: dict, symbol: str) -> bool:
    if node["symbol"].lower() == symbol.lower() and node["depth"] > 0:
        return True
    return any(_depends_on(c, symbol) for c in node["children"])


def _as_pct(d: dict, tvl: float) -> list[dict]:
    rows = [{"name": k, "usd": v, "pct": round(100 * v / tvl, 2)} for k, v in d.items()]
    return sorted(rows, key=lambda r: -r["usd"])
