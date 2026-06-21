"""Rendu terminal du rapport de contagion.

Usage:
  python -m scanner <vault_address> [chain]
  python -m scanner --market <marketId> [chain]
"""
from __future__ import annotations
import sys

from . import morpho, decompose


def _fmt(n: float) -> str:
    return f"${n:,.0f}"


def _node_label(node: dict) -> str:
    tag = []
    if node.get("protocol") and node["protocol"] not in ("-", "?", None):
        tag.append(node["protocol"])
    if node.get("mechanism"):
        tag.append(node["mechanism"])
    if node.get("risk"):
        tag.append(f"⚠{node['risk']}")
    if node.get("unmapped"):
        tag.append("❓UNMAPPED")
    suffix = f"  [{' · '.join(tag)}]" if tag else ""
    return f"{node['symbol']} {_fmt(node['usd'])}{suffix}"


def _tree_lines(node: dict, prefix: str = "", is_last: bool = True,
                is_root: bool = True) -> list[str]:
    branch = "" if is_root else ("└─ " if is_last else "├─ ")
    lines = [prefix + branch + _node_label(node)]
    child_prefix = prefix + ("" if is_root else ("   " if is_last else "│  "))
    kids = node.get("children") or []
    for i, c in enumerate(kids):
        lines += _tree_lines(c, child_prefix, i == len(kids) - 1, False)
    return lines


def render(report: dict) -> str:
    v = report["vault"]
    out = []
    out.append("=" * 72)
    out.append(f"CONTAGION SCAN — {v['name']} ({v['version']}) [{v['chain']}]")
    out.append(f"{v['address']}  ·  TVL {_fmt(report['tvlUsd'])}")
    out.append("=" * 72)

    out.append("\n▼ EXPOSITION TRANSITIVE (primitives de risque, récursion dépliée)")
    for r in report["transitive_exposure"][:12]:
        bar = "█" * int(r["pct"] / 2)
        out.append(f"  {r['name']:<14} {r['pct']:>6.1f}%  {_fmt(r['usd']):>14}  {bar}")

    out.append("\n▼ EXPOSITION PAR PROTOCOLE (tous niveaux de la chaîne)")
    for r in report["protocol_exposure"][:10]:
        out.append(f"  {r['name']:<16} {r['pct']:>6.1f}%  {_fmt(r['usd']):>14}")

    if report["loops"]:
        out.append("\n▼ STRUCTURES DE CARRY / LOOP (collat partage l'underlying du loan)")
        for l in report["loops"]:
            lev = f"{l['max_leverage_x']}x" if l["max_leverage_x"] else "?"
            out.append(f"  {l['market']:<24} LLTV {l['lltv_pct']}%  →  loop borné à ≤ {lev}")

    out.append("\n▼ CONTAGION ORACLE (si l'hypothèse casse → $ exposés)")
    if report["oracle_contagion"]:
        for k, b in report["oracle_contagion"].items():
            out.append(f"  {k:<34} {_fmt(b['usd']):>14}  ({b['markets']} marchés) ex: {', '.join(b['examples'][:3])}")
    else:
        out.append("  (aucun flag oracle)")

    out.append("\n▼ POSITIONS (collatéral → arbre de dépendances)")
    for p in report["positions"][:14]:
        sev = p["oracle"]["severity"]
        mark = {"RED": "🔴", "YELLOW": "🟡", "OK": "🟢"}.get(sev, "·")
        out.append(f"\n {mark} {p['label']:<20} {_fmt(p['usd'])} ({p['pct']}%)  LLTV {p['lltv_pct']}%")
        if p["oracle"]["flags"]:
            out.append(f"      oracle: {', '.join(p['oracle']['flags'])}")
        for line in _tree_lines(p["tree"], "      "):
            out.append(line)

    if report["unmapped"]:
        out.append("\n⚠ COLLATÉRAUX NON MAPPÉS (à ajouter à knowledge.py, pas de faux négatif) :")
        out.append("  " + ", ".join(report["unmapped"]))

    return "\n".join(out)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    chain = argv[1] if len(argv) > 1 else "ethereum"
    vault = morpho.get_vault_v1(argv[0], chain)
    report = decompose.decompose(vault)
    print(render(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
