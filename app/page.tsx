"use client";

import { useState } from "react";
import type { ScanReport, TreeNode, Position } from "@/lib/types";

const PRESETS = [
  { name: "Smokehouse USDC", addr: "0xBEeFFF209270748ddd194831b3fa287a5386f5bC", chain: "ethereum" },
  { name: "Steakhouse USDC", addr: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB", chain: "ethereum" },
  { name: "Gauntlet USDC Prime", addr: "0xdd0f28e19C1780eb6396170735D45153D261490d", chain: "ethereum" },
  { name: "kpk USDC Yield (v1)", addr: "0x9178eBE0691593184c1D785a864B62a326cc3509", chain: "ethereum" },
];

const CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "unichain", "katana"];

function usd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

const sevColor: Record<string, string> = {
  RED: "var(--red)", YELLOW: "var(--yellow)", OK: "var(--green)",
};

export default function Home() {
  const [addr, setAddr] = useState(PRESETS[0].addr);
  const [chain, setChain] = useState("ethereum");
  const [report, setReport] = useState<ScanReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan(a = addr, c = chain) {
    setLoading(true); setError(null); setReport(null);
    try {
      const res = await fetch(`/api/scan?address=${a}&chain=${c}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "erreur");
      setReport(data);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-5 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          KPK <span className="text-primary">Contagion Scanner</span>
        </h1>
        <p className="text-muted-fg text-sm mt-1 max-w-2xl">
          Décompose l&apos;exposition <span className="text-fg">transitive</span> d&apos;un vault Morpho
          jusqu&apos;aux primitives de risque. <span className="mono">sUSDe → USDe (delta-neutral Ethena) → USDT</span>.
          Détecte loops, leverage implicite et oracles fragiles (leçon Resolv).
        </p>
      </header>

      <div className="card p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="0x… adresse de vault Morpho v1"
            className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm mono outline-none focus:border-primary"
          />
          <select
            value={chain}
            onChange={(e) => setChain(e.target.value)}
            className="bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => scan()}
            disabled={loading}
            className="bg-primary text-bg font-medium rounded-lg px-5 py-2 text-sm disabled:opacity-50"
          >
            {loading ? "Scan…" : "Scanner"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {PRESETS.map((p) => (
            <button
              key={p.addr}
              onClick={() => { setAddr(p.addr); setChain(p.chain); scan(p.addr, p.chain); }}
              className="text-xs text-muted-fg hover:text-primary border border-border rounded-full px-3 py-1"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card p-4 mb-6 border-l-2" style={{ borderLeftColor: "var(--red)" }}>
          <span className="text-red text-sm">{error}</span>
        </div>
      )}

      {report && <Report report={report} />}
    </main>
  );
}

function Report({ report }: { report: ScanReport }) {
  const top = report.transitive_exposure.filter((r) => r.usd > 0).slice(0, 10);
  const maxPct = Math.max(...top.map((r) => r.pct), 1);
  return (
    <div className="space-y-6">
      <div className="card p-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <span className="font-medium">{report.vault.name}</span>
            <span className="text-muted-fg text-xs ml-2">{report.vault.version} · {report.vault.chain}</span>
          </div>
          <span className="mono text-primary text-lg">{usd(report.tvlUsd)}</span>
        </div>
        <div className="mono text-xs text-muted mt-1 break-all">{report.vault.address}</div>
      </div>

      <Section title="Exposition transitive" subtitle="primitives de risque, récursion dépliée">
        <div className="space-y-1.5">
          {top.map((r) => (
            <div key={r.name} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 mono">{r.name}</span>
              <div className="flex-1 h-5 bg-bg rounded overflow-hidden">
                <div className="h-full rounded" style={{ width: `${(r.pct / maxPct) * 100}%`, background: "var(--primary)" }} />
              </div>
              <span className="w-14 text-right mono text-muted-fg">{r.pct.toFixed(1)}%</span>
              <span className="w-16 text-right mono">{usd(r.usd)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Exposition par protocole" subtitle="tous les niveaux de la chaîne">
        <div className="flex flex-wrap gap-2">
          {report.protocol_exposure.filter((r) => r.usd > 0).map((r) => (
            <span key={r.name} className="text-xs border border-border rounded-full px-3 py-1">
              <span className="text-fg">{r.name}</span>{" "}
              <span className="text-muted-fg mono">{r.pct.toFixed(1)}% · {usd(r.usd)}</span>
            </span>
          ))}
        </div>
      </Section>

      {Object.keys(report.oracle_contagion).length > 0 && (
        <Section title="Contagion oracle" subtitle="si l'hypothèse casse → $ exposés">
          <div className="space-y-1.5">
            {Object.entries(report.oracle_contagion).map(([k, b]) => {
              const risky = !k.startsWith("peg_assumption");
              return (
                <div key={k} className="flex items-center justify-between text-sm gap-3">
                  <span className="mono" style={{ color: risky ? "var(--yellow)" : "var(--muted-fg)" }}>{k}</span>
                  <span className="text-muted-fg text-xs flex-1 truncate">{b.examples.slice(0, 3).join(", ")}</span>
                  <span className="mono">{b.markets} mkts</span>
                  <span className="mono w-16 text-right">{usd(b.usd)}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {report.loops.length > 0 && (
        <Section title="Structures de carry / loop" subtitle="collat partage l'underlying du loan">
          <div className="space-y-1 text-sm">
            {report.loops.map((l, i) => (
              <div key={i} className="flex justify-between mono">
                <span>{l.market}</span>
                <span className="text-muted-fg">LLTV {l.lltv_pct}% → ≤ {l.max_leverage_x ?? "?"}x</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Positions" subtitle="collatéral → arbre de dépendances">
        <div className="space-y-3">
          {report.positions.filter((p) => p.usd > 0).slice(0, 20).map((p, i) => (
            <PositionCard key={i} p={p} />
          ))}
        </div>
      </Section>

      {report.unmapped.length > 0 && (
        <div className="card p-4 border-l-2" style={{ borderLeftColor: "var(--yellow)" }}>
          <div className="text-yellow text-sm font-medium mb-1">⚠ Collatéraux non mappés</div>
          <div className="text-muted-fg text-xs">
            Pas de faux négatif silencieux — à ajouter à <span className="mono">knowledge.ts</span> :{" "}
            <span className="mono text-fg">{report.unmapped.join(", ")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PositionCard({ p }: { p: Position }) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: sevColor[p.oracle.severity] }} />
          <span className="font-medium mono">{p.label}</span>
        </div>
        <span className="mono text-muted-fg">{usd(p.usd)} · {p.pct}% · LLTV {p.lltv_pct}%</span>
      </div>
      {p.oracle.flags.length > 0 && (
        <div className="text-xs mt-1.5" style={{ color: sevColor[p.oracle.severity] }}>
          oracle: {p.oracle.flags.join(", ")}
        </div>
      )}
      <div className="mt-2 pl-1">
        <TreeView node={p.tree} root />
      </div>
    </div>
  );
}

function TreeView({ node, root = false }: { node: TreeNode; root?: boolean }) {
  const tags: string[] = [];
  if (node.protocol && node.protocol !== "-" && node.protocol !== "?") tags.push(node.protocol);
  if (node.mechanism) tags.push(node.mechanism);
  return (
    <div className={root ? "" : "ml-4 border-l border-border pl-3"}>
      <div className="text-xs flex items-center gap-2 flex-wrap py-0.5">
        <span className="mono text-fg">{node.symbol}</span>
        <span className="mono text-muted">{usd(node.usd)}</span>
        {tags.map((t) => (
          <span key={t} className="text-[10px] text-muted-fg border border-border rounded px-1">{t}</span>
        ))}
        {node.risk && <span className="text-[10px] text-yellow">⚠ {node.risk}</span>}
        {node.unmapped && <span className="text-[10px] text-red">❓ UNMAPPED</span>}
      </div>
      {node.children.map((c, i) => <TreeView key={i} node={c} />)}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fg">{title}</h2>
        {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      </div>
      <div className="card p-4">{children}</div>
    </section>
  );
}
