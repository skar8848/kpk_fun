"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position,
  type Node, type Edge, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Graph, GraphNode } from "@/lib/graph";

const PRESETS = [
  { name: "Smokehouse USDC", addr: "0xBEeFFF209270748ddd194831b3fa287a5386f5bC" },
  { name: "Steakhouse USDC", addr: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB" },
  { name: "Gauntlet USDC Prime", addr: "0xdd0f28e19C1780eb6396170735D45153D261490d" },
];
const CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "unichain", "katana"];

function usd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
const sevColor: Record<string, string> = { RED: "#eb365a", YELLOW: "#f5a623", OK: "#02c77b" };

function KNode({ data, selected }: NodeProps) {
  const d = data as unknown as GraphNode;
  const accent =
    d.kind === "root" || d.kind === "group" ? "#55c3e9"
    : d.kind === "entity" ? (d.pending ? "#586878" : "#8898a8")
    : sevColor[d.severity ?? "OK"];
  const filled = d.kind === "root" || d.kind === "group";
  return (
    <div
      className="rounded-lg px-3 py-1.5 text-xs"
      style={{
        background: filled ? (d.kind === "root" ? "#55c3e9" : "#11202c") : "#0c1218",
        color: d.kind === "root" ? "#0a121c" : "#e8eef4",
        border: `1px solid ${accent}`,
        borderStyle: d.pending ? "dashed" : "solid",
        boxShadow: selected ? `0 0 0 2px ${accent}` : "none",
        minWidth: d.kind === "group" ? 130 : 90,
        opacity: d.pending ? 0.85 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="font-medium flex items-center gap-1.5">
        {(d.kind === "market" || d.kind === "asset") && (
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
        )}
        <span className={d.kind === "group" ? "uppercase tracking-wide" : "mono"}>{d.label}</span>
        {d.version && <span className="text-[8px] border border-current rounded px-0.5 opacity-60">{d.version}</span>}
      </div>
      {d.usd > 0 && <div className="mono opacity-60 text-[10px]">{usd(d.usd)}</div>}
      {d.protocol && d.protocol !== "-" && d.protocol !== "?" && (
        <div className="text-[9px] opacity-50">{d.protocol}</div>
      )}
      {d.pending && <div className="text-[9px] opacity-60">positions pending…</div>}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
const nodeTypes = { k: KNode };

function layout(graph: Graph): { nodes: Node[]; edges: Edge[] } {
  const byLevel = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) (byLevel.get(n.level) ?? byLevel.set(n.level, []).get(n.level)!).push(n);
  const COL = 230, ROW = 64;
  const nodes: Node[] = [];
  for (const [lvl, arr] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    arr.sort((a, b) => b.usd - a.usd);
    const h = (arr.length - 1) * ROW;
    arr.forEach((n, i) => {
      nodes.push({
        id: n.id, type: "k",
        position: { x: lvl * COL, y: i * ROW - h / 2 },
        data: n as unknown as Record<string, unknown>,
      });
    });
  }
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    style: { stroke: "rgba(255,255,255,0.12)" }, animated: false,
  }));
  return { nodes, edges };
}

