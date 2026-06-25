import { NextRequest, NextResponse } from "next/server";
import { getVault } from "@/lib/morpho";
import { decompose } from "@/lib/decompose";
import { buildGraph } from "@/lib/graph";
import { cached } from "@/lib/cache";
import { annotatePeg } from "@/lib/stablecoins";
import type { ScanReport } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL = 30 * 60 * 1000;

// ?address=0x..&chain=ethereum  (un vault)  ·  ?addresses=0xaaa,0xbbb (agrégé)  ·  ?fresh=1 (bypass cache)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = (searchParams.get("chain") ?? "ethereum").trim();
  const raw = searchParams.get("addresses") ?? searchParams.get("address") ?? "";
  const force = searchParams.get("fresh") === "1";
  const valid = raw.split(",").map((s) => s.trim()).filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
  if (!valid.length) {
    return NextResponse.json({ error: "aucune adresse de vault valide" }, { status: 400 });
  }

  const key = `graph:${chain}:${valid.map((a) => a.toLowerCase()).sort().join(",")}`;
  try {
    const { data, cachedAt, fresh } = await cached(key, TTL, async () => {
      const reports: ScanReport[] = [];
      const skipped: { address: string; reason: string }[] = [];
      await Promise.all(
        valid.map(async (a) => {
          try { reports.push(decompose(await getVault(a, chain))); }
          catch (e) { skipped.push({ address: a, reason: String(e instanceof Error ? e.message : e) }); }
        }),
      );
      if (!reports.length) throw new Error(skipped[0]?.reason ?? "aucun vault décomposable");
      const graph = buildGraph(reports);
      await annotatePeg(graph.nodes);
      return { graph, skipped, reports };
    }, force);
    return NextResponse.json({ ...data, cachedAt, fromCache: fresh });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
