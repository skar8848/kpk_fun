"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import type { Graph } from "@/lib/graph";

function usd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

type Row = { name: string; value: number; pct: number; label: string };

// top-N + "other", with % of the chart total
function topN(map: Record<string, number>, n: number): Row[] {
  const rows = Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  const top = rows.slice(0, n);
  const rest = rows.slice(n).reduce((s, r) => s + r.value, 0);
  if (rest > 0) top.push({ name: "other", value: rest });
  return top.map((r) => {
    const pct = Math.round((1000 * r.value) / total) / 10;
    return { ...r, pct, label: `${usd(r.value)} · ${pct}%` };
  });
}

const PALETTE = ["#55c3e9", "#02c77b", "#f5a623", "#eb365a", "#8898a8", "#7c5cff", "#e9a955", "#55e9c3"];

export default function Stats({ graph, onClose }: { graph: Graph; onClose: () => void }) {
  const { tvl, byProtocol, byPrimitive, byChain, byDao } = useMemo(() => {
    const out = new Set(graph.edges.map((e) => e.source));
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
      if (n.kind === "asset" && !out.has(n.id)) prim[n.label] = (prim[n.label] ?? 0) + n.usd;
    }
    return { tvl, byProtocol: topN(proto, 7), byPrimitive: topN(prim, 8), byChain: topN(chain, 6), byDao: topN(dao, 8) };
  }, [graph]);

  return (
    <div className="absolute top-3 right-3 w-96 max-w-[92vw] max-h-[88vh] card p-4 z-20 overflow-y-auto">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">Footprint stats</h2>
        <button onClick={onClose} className="text-muted-fg hover:text-fg">✕</button>
      </div>
      <div className="mb-4">
        <div className="text-muted text-[10px] uppercase tracking-wider">Mapped TVL</div>
        <div className="mono text-primary text-2xl">{usd(tvl)}</div>
      </div>
      <Chart title="By protocol" data={byProtocol} />
      <Chart title="By risk primitive" data={byPrimitive} />
      <Chart title="By DAO / group" data={byDao} />
      <Chart title="By chain" data={byChain} />
    </div>
  );
}

function Chart({ title, data }: { title: string; data: Row[] }) {
  if (!data.length) return null;
  return (
    <div className="mb-6">
      <div className="text-xs text-muted-fg uppercase tracking-wider mb-1">{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(90, data.length * 30)}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 96, top: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={88} tick={{ fill: "#8898a8", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{ background: "#0c1218", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
            formatter={(value: unknown) => usd(Number(value))}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            <LabelList dataKey="label" position="right" fill="#8898a8" fontSize={9} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
