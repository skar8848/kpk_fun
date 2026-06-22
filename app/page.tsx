"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Graph, GraphNode } from "@/lib/graph";
import { explorerAddr, shortAddr, oracleVendor, chainLabel } from "@/lib/explorer";
import Stats from "@/components/Stats";
import Dashboard from "@/components/Dashboard";

const PRESETS = [
  { name: "Smokehouse USDC", addr: "0xBEeFFF209270748ddd194831b3fa287a5386f5bC" },
  { name: "Steakhouse USDC", addr: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB" },
  { name: "KPK USDC Prime", addr: "0x4ef53d2caa51c447fdfeeedee8f07fd1962c9ee6" },
];
const CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "unichain", "katana"];
const CHAIN_LOGO: Record<string, string> = {
  ethereum: "ethereum.svg", arbitrum: "arbitrum.svg", base: "base.svg",
  optimism: "optimism.svg", gnosis: "gnosis.png", bsc: "bsc.svg",
};
const chainLogo = (c?: string) => `/chains/${(c && CHAIN_LOGO[c]) || "_fallback.svg"}`;

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
    : d.kind === "entity" ? (d.note ? "#f5a623" : d.pending ? "#586878" : "#8898a8")
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
        minWidth: d.kind === "group" ? 130 : 96,
        opacity: d.pending ? 0.85 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="font-medium flex items-center gap-1.5">
        {(d.kind === "market" || d.kind === "asset") && (
          <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {d.chain && <img src={chainLogo(d.chain)} alt={d.chain} width={12} height={12} style={{ borderRadius: 2 }} />}
        <span className={d.kind === "group" ? "uppercase tracking-wide" : "mono"}>{d.label}</span>
        {d.version && <span className="text-[8px] border border-current rounded px-0.5 opacity-60">{d.version}</span>}
      </div>
      {d.usd > 0 && (
        <div className="mono opacity-60 text-[10px]">
          {usd(d.usd)}{d.pct != null && d.pct >= 0.1 ? ` · ${d.pct}%` : ""}
          {d.vaultApyPct != null ? ` · ${d.vaultApyPct}% APY` : ""}
        </div>
      )}
      {d.protocol && d.protocol !== "-" && d.protocol !== "?" && (
        <div className="text-[9px] opacity-50">{d.protocol}</div>
      )}
      {d.note && <div className="text-[9px]" style={{ color: "#f5a623" }}>⚠ {d.note}</div>}
      {d.pending && !d.note && <div className="text-[9px] opacity-60">positions pending…</div>}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
const nodeTypes = { k: KNode };

function layout(graph: Graph): { nodes: Node[]; edges: Edge[] } {
  const byLevel = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) (byLevel.get(n.level) ?? byLevel.set(n.level, []).get(n.level)!).push(n);
  const COL = 240, ROW = 64;
  const nodes: Node[] = [];
  for (const [lvl, arr] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    arr.sort((a, b) => b.usd - a.usd);
    const h = (arr.length - 1) * ROW;
    arr.forEach((n, i) => {
      nodes.push({ id: n.id, type: "k", position: { x: lvl * COL, y: i * ROW - h / 2 }, data: n as unknown as Record<string, unknown> });
    });
  }
  const edges: Edge[] = graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
  return { nodes, edges };
}

export default function Home() {
  const [addr, setAddr] = useState(PRESETS[0].addr);
  const [chain, setChain] = useState("ethereum");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<GraphNode | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [meta, setMeta] = useState<{ cachedAt?: number; fromCache?: boolean }>({});
  const [refresh, setRefresh] = useState<(() => void) | null>(null);

  const fetchGraph = useCallback(async (url: string, msg: string, again: () => void) => {
    setLoading(true); setLoadingMsg(msg); setError(null); setSel(null);
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "error");
      setGraph(data.graph);
      setMeta({ cachedAt: data.cachedAt, fromCache: data.fromCache });
      setRefresh(() => again);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  const load = useCallback((a: string, c: string, fresh = false) => {
    fetchGraph(`/api/graph?address=${a}&chain=${c}${fresh ? "&fresh=1" : ""}`, "Scanning vault…", () => load(a, c, true));
  }, [fetchGraph]);

  const loadFootprint = useCallback((fresh = false) => {
    fetchGraph(`/api/footprint${fresh ? "?fresh=1" : ""}`, "Mapping KPK footprint… (first load ~25s, then cached)", () => loadFootprint(true));
  }, [fetchGraph]);

  const [hideDeprecated, setHideDeprecated] = useState(false);
  const [view, setView] = useState<"canvas" | "dashboard">("canvas");
  const [addrFocused, setAddrFocused] = useState(false);
  const isAddr = /^0x[a-fA-F0-9]{40}$/.test(addr);

  useEffect(() => { loadFootprint(); }, [loadFootprint]); // KPK footprint by default

  // controlled state: drags persist, edges follow
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  useEffect(() => {
    if (!graph) return;
    const { nodes, edges } = layout(graph);
    setRfNodes(nodes); setRfEdges(edges);
  }, [graph, setRfNodes, setRfEdges]);

  // highlight the full connected chain (upstream + downstream) of the selected node
  const hl = useMemo(() => {
    if (!sel || !graph) return null;
    const fwd = new Map<string, string[]>(), bwd = new Map<string, string[]>();
    for (const e of graph.edges) {
      (fwd.get(e.source) ?? fwd.set(e.source, []).get(e.source)!).push(e.target);
      (bwd.get(e.target) ?? bwd.set(e.target, []).get(e.target)!).push(e.source);
    }
    const nids = new Set<string>([sel.id]);
    const walk = (adj: Map<string, string[]>) => {
      const st = [sel.id];
      while (st.length) { const x = st.pop()!; for (const n of adj.get(x) ?? []) if (!nids.has(n)) { nids.add(n); st.push(n); } }
    };
    walk(fwd); walk(bwd);
    const eids = new Set<string>();
    for (const e of graph.edges) if (nids.has(e.source) && nids.has(e.target)) eids.add(e.id);
    return { eids, nids };
  }, [sel, graph]);

  // deprecated (mandate ended / to verify) : entité + ses positions exclusives, + groupe si tout est masqué
  const hiddenIds = useMemo(() => {
    const h = new Set<string>();
    if (!hideDeprecated || !graph) return h;
    const dep = new Set(graph.nodes.filter((n) => n.note).map((n) => n.id));
    dep.forEach((d) => h.add(d));
    for (const e of graph.edges) {
      if (dep.has(e.source) && (e.target.startsWith("market::") || e.target.startsWith("pos::"))) h.add(e.target);
    }
    // groupe masqué si toutes ses entités le sont
    for (const g of graph.nodes.filter((n) => n.kind === "group")) {
      const kids = graph.edges.filter((e) => e.source === g.id).map((e) => e.target);
      if (kids.length && kids.every((k) => h.has(k))) h.add(g.id);
    }
    return h;
  }, [hideDeprecated, graph]);

  const displayNodes = useMemo(() => rfNodes.map((n) => ({
    ...n, hidden: hiddenIds.has(n.id),
    style: { ...n.style, opacity: hl && !hl.nids.has(n.id) ? 0.18 : 1, transition: "opacity .15s" },
  })), [rfNodes, hl, hiddenIds]);

  const displayEdges = useMemo(() => rfEdges.map((e) => {
    const on = hl?.eids.has(e.id);
    return {
      ...e, hidden: hiddenIds.has(e.source) || hiddenIds.has(e.target), animated: !!on,
      style: { stroke: on ? "#55c3e9" : hl ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.12)", strokeWidth: on ? 2 : 1 },
    };
  }), [rfEdges, hl, hiddenIds]);

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="font-semibold tracking-tight mr-1">KPK <span className="text-primary">Explorer</span></div>
        <div className="flex rounded-lg border border-border overflow-hidden text-sm mr-1">
          <button onClick={() => setView("canvas")} className={`px-3 py-1.5 ${view === "canvas" ? "bg-primary text-bg" : "text-muted-fg"}`}>Canvas</button>
          <button onClick={() => setView("dashboard")} className={`px-3 py-1.5 ${view === "dashboard" ? "bg-primary text-bg" : "text-muted-fg"}`}>Dashboard</button>
        </div>
        <input
          value={addrFocused || !isAddr ? addr : shortAddr(addr)}
          onChange={(e) => setAddr(e.target.value)}
          onFocus={() => setAddrFocused(true)} onBlur={() => setAddrFocused(false)}
          placeholder="0x… Morpho vault"
          className="w-44 bg-bg border border-border rounded-lg px-3 py-1.5 text-sm mono outline-none focus:border-primary"
        />
        <select value={chain} onChange={(e) => setChain(e.target.value)}
          className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm outline-none">
          {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => load(addr, chain)} disabled={loading}
          className="bg-primary text-bg font-medium rounded-lg px-4 py-1.5 text-sm disabled:opacity-50">Scan</button>
        <button onClick={() => loadFootprint()} disabled={loading}
          className="border border-primary text-primary font-medium rounded-lg px-4 py-1.5 text-sm disabled:opacity-50">🌐 KPK Footprint</button>
        <button onClick={() => setShowStats((s) => !s)} disabled={!graph}
          className="border border-border text-fg rounded-lg px-3 py-1.5 text-sm disabled:opacity-40">📊 Stats</button>
        <button onClick={() => setHideDeprecated((s) => !s)} disabled={!graph}
          title="hide entities with an ended/unverified mandate"
          className="rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 border"
          style={{ borderColor: hideDeprecated ? "#f5a623" : "var(--border)", color: hideDeprecated ? "#f5a623" : "var(--muted-fg)" }}>
          {hideDeprecated ? "Deprecated: hidden" : "Deprecated: shown"}
        </button>
        <button onClick={() => refresh?.()} disabled={loading || !refresh} title="recompute (bypass cache)"
          className="border border-border text-muted-fg hover:text-fg rounded-lg px-3 py-1.5 text-sm disabled:opacity-40">↻</button>
        {meta.fromCache && <span className="text-[10px] text-muted-fg">⚡ cached</span>}
        {PRESETS.map((p) => (
          <button key={p.addr} onClick={() => { setAddr(p.addr); load(p.addr, "ethereum"); }}
            className="text-xs text-muted-fg hover:text-primary border border-border rounded-full px-3 py-1">{p.name}</button>
        ))}
      </header>

      {error && <div className="px-4 py-2 text-red text-sm border-b border-border">{error}</div>}

      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-30 backdrop-blur-sm" style={{ background: "rgba(10,18,28,0.6)" }}>
            <div className="w-8 h-8 rounded-full border-2 border-border border-t-primary animate-spin" />
            <div className="text-sm text-muted-fg mt-3">{loadingMsg}</div>
          </div>
        )}
        {view === "dashboard" && graph && <Dashboard graph={graph} />}
        {view === "canvas" && (<>
        <ReactFlow
          nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          fitView minZoom={0.1} maxZoom={2}
          onNodeClick={(_, n) => setSel(n.data as unknown as GraphNode)}
          onPaneClick={() => setSel(null)}
          proOptions={{ hideAttribution: true }} colorMode="dark"
        >
          <Background color="#1a2430" gap={20} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => {
            const d = n.data as unknown as GraphNode;
            return d.kind === "root" || d.kind === "group" ? "#55c3e9" : d.kind === "entity" ? "#586878" : sevColor[d.severity ?? "OK"];
          }} maskColor="rgba(10,18,28,0.6)" style={{ background: "#0c1218" }} />
        </ReactFlow>

        <div className="absolute top-3 left-3 card p-2.5 text-[11px] space-y-1 z-10">
          <div className="text-muted-fg uppercase tracking-wider mb-1">Legend</div>
          <Legend c="#55c3e9" t="KPK entity / vault" />
          <Legend c={sevColor.OK} t="healthy market / asset" />
          <Legend c={sevColor.YELLOW} t="risk (NAV, exotic peg, inactive mandate)" />
          <Legend c={sevColor.RED} t="opaque oracle / bad debt / unmapped" />
          <div className="text-muted-fg pt-1">→ rightward = deeper in the risk chain</div>
          <div className="text-muted pt-0.5">click a node to highlight its full chain</div>
        </div>

        {sel && (
          <div className="absolute top-3 right-3 w-72 card p-4 z-10 max-h-[88vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <span className="font-medium mono">{sel.label}</span>
              <button onClick={() => setSel(null)} className="text-muted-fg hover:text-fg">✕</button>
            </div>
            <div className="text-xs text-muted-fg mt-0.5">{sel.kind}{sel.chain ? ` · ${chainLabel(sel.chain)}` : ""}{sel.version ? ` · ${sel.version}` : ""}</div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="mono text-primary text-lg">{usd(sel.usd)}</span>
              {sel.pct != null && sel.pct > 0 && <span className="mono text-xs text-muted-fg">{sel.pct}% of TVL</span>}
            </div>
            <dl className="text-xs mt-3 space-y-1.5">
              {sel.note && <Row k="status" v={`⚠ ${sel.note}`} accent="#f5a623" />}
              {sel.dao && <Row k="DAO" v={sel.dao} />}
              {sel.chains && sel.chains.length > 0 && <Row k="chains" v={sel.chains.join(", ")} />}
              {sel.type && <Row k="position type" v={sel.type} />}
              {sel.pending && <Row k="positions" v="not loaded" accent="#586878" />}
              {sel.vaultApyPct != null && <Row k="net APY" v={`${sel.vaultApyPct}%`} accent="#02c77b" />}
              {sel.lltvPct != null && <Row k="LLTV" v={`${sel.lltvPct}%`} />}
              {sel.utilPct != null && <Row k="utilization" v={`${sel.utilPct}%`} accent={sel.utilPct > 95 ? "#eb365a" : undefined} />}
              {sel.supplyApyPct != null && <Row k="supply APY" v={`${sel.supplyApyPct}%`} accent="#02c77b" />}
              {sel.borrowApyPct != null && <Row k="borrow APY" v={`${sel.borrowApyPct}%`} accent="#f5a623" />}
              {sel.liquidityUsd != null && <Row k="liquidity" v={usd(sel.liquidityUsd)} accent={sel.liquidityUsd < 1000 ? "#eb365a" : undefined} />}
              {sel.protocol && sel.protocol !== "-" && sel.protocol !== "?" && <Row k="protocol" v={sel.protocol} />}
              {sel.mechanism && <Row k="mechanism" v={sel.mechanism} />}
              {sel.risk && <Row k="risk" v={sel.risk} accent="#f5a623" />}
              {sel.unmapped && <Row k="status" v="❓ unmapped collateral" accent="#eb365a" />}
              {sel.flags && sel.flags.length > 0 && <Row k="oracle flags" v={sel.flags.join(", ")} accent={sevColor[sel.severity ?? "OK"]} />}
              {/* clickable contracts */}
              {sel.address && <AddrRow k="contract" chain={sel.chain} a={sel.address} />}
              {sel.collateralAddr && <AddrRow k="collateral" chain={sel.chain} a={sel.collateralAddr} />}
              {sel.loanAddr && <AddrRow k="loan asset" chain={sel.chain} a={sel.loanAddr} />}
              {sel.oracleAddr && <AddrRow k={`oracle · ${oracleVendor(sel.oracleType, sel.oracleAddr)}`} chain={sel.chain} a={sel.oracleAddr} />}
            </dl>
          </div>
        )}

        {showStats && graph && <Stats graph={graph} onClose={() => setShowStats(false)} />}
        </>)}
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
      <dd className="mono break-words" style={{ color: accent ?? "var(--fg)" }}>{v}</dd>
    </div>
  );
}
function AddrRow({ k, chain, a }: { k: string; chain?: string; a: string }) {
  return (
    <div>
      <dt className="text-muted uppercase tracking-wider text-[10px]">{k}</dt>
      <dd>
        <a href={explorerAddr(chain, a)} target="_blank" rel="noreferrer" className="mono text-primary hover:underline">
          {shortAddr(a)} ↗
        </a>
      </dd>
    </div>
  );
}
