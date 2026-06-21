// Construit le graphe du footprint KPK complet :
// KPK → groupes (DAOs + Vaults curatés) → entités (Safes de trésorerie + vaults)
// → marchés Morpho → primitives de risque (récursion).
// Les Safes sont des nœuds "pending" tant que Zerion n'est pas branché.

import { walkTree, relevel, type Graph, type GraphNode, type GraphEdge } from "./graph";
import type { ScanReport } from "./types";
import type { KpkSafe } from "./kpkEntities";

export type V2Brief = { name: string; address: string; chain: string; tvlUsd: number };

export function buildFootprint(args: {
  vaultReports: ScanReport[]; // vaults v1 décomposés
  v2vaults: V2Brief[];
  safes: KpkSafe[];
}): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const addNode = (n: GraphNode) => {
    const ex = nodes.get(n.id);
    if (ex) { ex.usd += n.usd; if (n.severity === "RED") ex.severity = "RED"; }
    else nodes.set(n.id, n);
  };
  const addEdge = (source: string, target: string) => {
    const id = `${source}=>${target}`;
    if (!edges.has(id)) edges.set(id, { id, source, target });
  };

  const ROOT = "root::kpk";
  addNode({ id: ROOT, kind: "root", label: "KPK", usd: 0, level: 0 });

  const group = (dao: string) => {
    const id = `group::${dao}`;
    if (!nodes.has(id)) { addNode({ id, kind: "group", label: dao, usd: 0, level: 1 }); addEdge(ROOT, id); }
    return id;
  };

  // 1. Safes de trésorerie (groupés par DAO) — pending Zerion
  for (const s of args.safes) {
    const g = group(s.dao);
    const id = `entity::safe::${s.avatar.toLowerCase()}`;
    addNode({
      id, kind: "entity", label: `${s.label}`, usd: 0, level: 2,
      dao: s.dao, chains: s.chains, pending: true,
    });
    addEdge(g, id);
  }

  // 2. Vaults curatés Morpho
  const VG = group("Vaults curatés");

  for (const r of args.vaultReports) {
    const id = `entity::${r.vault.chain}::${r.vault.address.toLowerCase()}`;
    addNode({ id, kind: "entity", label: r.vault.name ?? "vault", usd: r.tvlUsd, level: 2, chain: r.vault.chain, version: "v1" });
    addEdge(VG, id);
    for (const p of r.positions) {
      if (p.usd <= 0) continue;
      const mId = `market::${id}::${p.label}`;
      addNode({ id: mId, kind: "market", label: p.label, usd: p.usd, level: 3, severity: p.oracle.severity, flags: p.oracle.flags });
      addEdge(id, mId);
      walkTree(p.tree, mId, 4, addNode, addEdge);
    }
  }

  for (const v of args.v2vaults) {
    const id = `entity::${v.chain}::${v.address.toLowerCase()}`;
    addNode({ id, kind: "entity", label: v.name, usd: v.tvlUsd, level: 2, chain: v.chain, version: "v2", pending: true });
    addEdge(VG, id);
  }

  // totaux remontés sur les groupes + root
  for (const e of edges.values()) {
    if (e.source.startsWith("group::")) nodes.get(e.source)!.usd += nodes.get(e.target)?.usd ?? 0;
  }
  for (const n of nodes.values()) if (n.kind === "group") nodes.get(ROOT)!.usd += n.usd;

  relevel([...nodes.values()], [...edges.values()]);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
