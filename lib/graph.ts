// Transforme un ou plusieurs ScanReport en graphe (nœuds/arêtes) pour le canvas.
// Clé du rendu "Morpheus/Herd" : les positions CONVERGENT vers des primitives de
// risque partagées (eth, usde, usdt…) — on dédoublonne ces nœuds globalement.

import type { ScanReport, TreeNode } from "./types";

export type GraphNode = {
  id: string;
  kind: "root" | "group" | "entity" | "market" | "asset";
  label: string;
  usd: number;
  level: number;
  severity?: "RED" | "YELLOW" | "OK";
  protocol?: string;
  mechanism?: string;
  risk?: string;
  unmapped?: boolean;
  chain?: string;
  chains?: string[];
  flags?: string[];
  dao?: string;
  version?: string;
  pending?: boolean; // positions à charger (ex: Safe en attente de Zerion)
  address?: string; // contrat (vault/safe/marketId/token)
  pct?: number; // % du TVL total (root)
  type?: string; // type de position Zerion (deposit/staked/loan…)
  // métriques marché Morpho
  lltvPct?: number;
  utilPct?: number;
  supplyApyPct?: number;
  borrowApyPct?: number;
  liquidityUsd?: number;
};

// % du TVL total (root) sur chaque nœud.
export function computePct(nodes: GraphNode[]) {
  const root = nodes.find((n) => n.kind === "root");
  const total = root?.usd || 1;
  for (const n of nodes) n.pct = Math.round((1000 * n.usd) / total) / 10;
}

export type GraphEdge = { id: string; source: string; target: string };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

export function buildGraph(reports: ScanReport[], rootLabel = "KPK"): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addNode = (n: GraphNode) => {
    const ex = nodes.get(n.id);
    if (ex) {
      ex.usd += n.usd; // les actifs partagés cumulent l'exposition
      if (n.severity === "RED") ex.severity = "RED";
    } else nodes.set(n.id, n);
  };
  const addEdge = (source: string, target: string) => {
    const id = `${source}=>${target}`;
    if (!edges.has(id)) edges.set(id, { id, source, target });
  };

  const ROOT = "root::kpk";
  addNode({ id: ROOT, kind: "root", label: rootLabel, usd: 0, level: 0 });

  for (const r of reports) {
    const entId = `entity::${r.vault.chain}::${r.vault.address.toLowerCase()}`;
    addNode({
      id: entId, kind: "entity", label: r.vault.name ?? "vault",
      usd: r.tvlUsd, level: 1, chain: r.vault.chain, address: r.vault.address,
      version: r.vault.version,
    });
    addEdge(ROOT, entId);
    nodes.get(ROOT)!.usd += r.tvlUsd;

    for (const p of r.positions) {
      if (p.usd <= 0) continue;
      const mId = `market::${entId}::${p.label}`;
      addNode({
        id: mId, kind: "market", label: p.label, usd: p.usd, level: 2,
        severity: p.oracle.severity, flags: p.oracle.flags, chain: r.vault.chain,
        address: p.metrics.marketId, lltvPct: p.metrics.lltvPct, utilPct: p.metrics.utilPct,
        supplyApyPct: p.metrics.supplyApyPct, borrowApyPct: p.metrics.borrowApyPct,
        liquidityUsd: p.metrics.liquidityUsd,
      });
      addEdge(entId, mId);
      walkTree(p.tree, mId, 3, addNode, addEdge);
    }
  }

  const nlist = [...nodes.values()];
  relevel(nlist, [...edges.values()]);
  computePct(nlist);
  return { nodes: nlist, edges: [...edges.values()] };
}

// Les nœuds "asset" sont dédoublonnés par symbole → convergence visuelle.
export function walkTree(
  node: TreeNode, parentId: string, baseLevel: number,
  addNode: (n: GraphNode) => void, addEdge: (s: string, t: string) => void,
) {
  const id = `asset::${node.symbol.toLowerCase()}`;
  addNode({
    id, kind: "asset", label: node.symbol, usd: node.usd, level: baseLevel,
    protocol: node.protocol, mechanism: node.mechanism, risk: node.risk,
    unmapped: node.unmapped,
    severity: node.unmapped ? "RED" : node.risk ? "YELLOW" : "OK",
  });
  addEdge(parentId, id);
  for (const c of node.children) walkTree(c, id, baseLevel + 1, addNode, addEdge);
}

// Longest-path layering : chaque nœud se place à droite de tous ses parents.
export function relevel(nodes: GraphNode[], edges: GraphEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  for (const e of edges) (incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target)!).push(e.source);
  let changed = true, guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (const n of nodes) {
      const parents = incoming.get(n.id) ?? [];
      if (!parents.length) continue;
      const lvl = Math.max(...parents.map((p) => byId.get(p)?.level ?? 0)) + 1;
      if (lvl > n.level) { n.level = lvl; changed = true; }
    }
  }
}
