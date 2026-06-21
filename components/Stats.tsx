"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { Graph, GraphNode } from "@/lib/graph";

function usd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

// agrège en top-N + "autres"
function topN(map: Record<string, number>, n: number) {
  const rows = Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const top = rows.slice(0, n);
  const rest = rows.slice(n).reduce((s, r) => s + r.value, 0);
  if (rest > 0) top.push({ name: "autres", value: rest });
  return top;
}

const PALETTE = ["#55c3e9", "#02c77b", "#f5a623", "#eb365a", "#8898a8", "#7c5cff", "#e9a955", "#55e9c3"];

export default function Stats({ graph, onClose }: { graph: Graph; onClose: () => void }) {
  const { tvl, byProtocol, byPrimitive, byChain, byDao } = useMemo(() => {
    const out = new Set(graph.edges.map((e) => e.source)); // nœuds ayant des enfants
    const proto: Record<string, number> = {};
    const prim: Record<string, number> = {};
    const chain: Record<string, number> = {};
    const dao: Record<string, number> = {};
    let tvl = 0;
    for (const n of graph.nodes) {
      if (n.kind === "root") tvl = n.usd;
      if (n.kind === "group") dao[n.label] = (dao[n.label] ?? 0) + n.usd;
      if (n.kind === "market") {
        proto[n.protocol ?? "Morpho"] = (proto[n.protocol ?? "Morpho"] ?? 0) + n.usd;
        if (n.chain) chain[n.chain] = (chain[n.chain] ?? 0) + n.usd;
      }
      // primitives = feuilles asset (sans enfant)
      if (n.kind === "asset" && !out.has(n.id)) prim[n.label] = (prim[n.label] ?? 0) + n.usd;
    }
    return { tvl, byProtocol: topN(proto, 7), byPrimitive: topN(prim, 7), byChain: topN(chain, 6), byDao: topN(dao, 8) };
  }, [graph]);

  return (
    <div className="absolute inset-y-3 right-3 w-96 max-w-[90vw] card p-4 z-20 overflow-y-auto">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">Stats du footprint</h2>
        <button onClick={onClose} className="text-muted-fg hover:text-fg">✕</button>
      </div>
      <div className="mb-4">
        <div className="text-muted text-[10px] uppercase tracking-wider">TVL cartographié</div>
        <div className="mono text-primary text-2xl">{usd(tvl)}</div>
      </div>
      <Chart title="Par protocole" data={byProtocol} />
      <Chart title="Par primitive de risque" data={byPrimitive} />
      <Chart title="Par DAO / groupe" data={byDao} />
      <Chart title="Par chaîne" data={byChain} />
    </div>
  );
}

function Chart({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  if (!data.length) return null;
  return (
    <div className="mb-5">
      <div className="text-xs text-muted-fg uppercase tracking-wider mb-1">{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(90, data.length * 26)}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={92} tick={{ fill: "#8898a8", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{ background: "#0c1218", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
            formatter={(value: unknown) => usd(Number(value))}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
