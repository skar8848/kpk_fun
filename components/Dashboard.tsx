"use client";

import { useMemo, useState } from "react";
import { PieChart, Pie, Cell as PieCell, ResponsiveContainer, Tooltip as RTooltip, Treemap } from "recharts";
import type { Graph, GraphNode } from "@/lib/graph";
import { explorerAddr, shortAddr, oracleVendor, chainLabel } from "@/lib/explorer";

function usd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

const DUNE = [
  { t: "Morpho Vaults", u: "https://dune.com/kpk/kpk-morpho-vaults" },
  { t: "Gearbox Vaults", u: "https://dune.com/kpk/kpk-gearbox-vaults" },
  { t: "Euler Vaults", u: "https://dune.com/kpk/kpk-euler-vaults" },
  { t: "Vaults Operations", u: "https://dune.com/kpk/kpk-vaults-operations" },
];

// palette pastel façon Dune
const PROTO_COLOR: Record<string, string> = { Morpho: "#8ec3e0", Euler: "#b9a8e3", Gearbox: "#93d6b4" };
const PALETTE = ["#8ec3e0", "#b9a8e3", "#93d6b4", "#f3cd95", "#e9a3ad", "#a6cfd6", "#d4c1ec", "#f5b9a0", "#b8d99a", "#c9c2a8"];

type Col = { key: string; label: string; num?: boolean; render?: (r: Row) => React.ReactNode };
type Row = Record<string, unknown>;