export default function Home() {
  const [addr, setAddr] = useState(PRESETS[0].addr);
  const [chain, setChain] = useState("ethereum");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<GraphNode | null>(null);

  const load = useCallback(async (a: string, c: string) => {
    setLoading(true); setError(null); setSel(null);
    try {
      const res = await fetch(`/api/graph?address=${a}&chain=${c}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "erreur");
      setGraph(data.graph);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFootprint = useCallback(async () => {
    setLoading(true); setError(null); setSel(null);
    try {
      const res = await fetch(`/api/footprint`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "erreur");
      setGraph(data.graph);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(PRESETS[0].addr, "ethereum"); }, [load]);

  const { nodes, edges } = useMemo(() => (graph ? layout(graph) : { nodes: [], edges: [] }), [graph]);

  return (
    <div className="h-screen flex flex-col">
      {/* barre de contrôle */}
      <header className="border-b border-border px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="font-semibold tracking-tight mr-2">
          KPK <span className="text-primary">Contagion Canvas</span>
        </div>
        <input
          value={addr} onChange={(e) => setAddr(e.target.value)}
          placeholder="0x… vault Morpho v1"
          className="flex-1 min-w-50 bg-bg border border-border rounded-lg px-3 py-1.5 text-sm mono outline-none focus:border-primary"
        />
        <select value={chain} onChange={(e) => setChain(e.target.value)}
          className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm outline-none">
          {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => load(addr, chain)} disabled={loading}
          className="bg-primary text-bg font-medium rounded-lg px-4 py-1.5 text-sm disabled:opacity-50">
          {loading ? "…" : "Scan"}
        </button>
        <button onClick={loadFootprint} disabled={loading}
          className="border border-primary text-primary font-medium rounded-lg px-4 py-1.5 text-sm disabled:opacity-50">
          🌐 KPK Footprint
        </button>
        {PRESETS.map((p) => (
          <button key={p.addr} onClick={() => { setAddr(p.addr); load(p.addr, "ethereum"); }}
            className="text-xs text-muted-fg hover:text-primary border border-border rounded-full px-3 py-1">
            {p.name}
          </button>
        ))}
      </header>

      {error && <div className="px-4 py-2 text-red text-sm border-b border-border">{error}</div>}

      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          fitView minZoom={0.1} maxZoom={2}
          onNodeClick={(_, n) => setSel(n.data as unknown as GraphNode)}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background color="#1a2430" gap={20} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => {
            const d = n.data as unknown as GraphNode;
            return d.kind === "root" || d.kind === "group" ? "#55c3e9" : d.kind === "entity" ? "#586878" : sevColor[d.severity ?? "OK"];
          }} maskColor="rgba(10,18,28,0.6)" style={{ background: "#0c1218" }} />
        </ReactFlow>

        {/* légende */}
        <div className="absolute top-3 left-3 card p-2.5 text-[11px] space-y-1 z-10">
          <div className="text-muted-fg uppercase tracking-wider mb-1">Légende</div>
          <Legend c="#55c3e9" t="entité KPK / vault" />
          <Legend c={sevColor.OK} t="marché / actif sain" />
          <Legend c={sevColor.YELLOW} t="risque (NAV, peg exotique, risk tag)" />
          <Legend c={sevColor.RED} t="oracle opaque / bad debt / non mappé" />
          <div className="text-muted-fg pt-1">→ vers la droite = plus profond dans la chaîne de risque</div>
        </div>

        {/* panneau détail */}
        {sel && (
          <div className="absolute top-3 right-3 w-72 card p-4 z-10">
            <div className="flex justify-between items-start">
              <span className="font-medium mono">{sel.label}</span>
              <button onClick={() => setSel(null)} className="text-muted-fg hover:text-fg">✕</button>
            </div>
            <div className="text-xs text-muted-fg mt-0.5">{sel.kind}{sel.chain ? ` · ${sel.chain}` : ""}</div>
            <div className="mono text-primary text-lg mt-2">{usd(sel.usd)}</div>
            <dl className="text-xs mt-3 space-y-1.5">
              {sel.dao && <Row k="DAO" v={sel.dao} />}
              {sel.version && <Row k="version" v={sel.version} />}
              {sel.chains && sel.chains.length > 0 && <Row k="chaînes" v={sel.chains.join(", ")} />}
              {sel.pending && <Row k="positions" v="à charger (Zerion)" accent="#586878" />}
              {sel.protocol && sel.protocol !== "-" && sel.protocol !== "?" && <Row k="protocole" v={sel.protocol} />}
              {sel.mechanism && <Row k="mécanisme" v={sel.mechanism} />}
              {sel.risk && <Row k="risque" v={sel.risk} accent="#f5a623" />}
              {sel.unmapped && <Row k="statut" v="❓ collatéral non mappé" accent="#eb365a" />}
              {sel.flags && sel.flags.length > 0 && <Row k="oracle" v={sel.flags.join(", ")} accent={sevColor[sel.severity ?? "OK"]} />}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: c }} />
      <span className="text-muted-fg">{t}</span>
    </div>
  );
}
function Row({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div>
      <dt className="text-muted uppercase tracking-wider text-[10px]">{k}</dt>
      <dd className="mono" style={{ color: accent ?? "var(--fg)" }}>{v}</dd>
    </div>
  );
}
