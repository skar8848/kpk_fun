"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { explorerAddr, shortAddr, morphoUrl } from "@/lib/explorer";
import type { CompareRow, ScoreFactor } from "@/lib/comparator";

function usd(n?: number) {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
const scoreColor = (s: number) => (s >= 75 ? "#02c77b" : s >= 50 ? "#f5a623" : "#eb365a");
const PRESETS = ["USDC", "WETH", "USDT", "EURC", "EURCV"];
const CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon"];

type Col = { key: string; label: string; num?: boolean; render?: (r: CompareRow) => React.ReactNode };

export default function Comparator() {
  const [asset, setAsset] = useState("USDC");
  const [chain, setChain] = useState("ethereum");
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bench, setBench] = useState<"ALL" | "USD" | "ETH" | "EUR">("ALL");
  const [sortKey, setSortKey] = useState<string>("riskAdjApyPct");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<"all" | "search">("all");
  const [skip, setSkip] = useState(0);
  const [total, setTotal] = useState(0);
  const LIMIT = 15;
  const rk = (r: CompareRow) => `${r.kind}:${r.id}`;

  const fetchUrl = useCallback(async (url: string) => {
    setLoading(true); setError(null); setExpanded(null);
    try {
      const res = await fetch(url);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "error");
      setRows(d.rows);
      if (typeof d.total === "number") setTotal(d.total);
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setLoading(false); }
  }, []);

  const loadAll = useCallback((c: string, s: number) => {
    setMode("all"); setSkip(s);
    fetchUrl(`/api/compare?all=1&chain=${c}&skip=${s}&limit=${15}`);
  }, [fetchUrl]);

  const loadSearch = useCallback((a: string, c: string) => {
    setMode("search");
    const q = a.trim();
    const param = /^0x[a-fA-F0-9]{40}$/.test(q) ? `vaults=${q}` : `asset=${q}`;
    fetchUrl(`/api/compare?${param}&chain=${c}`);
  }, [fetchUrl]);

  useEffect(() => { loadAll("ethereum", 0); }, [loadAll]);

  const cols: Col[] = [
    { key: "exp", label: "", render: (r) => (r.kind === "vault" && r.allocations?.length ? <button onClick={() => setExpanded((e) => (e === rk(r) ? null : rk(r)))} title="decompose vault allocations" className="text-muted-fg hover:text-primary">{expanded === rk(r) ? "▾" : "⛓"}</button> : null) },
    { key: "label", label: "Name", render: (r) => <a className="font-medium text-primary hover:underline" href={morphoUrl(r.kind, r.chain, r.id)} target="_blank" rel="noreferrer">{r.label} ↗</a> },
    { key: "kind", label: "Type" },
    { key: "curatorName", label: "Curator", render: (r) => (r.curatorAddr ? <a className="text-primary hover:underline" href={explorerAddr(r.chain, r.curatorAddr)} target="_blank" rel="noreferrer">{r.curatorName ?? shortAddr(r.curatorAddr)} ↗</a> : "—") },
    { key: "chain", label: "Chain" },
    { key: "benchmark", label: "Bench" },
    { key: "netApyPct", label: "Net APY", num: true, render: (r) => <span style={{ color: "#02c77b" }}>{r.netApyPct.toFixed(2)}%</span> },
    { key: "riskAdjApyPct", label: "Risk-Adj APY", num: true, render: (r) => <span className="font-semibold">{r.riskAdjApyPct.toFixed(2)}%</span> },
    { key: "score", label: "Risk", num: true, render: (r) => <RiskChip row={r} /> },
    { key: "utilPct", label: "Util", num: true, render: (r) => (r.utilPct != null ? <span style={{ color: r.utilPct > 95 ? "#eb365a" : undefined }}>{r.utilPct}%</span> : "—") },
    { key: "lltvPct", label: "LLTV", num: true, render: (r) => (r.lltvPct != null ? `${r.lltvPct}%` : "—") },
    { key: "tvlUsd", label: "TVL", num: true, render: (r) => usd(r.tvlUsd) },
    { key: "liquidityUsd", label: "Liquidity", num: true, render: (r) => usd(r.liquidityUsd) },
    { key: "oracleVendor", label: "Oracle", render: (r) => (r.oracleAddr ? <a className="text-primary hover:underline" href={explorerAddr(r.chain, r.oracleAddr)} target="_blank" rel="noreferrer">{r.oracleVendor} ↗</a> : "—") },
    { key: "collateral", label: "Collateral", render: (r) => (r.collateral ? <a className="text-primary hover:underline" href={explorerAddr(r.chain, r.collateral.address)} target="_blank" rel="noreferrer">{r.collateral.symbol} ↗</a> : "—") },
  ];

  const view = useMemo(() => {
    const filtered = bench === "ALL" ? rows : rows.filter((r) => r.benchmark === bench);
    const c = cols.find((x) => x.key === sortKey);
    const val = (r: CompareRow) => (sortKey === "score" ? r.riskScore : (r as unknown as Record<string, unknown>)[sortKey]);
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (c?.num || sortKey === "score") return (Number(vb) - Number(va)) * -dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * -dir;
    });
  }, [rows, bench, sortKey, dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const click = (k: string) => { if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setDir(-1); } };

  return (
    <div className="h-full overflow-y-auto px-5 py-5 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1 className="text-xl font-semibold">Vault & Market <span className="text-primary">Comparator</span></h1>
        <input value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="asset (USDC) or 0x vault…"
          onKeyDown={(e) => e.key === "Enter" && loadSearch(asset, chain)}
          className="w-52 bg-bg border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-primary" />
        <select value={chain} onChange={(e) => setChain(e.target.value)} className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm outline-none">
          {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => loadSearch(asset, chain)} disabled={loading} className="bg-primary text-bg font-medium rounded-lg px-4 py-1.5 text-sm disabled:opacity-50">{loading ? "…" : "Compare"}</button>
        <button onClick={() => loadAll(chain, 0)} disabled={loading} className={`rounded-lg px-3 py-1.5 text-sm border ${mode === "all" ? "border-primary text-primary" : "border-border text-muted-fg"}`}>All vaults</button>
        {PRESETS.map((p) => <button key={p} onClick={() => { setAsset(p); loadSearch(p, chain); }} className="text-xs text-muted-fg hover:text-primary border border-border rounded-full px-3 py-1">{p}</button>)}
        <div className="flex-1" />
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {(["ALL", "USD", "ETH", "EUR"] as const).map((b) => (
            <button key={b} onClick={() => setBench(b)} className={`px-2.5 py-1.5 ${bench === b ? "bg-primary text-bg" : "text-muted-fg"}`}>{b}</button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-fg mb-3">
        Sorted by <span className="text-fg">Risk-Adjusted APY</span> = net APY × (risk score / 100). Hover a risk score to audit its factors.
        Net APY is always <span className="text-fg">after fees + rewards</span>.
      </p>

      {error && <div className="text-red text-sm mb-3">{error}</div>}

      <div className="card p-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted uppercase tracking-wider text-[10px] text-left">
              {cols.map((c) => (
                <th key={String(c.key)} onClick={() => click(String(c.key))} className={`py-1.5 px-2 cursor-pointer hover:text-fg select-none ${c.num ? "text-right" : ""}`}>
                  {c.label}{sortKey === c.key ? (dir === -1 ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <Fragment key={rk(r)}>
                <tr className="border-t border-border hover:bg-[rgba(255,255,255,0.02)]">
                  {cols.map((c) => (
                    <td key={String(c.key)} className={`py-1.5 px-2 ${c.num ? "text-right mono" : ""}`}>
                      {c.render ? c.render(r) : String((r as unknown as Record<string, unknown>)[c.key as string] ?? "—")}
                    </td>
                  ))}
                </tr>
                {expanded === rk(r) && r.allocations?.length && (
                  <tr className="border-t border-border">
                    <td colSpan={cols.length} className="px-4 py-3" style={{ background: "rgba(255,255,255,0.02)" }}>
                      <div className="text-[10px] text-muted-fg uppercase tracking-wider mb-2">Vault allocations (Morpho) — {r.allocations.length} markets</div>
                      <AllocTable allocations={r.allocations} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!view.length && !loading && <tr><td className="py-3 px-2 text-muted-fg" colSpan={cols.length}>No rows.</td></tr>}
          </tbody>
        </table>
      </div>

      {mode === "all" && total > 0 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <button onClick={() => loadAll(chain, Math.max(0, skip - LIMIT))} disabled={loading || skip === 0}
            className="border border-border rounded-lg px-3 py-1.5 disabled:opacity-40">← Prev</button>
          <span className="text-muted-fg">{skip + 1}–{Math.min(skip + LIMIT, total)} of {total} vaults</span>
          <button onClick={() => loadAll(chain, skip + LIMIT)} disabled={loading || skip + LIMIT >= total}
            className="border border-border rounded-lg px-3 py-1.5 disabled:opacity-40">Next →</button>
        </div>
      )}
    </div>
  );
}

function AllocTable({ allocations }: { allocations: NonNullable<CompareRow["allocations"]> }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-muted uppercase tracking-wider text-[9px] text-left">
          <th className="py-1 px-2">Market</th><th className="py-1 px-2 text-right">Weight</th>
          <th className="py-1 px-2 text-right">Supply</th><th className="py-1 px-2 text-right">Net APY</th>
          <th className="py-1 px-2 text-right">LLTV</th><th className="py-1 px-2 text-right">Util</th><th className="py-1 px-2">Oracle</th>
        </tr>
      </thead>
      <tbody>
        {allocations.map((a, i) => (
          <tr key={i} className="border-t border-border">
            <td className="py-1 px-2 mono">{a.label}</td>
            <td className="py-1 px-2 text-right mono font-semibold">{a.weightPct}%</td>
            <td className="py-1 px-2 text-right mono">{usd(a.supplyUsd)}</td>
            <td className="py-1 px-2 text-right mono" style={{ color: "#02c77b" }}>{a.netApyPct}%</td>
            <td className="py-1 px-2 text-right mono">{a.lltvPct}%</td>
            <td className="py-1 px-2 text-right mono" style={{ color: (a.utilPct ?? 0) > 95 ? "#eb365a" : undefined }}>{a.utilPct ?? "—"}%</td>
            <td className="py-1 px-2">{a.oracleVendor}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RiskChip({ row }: { row: CompareRow }) {
  const [up, setUp] = useState(false);
  return (
    <span className="group relative inline-block"
      onMouseEnter={(e) => setUp(window.innerHeight - e.currentTarget.getBoundingClientRect().bottom < 260)}>
      <span className="rounded px-1.5 py-0.5 font-semibold cursor-help" style={{ color: scoreColor(row.riskScore), border: `1px solid ${scoreColor(row.riskScore)}` }}>
        {row.riskScore}
      </span>
      <div className={`hidden group-hover:block absolute right-0 ${up ? "bottom-full mb-1" : "top-full mt-1"} z-30 w-64 card p-2.5 text-left normal-case tracking-normal`}>
        <div className="text-[10px] text-muted-fg mb-1">Risk score = weighted avg ({row.riskScore}/100)</div>
        {row.factors.map((f: ScoreFactor) => (
          <div key={f.key} className="flex justify-between gap-2 text-[11px] py-0.5">
            <span className="text-muted-fg">{f.label}</span>
            <span className="mono">{f.raw} → <span style={{ color: scoreColor(f.score) }}>{f.score}</span> ×{f.weight}%</span>
          </div>
        ))}
        <div className="text-[10px] text-muted pt-1">Risk-Adj APY = {row.netApyPct}% × {row.riskScore}/100 = {row.riskAdjApyPct}%</div>
      </div>
    </span>
  );
}