function SortableTable({ cols, rows, initial }: { cols: Col[]; rows: Row[]; initial: string }) {
  const [sortKey, setSortKey] = useState(initial);
  const [dir, setDir] = useState<1 | -1>(-1);
  const sorted = useMemo(() => {
    const c = cols.find((x) => x.key === sortKey);
    return [...rows].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (c?.num) return (Number(vb) - Number(va)) * -dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * -dir;
    });
  }, [rows, sortKey, dir, cols]);
  const click = (k: string) => { if (k === sortKey) setDir((dd) => (dd === 1 ? -1 : 1)); else { setSortKey(k); setDir(-1); } };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted uppercase tracking-wider text-[10px] text-left">
            {cols.map((c) => (
              <th key={c.key} onClick={() => click(c.key)} className={`py-1.5 px-2 cursor-pointer hover:text-fg select-none ${c.num ? "text-right" : ""}`}>
                {c.label}{sortKey === c.key ? (dir === -1 ? " ↓" : " ↑") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className="border-t border-border hover:bg-[rgba(255,255,255,0.02)]">
              {cols.map((c) => (
                <td key={c.key} className={`py-1.5 px-2 ${c.num ? "text-right mono" : ""}`}>
                  {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard({ graph }: { graph: Graph }) {
  const d = useMemo(() => {
    const out = new Set(graph.edges.map((e) => e.source));
    const N = graph.nodes;
    const tvl = N.find((n) => n.kind === "root")?.usd ?? 0;

    const entities = N.filter((n) => n.kind === "entity").map((n) => ({
      dao: n.dao ?? "Curated Vaults", name: n.label, usd: n.usd, pct: n.pct ?? 0,
      chains: (n.chains ?? (n.chain ? [n.chain] : [])),
      status: n.note ?? (n.pending ? "no positions" : "active"),
      apy: n.vaultApyPct ?? null, n,
    }));
    const markets = N.filter((n) => n.kind === "market" && n.lltvPct != null).map((n) => ({
      market: n.label, tvl: n.usd, pct: n.pct ?? 0, lltv: n.lltvPct ?? 0, util: n.utilPct ?? 0,
      sapy: n.supplyApyPct ?? 0, bapy: n.borrowApyPct ?? 0, chain: n.chain ?? "", n,
    }));
    const positions = N.filter((n) => n.kind === "market" && n.lltvPct == null).map((n) => ({
      asset: n.label, protocol: n.protocol ?? "", type: n.type ?? "", tvl: n.usd, chain: n.chain ?? "", n,
    }));

    const protoMap: Record<string, number> = {}, primMap: Record<string, { usd: number; n: GraphNode }> = {};
    for (const n of N) {
      if (n.kind === "market") protoMap[n.protocol ?? "Morpho"] = (protoMap[n.protocol ?? "Morpho"] ?? 0) + n.usd;
      if (n.kind === "asset" && !out.has(n.id)) primMap[n.label] = { usd: (primMap[n.label]?.usd ?? 0) + n.usd, n };
    }
    const protocols = Object.entries(protoMap).map(([protocol, v]) => ({ protocol, tvl: v, pct: tvl ? (1000 * v / tvl) / 10 : 0 })).sort((a, b) => b.tvl - a.tvl);
    const primitives = Object.entries(primMap).map(([asset, o]) => ({ asset, tvl: o.usd, pct: tvl ? (1000 * o.usd / tvl) / 10 : 0, n: o.n })).sort((a, b) => b.tvl - a.tvl);

    // exposition par chaîne (réparti sur les positions top-level, multichain = split égal)
    const chainMap: Record<string, number> = {};
    for (const e of entities) {
      const cs = e.chains.length ? e.chains : ["unknown"];
      for (const c of cs) chainMap[c] = (chainMap[c] ?? 0) + e.usd / cs.length;
    }
    const chains = Object.entries(chainMap).map(([chain, v]) => ({ chain, tvl: v, pct: tvl ? (1000 * v / tvl) / 10 : 0 })).sort((a, b) => b.tvl - a.tvl);

    // APY net pondéré par TVL
    const apyNum = entities.reduce((s, e) => s + (e.apy != null ? e.usd * e.apy : 0), 0);
    const apyDen = entities.reduce((s, e) => s + (e.apy != null ? e.usd : 0), 0);
    const wApy = apyDen ? apyNum / apyDen : 0;

    const activeEntities = entities.filter((e) => e.status === "active");
    const hotMarkets = markets.filter((m) => m.util >= 90).length;
    const topUtil = [...markets].sort((a, b) => b.util - a.util)[0];
    const topLltv = [...markets].sort((a, b) => b.lltv - a.lltv)[0];

    // treemap : top entités actives par TVL
    const tree = activeEntities
      .filter((e) => e.usd > 0)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 16)
      .map((e, i) => ({ name: e.name, size: e.usd, fill: PALETTE[i % PALETTE.length] }));

    return { tvl, entities, markets, positions, protocols, primitives, chains, wApy, activeEntities, hotMarkets, topUtil, topLltv, tree };
  }, [graph]);

  return (
    <div className="h-full overflow-y-auto px-5 py-5 max-w-6xl mx-auto space-y-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">KPK Footprint <span className="text-muted-fg text-sm">dashboard</span></h1>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Mapped TVL" value={usd(d.tvl)} accent="#55c3e9" big />
        <Kpi label="Positions" value={String(d.activeEntities.length)} sub={`${d.entities.length} total`} />
        <Kpi label="Protocols" value={String(d.protocols.length)} sub={d.protocols.map((p) => p.protocol).join(" · ")} />
        <Kpi label="Markets / pools" value={String(d.markets.length)} sub={d.hotMarkets ? `${d.hotMarkets} >90% util` : "all healthy"} subColor={d.hotMarkets ? "#f5a623" : "#02c77b"} />
        <Kpi label="Weighted net APY" value={`${d.wApy.toFixed(2)}%`} accent="#02c77b" />
      </div>

      {/* Donuts */}
      <div className="grid md:grid-cols-3 gap-4">
        <Donut title="By protocol" data={d.protocols.map((p) => ({ name: p.protocol, value: p.tvl, fill: PROTO_COLOR[p.protocol] ?? "#8898a8" }))} />
        <Donut title="By chain" data={d.chains.map((c, i) => ({ name: chainLabel(c.chain), value: c.tvl, fill: PALETTE[i % PALETTE.length] }))} />
        <Donut title="By risk primitive" data={d.primitives.slice(0, 8).map((p, i) => ({ name: p.asset, value: p.tvl, fill: PALETTE[i % PALETTE.length] }))} />
      </div>

      {/* Treemap exposition */}
      {d.tree.length > 0 && (
        <Section title="Exposure map — top positions by TVL">
          <div className="px-1 py-1" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <Treemap data={d.tree} dataKey="size" nameKey="name" stroke="#0a0a0b" content={<TreemapCell />} isAnimationActive={false}>
                <RTooltip content={<TreemapTip />} />
              </Treemap>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* Risk highlights */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Highlight label="Hottest market" value={d.topUtil ? `${d.topUtil.util.toFixed(0)}% util` : "—"} sub={d.topUtil?.market} color={d.topUtil && d.topUtil.util >= 90 ? "#eb365a" : "#f5a623"} />
        <Highlight label="Highest LLTV" value={d.topLltv ? `${d.topLltv.lltv}%` : "—"} sub={d.topLltv?.market} color="#f5a623" />
        <Highlight label="Top primitive" value={d.primitives[0] ? `${d.primitives[0].pct.toFixed(0)}%` : "—"} sub={d.primitives[0]?.asset} color="#55c3e9" />
        <Highlight label="Top chain" value={d.chains[0] ? `${d.chains[0].pct.toFixed(0)}%` : "—"} sub={d.chains[0] ? chainLabel(d.chains[0].chain) : ""} color="#a855f7" />
      </div>

      {/* Dune links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {DUNE.map((du) => (
          <a key={du.u} href={du.u} target="_blank" rel="noreferrer" className="card p-3 hover:border-primary transition-colors">
            <div className="text-[10px] text-muted-fg uppercase tracking-wider">KPK on Dune ↗</div>
            <div className="text-sm font-medium">{du.t}</div>
          </a>
        ))}
      </div>

      <Section title="By DAO / entity">
        <SortableTable initial="usd" rows={d.entities} cols={[
          { key: "dao", label: "DAO" }, { key: "name", label: "Entity" },
          { key: "usd", label: "TVL", num: true, render: (r) => usd(Number(r.usd)) },
          { key: "pct", label: "%", num: true, render: (r) => `${Number(r.pct).toFixed(1)}%` },
          { key: "apy", label: "Net APY", num: true, render: (r) => r.apy != null ? <span style={{ color: "#02c77b" }}>{Number(r.apy).toFixed(2)}%</span> : "—" },
          { key: "chains", label: "Chains", render: (r) => (r.chains as string[]).map(chainLabel).join(", ") || "—" },
          { key: "status", label: "Status", render: (r) => <span style={{ color: r.status !== "active" ? "#f5a623" : "var(--muted-fg)" }}>{String(r.status)}</span> },
        ]} />
      </Section>

      <Section title="Morpho markets">
        <SortableTable initial="tvl" rows={d.markets} cols={[
          { key: "market", label: "Market" },
          { key: "tvl", label: "TVL", num: true, render: (r) => usd(Number(r.tvl)) },
          { key: "lltv", label: "LLTV", num: true, render: (r) => `${r.lltv}%` },
          { key: "util", label: "Util", num: true, render: (r) => <span style={{ color: Number(r.util) >= 90 ? "#eb365a" : "var(--fg)" }}>{Number(r.util).toFixed(0)}%</span> },
          { key: "sapy", label: "Supply APY", num: true, render: (r) => <span style={{ color: "#02c77b" }}>{Number(r.sapy).toFixed(2)}%</span> },
          { key: "bapy", label: "Borrow APY", num: true, render: (r) => <span style={{ color: "#f5a623" }}>{Number(r.bapy).toFixed(2)}%</span> },
          { key: "oracle", label: "Oracle", render: (r) => { const n = r.n as GraphNode; return n.oracleAddr ? <a className="text-primary hover:underline" href={explorerAddr(n.chain, n.oracleAddr)} target="_blank" rel="noreferrer">{oracleVendor(n.oracleType, n.oracleAddr)} ↗</a> : "—"; } },
          { key: "chain", label: "Chain", render: (r) => chainLabel(String(r.chain)) },
        ]} />
      </Section>

      <Section title="Treasury positions">
        {d.positions.length === 0 ? (
          <div className="text-xs text-muted-fg p-2">No treasury positions in this view — load <span className="text-fg">🌐 KPK Footprint</span> (Safe positions are fetched via Zerion).</div>
        ) : (
        <SortableTable initial="tvl" rows={d.positions} cols={[
          { key: "asset", label: "Position" }, { key: "protocol", label: "Protocol" }, { key: "type", label: "Type" },
          { key: "tvl", label: "Value", num: true, render: (r) => usd(Number(r.tvl)) },
          { key: "chain", label: "Chain", render: (r) => chainLabel(String(r.chain)) },
          { key: "addr", label: "Token", render: (r) => { const n = r.n as GraphNode; return n.address ? <a className="text-primary hover:underline" href={explorerAddr(n.chain, n.address)} target="_blank" rel="noreferrer">{shortAddr(n.address)} ↗</a> : "—"; } },
        ]} />
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="By protocol">
          <SortableTable initial="tvl" rows={d.protocols} cols={[
            { key: "protocol", label: "Protocol", render: (r) => <span style={{ color: PROTO_COLOR[String(r.protocol)] ?? "var(--fg)" }}>{String(r.protocol)}</span> },
            { key: "tvl", label: "TVL", num: true, render: (r) => usd(Number(r.tvl)) },
            { key: "pct", label: "%", num: true, render: (r) => `${Number(r.pct).toFixed(1)}%` },
          ]} />
        </Section>
        <Section title="By risk primitive">
          <SortableTable initial="tvl" rows={d.primitives} cols={[
            { key: "asset", label: "Primitive", render: (r) => { const n = r.n as GraphNode; return n.address ? <a className="text-primary hover:underline" href={explorerAddr(undefined, n.address)} target="_blank" rel="noreferrer">{String(r.asset)} ↗</a> : String(r.asset); } },
            { key: "tvl", label: "TVL", num: true, render: (r) => usd(Number(r.tvl)) },
            { key: "pct", label: "%", num: true, render: (r) => `${Number(r.pct).toFixed(1)}%` },
          ]} />
        </Section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, subColor, accent, big }: { label: string; value: string; sub?: string; subColor?: string; accent?: string; big?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] text-muted-fg uppercase tracking-wider">{label}</div>
      <div className={`mono font-semibold ${big ? "text-2xl" : "text-xl"}`} style={{ color: accent ?? "var(--fg)" }}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5 truncate" style={{ color: subColor ?? "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

function Highlight({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="card p-3 border-l-2" style={{ borderLeftColor: color }}>
      <div className="text-[10px] text-muted-fg uppercase tracking-wider">{label}</div>
      <div className="mono text-lg font-semibold" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-muted truncate">{sub}</div>}
    </div>
  );
}

type Slice = { name: string; value: number; fill: string };
function Donut({ title, data }: { title: string; data: Slice[] }) {
  const rows = data.filter((s) => s.value > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="card p-3">
      <div className="text-[10px] text-muted-fg uppercase tracking-wider mb-1">{title}</div>
      <div style={{ height: 210 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={58} outerRadius={92} paddingAngle={1} isAnimationActive={false} stroke="none">
              {rows.map((r, i) => <PieCell key={i} fill={r.fill} />)}
            </Pie>
            <RTooltip
              contentStyle={{ background: "#141416", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 11 }}
              itemStyle={{ color: "#ededf2" }}
              formatter={(v) => { const n = Number(v); return [`${usd(n)} (${total ? ((n / total) * 100).toFixed(1) : 0}%)`, ""]; }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 space-y-0.5">
        {rows.slice(0, 5).map((r, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: r.fill }} />
            <span className="text-muted-fg truncate flex-1">{r.name}</span>
            <span className="mono text-muted">{total ? ((r.value / total) * 100).toFixed(0) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type TreemapProps = { x?: number; y?: number; width?: number; height?: number; name?: string; size?: number; fill?: string };
function TreemapCell({ x = 0, y = 0, width = 0, height = 0, name, size, fill }: TreemapProps) {
  const show = width > 54 && height > 26;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#0a0a0b" strokeWidth={2} rx={3} />
      {show && (
        <>
          <text x={x + 7} y={y + 17} fill="#1a1a1d" fontSize={11} fontWeight={500} className="select-none">
            {String(name).slice(0, Math.floor(width / 7))}
          </text>
          <text x={x + 7} y={y + 31} fill="rgba(26,26,29,0.6)" fontSize={10} className="select-none mono">
            {usd(Number(size))}
          </text>
        </>
      )}
    </g>
  );
}

type TipProps = { active?: boolean; payload?: { payload: { name: string; size: number } }[] };
function TreemapTip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card px-2.5 py-1.5 text-xs shadow-lg">
      <div className="font-medium text-fg">{p.name}</div>
      <div className="mono text-primary">{usd(p.size)}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-2">{title}</h2>
      <div className="card p-2">{children}</div>
    </section>
  );
}
