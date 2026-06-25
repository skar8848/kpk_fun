// Santé des stablecoins via DefiLlama (gratuit, sans clé).
// Annote les nœuds asset avec leur prix de peg + statut depeg, en résolvant
// les wrappers vers leur sous-jacent (wstUSR->USR, sUSDe->USDe) via knowledge.

import { cached } from "./cache";
import { lookup } from "./knowledge";
import type { GraphNode } from "./graph";

const URL = "https://stablecoins.llama.fi/stablecoins?includePrices=true";

async function fetchPegMap(): Promise<Record<string, number>> {
  const res = await fetch(URL, { cache: "no-store" });
  const body = await res.json();
  const items: { symbol?: string; price?: number | null }[] = body.peggedAssets ?? [];
  const map: Record<string, number> = {};
  for (const a of items) {
    if (a.symbol && a.price != null) map[a.symbol.toLowerCase()] = a.price;
  }
  return map;
}

export async function getPegMap(): Promise<Record<string, number>> {
  const { data } = await cached("pegmap", 10 * 60 * 1000, fetchPegMap);
  return data;
}

// résout un symbole -> prix de peg (direct, ou via sous-jacent stable)
export function resolvePeg(symbol: string, map: Record<string, number>, depth = 0): number | undefined {
  const s = symbol.toLowerCase();
  if (map[s] != null) return map[s];
  if (depth > 4) return undefined;
  for (const u of lookup(s)?.underlying ?? []) {
    const p = resolvePeg(u, map, depth + 1);
    if (p != null) return p;
  }
  return undefined;
}

export async function annotatePeg(nodes: GraphNode[]) {
  const map = await getPegMap();
  for (const n of nodes) {
    if (n.kind !== "asset") continue;
    const price = resolvePeg(n.label, map);
    if (price == null) continue;
    n.pegPrice = price;
    const dev = (price - 1) * 100;
    n.pegDeviationPct = Math.round(dev * 100) / 100;
    if (Math.abs(dev) > 10) n.severity = "RED";
    else if (Math.abs(dev) > 2 && n.severity !== "RED") n.severity = "YELLOW";
  }
}
