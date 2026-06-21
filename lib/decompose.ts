// Moteur de décomposition d'exposition transitive (le différenciateur).
// Port TS de reference/scanner/decompose.py.

import { lookup, unknownToken } from "./knowledge";
import { analyzeOracle, contagionBuckets } from "./oracleRisk";
import type { VaultNorm, TreeNode, Position, ExposureRow, Loop, ScanReport } from "./types";

export function resolveTree(symbol: string, usd: number, depth = 0, seen: Set<string> = new Set()): TreeNode {
  const info = lookup(symbol) ?? unknownToken();
  const node: TreeNode = {
    symbol, usd, depth,
    protocol: info.protocol, mechanism: info.mechanism,
    yield_source: info.yield_source, risk: info.risk, kind: info.kind,
    unmapped: !!info._unmapped, terminal: false, children: [],
  };
  const underlyings = info.underlying ?? [];
  const s = symbol.toLowerCase();
  if (info.terminal || underlyings.length === 0 || seen.has(s) || depth > 6) {
    node.terminal = true;
    return node;
  }
  const next = new Set(seen);
  next.add(s);
  const share = usd / underlyings.length; // parts égales (faute de poids on-chain)
  for (const u of underlyings) node.children.push(resolveTree(u, share, depth + 1, next));
  return node;
}

function leaves(node: TreeNode, out: Record<string, number>) {
  if (node.terminal || node.children.length === 0) {
    const key = node.symbol.toLowerCase();
    out[key] = (out[key] ?? 0) + node.usd;
    return;
  }
  for (const c of node.children) leaves(c, out);
}

function collectProtocols(node: TreeNode, out: Record<string, number>) {
  const p = node.protocol;
  if (p && p !== "-" && p !== "?") out[p] = (out[p] ?? 0) + node.usd;
  for (const c of node.children) collectProtocols(c, out);
}

function dependsOn(node: TreeNode, symbol: string): boolean {
  if (node.symbol.toLowerCase() === symbol.toLowerCase() && node.depth > 0) return true;
  return node.children.some((c) => dependsOn(c, symbol));
}

function asPct(d: Record<string, number>, tvl: number): ExposureRow[] {
  return Object.entries(d)
    .map(([name, usd]) => ({ name, usd, pct: round(100 * usd / tvl, 2) }))
    .sort((a, b) => b.usd - a.usd);
}

function round(n: number, p = 2): number {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

export function decompose(vault: VaultNorm): ScanReport {
  const tvl = vault.tvlUsd || vault.allocations.reduce((s, a) => s + a.supplyUsd, 0) || 1;
  const positions: Position[] = [];
  const transitive: Record<string, number> = {};
  const protocolExp: Record<string, number> = {};
  const loops: Loop[] = [];

  for (const a of vault.allocations) {
    const m = a.market;
    const usd = a.supplyUsd;
    const col = m.collateralAsset?.symbol ?? "(idle)";
    const loan = m.loanAsset?.symbol ?? "?";
    const label = `${col}/${loan}`;

    const tree = resolveTree(col, usd);
    const lf: Record<string, number> = {};
    leaves(tree, lf);
    for (const [k, v] of Object.entries(lf)) transitive[k] = (transitive[k] ?? 0) + v;
    collectProtocols(tree, protocolExp);

    const orc = analyzeOracle(m);

    if (dependsOn(tree, loan)) {
      const lltv = Number(m.lltv ?? 0) / 1e18;
      const maxLev = lltv > 0 && lltv < 1 ? round(1 / (1 - lltv), 2) : null;
      loops.push({ market: label, lltv_pct: round(lltv * 100, 1), max_leverage_x: maxLev });
    }

    positions.push({
      label, usd, pct: round(100 * usd / tvl, 2),
      lltv_pct: round(Number(m.lltv ?? 0) / 1e16, 1),
      tree, oracle: orc, unmapped_collateral: tree.unmapped,
    });
  }

  return {
    vault: { address: vault.address, chain: vault.chain, name: vault.name, version: vault.version },
    tvlUsd: tvl,
    positions,
    transitive_exposure: asPct(transitive, tvl),
    protocol_exposure: asPct(protocolExp, tvl),
    loops,
    oracle_contagion: contagionBuckets(positions),
    unmapped: [...new Set(positions.filter((p) => p.unmapped_collateral).map((p) => p.label))].sort(),
  };
}
