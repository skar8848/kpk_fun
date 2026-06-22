"use client";

import { useMemo, useState } from "react";
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
  const click = (k: string) => { if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setDir(-1); } };
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
  const { tvl, entities, markets, positions, protocols, primitives } = useMemo(() => {
    const out = new Set(graph.edges.map((e) => e.source));
    const N = graph.nodes;
    const tvl = N.find((n) => n.kind === "root")?.usd ?? 0;
    const entities = N.filter((n) => n.kind === "entity").map((n) => ({
      dao: n.dao ?? "Curated Vaults", name: n.label, usd: n.usd, pct: n.pct ?? 0,
      chains: (n.chains ?? (n.chain ? [n.chain] : [])).join(", "), status: n.note ?? (n.pending ? "no positions" : "active"),
      apy: n.vaultApyPct ?? null, n,
    }));
    const morpho = N.filter((n) => n.kind === "market" && n.lltvPct != null).map((n) => ({
      market: n.label, tvl: n.usd, pct: n.pct ?? 0, lltv: n.lltvPct, util: n.utilPct ?? 0,
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
    const protocols = Object.entries(protoMap).map(([protocol, v]) => ({ protocol, tvl: v, pct: tvl ? (1000 * v / tvl) / 10 : 0 }));
    const primitives = Object.entries(primMap).map(([asset, o]) => ({ asset, tvl: o.usd, pct: tvl ? (1000 * o.usd / tvl) / 10 : 0, n: o.n }));
    return { tvl, entities, markets: morpho, positions, protocols, primitives };
  }, [graph]);

  return (
    <div className="h-full overflow-y-auto px-5 py-5 max-w-6xl mx-auto space-y-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">KPK Footprint <span className="text-muted-fg text-sm">dashboard</span></h1>
        <span className="mono text-primary text-xl">{usd(tvl)}</span>
        <span className="text-muted text-xs">mapped TVL</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {DUNE.map((d) => (
          <a key={d.u} href={d.u} target="_blank" rel="noreferrer" className="card p-3 hover:border-primary transition-colors">
            <div className="text-[10px] text-muted-fg uppercase tracking-wider">KPK on Dune ↗</div>
            <div className="text-sm font-medium">{d.t}</div>
          </a>
        ))}
        <div className="card p-3 opacity-60">
          <div className="text-[10px] text-muted-fg uppercase tracking-wider">SQL simulator</div>
          <div className="text-sm font-medium">coming soon</div>
        </div>
      </div>

      <Section title="By DAO / entity">
        <SortableTable initial="usd" rows={entities} cols={[
          { key: "dao", label: "DAO" }, { key: "name", label: "Entity" },
          { key: "usd", label: "TVL", num: true, render: (r) => usd(Number(r.usd)) },
          { key: "pct", label: "%", num: true, render: (r) => `${Number(r.pct).toFixed(1)}%` },
          { key: "apy", label: "Net APY", num: true, render: (r) => r.apy != null ? <span style={{ color: "#02c77b" }}>{Number(r.apy).toFixed(2)}%</span> : "—" },
          { key: "chains", label: "Chains" },
          { key: "status", label: "Status", render: (r) => <span style={{ color: r.status !== "active" ? "#f5a623" : "var(--muted-fg)" }}>{String(r.status)}</span> },
        ]} />
      </Section>

      <Section title="Morpho markets">
        <SortableTable initial="tvl" rows={markets} cols={[
          { key: "market", label: "Market" },
          { key: "tvl", label: "TVL", num: true, render: (r) => usd(Number(r.tvl)) },
          { key: "lltv", label: "LLTV", num: true, render: (r) => `${r.lltv}%` },
          { key: "util", label: "Util", num: true, render: (r) => `${Number(r.util).toFixed(0)}%` },
          { key: "sapy", label: "Supply APY", num: true, render: (r) => <span style={{ color: "#02c77b" }}>{Number(r.sapy).toFixed(2)}%</span> },
          { key: "bapy", label: "Borrow APY", num: true, render: (r) => <span style={{ color: "#f5a623" }}>{Number(r.bapy).toFixed(2)}%</span> },
          { key: "oracle", label: "Oracle", render: (r) => { const n = r.n as GraphNode; return n.oracleAddr ? <a className="text-primary hover:underline" href={explorerAddr(n.chain, n.oracleAddr)} target="_blank" rel="noreferrer">{oracleVendor(n.oracleType, n.oracleAddr)} ↗</a> : "—"; } },
          { key: "chain", label: "Chain", render: (r) => chainLabel(String(r.chain)) },
        ]} />
      </Section>

      <Section title="Treasury positions">
        {positions.length === 0 ? (
          <div className="text-xs text-muted-fg p-2">No treasury positions in this view — load <span className="text-fg">🌐 KPK Footprint</span> (Safe positions are fetched via Zerion).</div>
        ) : (
        <SortableTable initial="tvl" rows={positions} cols={[
          { key: "asset", label: "Position" }, { key: "protocol", label: "Protocol" }, { key: "type", label: "Type" },
          { key: "tvl", label: "Value", num: true, render: (r) => usd(Number(r.tvl)) },
          { key: "chain", label: "Chain", render: (r) => chainLabel(String(r.chain)) },
          { key: "addr", label: "Token", render: (r) => { const n = r.n as GraphNode; return n.address ? <a className="text-primary hover:underline" href={explorerAddr(n.chain, n.address)} target="_blank" rel="noreferrer">{shortAddr(n.address)} ↗</a> : "—"; } },
        ]} />
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="By protocol">
          <SortableTable initial="tvl" rows={protocols} cols={[
            { key: "protocol", label: "Protocol" },
            { key: "tvl", label: "TVL", num: true, render: (r) => usd(Number(r.tvl)) },
            { key: "pct", label: "%", num: true, render: (r) => `${Number(r.pct).toFixed(1)}%` },
          ]} />
        </Section>
        <Section title="By risk primitive">
          <SortableTable initial="tvl" rows={primitives} cols={[
            { key: "asset", label: "Primitive", render: (r) => { const n = r.n as GraphNode; return n.address ? <a className="text-primary hover:underline" href={explorerAddr(undefined, n.address)} target="_blank" rel="noreferrer">{String(r.asset)} ↗</a> : String(r.asset); } },
            { key: "tvl", label: "TVL", num: true, render: (r) => usd(Number(r.tvl)) },
            { key: "pct", label: "%", num: true, render: (r) => `${Number(r.pct).toFixed(1)}%` },
          ]} />
        </Section>
      </div>
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
