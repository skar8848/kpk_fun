// Construit le graphe du footprint KPK complet :
// KPK → groupes (DAOs + Vaults curatés) → entités (Safes de trésorerie + vaults)
// → marchés Morpho → primitives de risque (récursion).
// Les Safes sont des nœuds "pending" tant que Zerion n'est pas branché.

import { walkTree, relevel, computePct, type Graph, type GraphNode, type GraphEdge } from "./graph";
import { resolveTree } from "./decompose";
import type { ScanReport } from "./types";
import type { KpkSafe } from "./kpkEntities";
import type { ZPosition } from "./zerion";

export type V2Brief = { name: string; address: string; chain: string; tvlUsd: number };

export function buildFootprint(args: {
  vaultReports: ScanReport[]; // vaults v1 décomposés
  v2vaults: V2Brief[];
  safes: KpkSafe[];
  safePositions?: Record<string, ZPosition[]>; // clé = avatar lowercase
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

  // 1. Safes de trésorerie (groupés par DAO). Positions via Zerion si dispo.
  for (const s of args.safes) {
    const g = group(s.dao);
    const id = `entity::safe::${s.avatar.toLowerCase()}`;
    const positions = args.safePositions?.[s.avatar.toLowerCase()] ?? null;
    const total = positions ? positions.reduce((t, p) => t + p.value, 0) : 0;
    const note = s.dao === "GnosisDAO" ? "mandate ended Nov 2025"
      : s.dao === "Ethereum Foundation" ? "mandate to verify" : undefined;
    addNode({
      id, kind: "entity", label: s.label, usd: total, level: 2,
      dao: s.dao, chains: s.chains, pending: !positions, address: s.avatar,
      note, severity: note ? "YELLOW" : undefined,
    });
    addEdge(g, id);

    for (const p of positions ?? []) {
      // nœud position = protocole + token (granularité par protocole)
      const pid = `pos::${id}::${p.protocol}::${p.symbol}::${p.chain}`;
      addNode({
        id: pid, kind: "market", label: `${p.symbol} · ${p.protocol}`, usd: p.value,
        level: 3, protocol: p.protocol, mechanism: p.type, type: p.type, chain: p.chain,
        severity: "OK", address: p.address,
      });
      addEdge(id, pid);
      // récursion sur le token sous-jacent → convergence vers les primitives
      walkTree(resolveTree(p.symbol, p.value), pid, 4, addNode, addEdge);
    }
  }

  // 2. Vaults curatés Morpho
  const VG = group("Vaults curatés");

  for (const r of args.vaultReports) {
    const id = `entity::${r.vault.chain}::${r.vault.address.toLowerCase()}`;
    addNode({ id, kind: "entity", label: r.vault.name ?? "vault", usd: r.tvlUsd, level: 2, chain: r.vault.chain, version: "v1", address: r.vault.address });
    addEdge(VG, id);
    for (const p of r.positions) {
      if (p.usd <= 0) continue;
      const mId = `market::${id}::${p.label}`;
      addNode({
        id: mId, kind: "market", label: p.label, usd: p.usd, level: 3, severity: p.oracle.severity,
        flags: p.oracle.flags, chain: r.vault.chain, marketId: p.metrics.marketId,
        oracleAddr: p.metrics.oracleAddr, oracleType: p.oracle.oracle_type ?? undefined,
        collateralAddr: p.metrics.collateralAddr, loanAddr: p.metrics.loanAddr,
        lltvPct: p.metrics.lltvPct, utilPct: p.metrics.utilPct, supplyApyPct: p.metrics.supplyApyPct,
        borrowApyPct: p.metrics.borrowApyPct, liquidityUsd: p.metrics.liquidityUsd,
      });
      addEdge(id, mId);
      walkTree(p.tree, mId, 4, addNode, addEdge);
    }
  }

  for (const v of args.v2vaults) {
    const id = `entity::${v.chain}::${v.address.toLowerCase()}`;
    addNode({ id, kind: "entity", label: v.name, usd: v.tvlUsd, level: 2, chain: v.chain, version: "v2", pending: true, address: v.address });
    addEdge(VG, id);
  }

  // totaux remontés sur les groupes + root
  for (const e of edges.values()) {
    if (e.source.startsWith("group::")) nodes.get(e.source)!.usd += nodes.get(e.target)?.usd ?? 0;
  }
  for (const n of nodes.values()) if (n.kind === "group") nodes.get(ROOT)!.usd += n.usd;

  const nlist = [...nodes.values()];
  relevel(nlist, [...edges.values()]);
  computePct(nlist);
  return { nodes: nlist, edges: [...edges.values()] };
}
