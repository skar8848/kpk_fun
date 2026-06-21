import { NextRequest, NextResponse } from "next/server";
import { getVault } from "@/lib/morpho";
import { decompose } from "@/lib/decompose";
import { buildGraph } from "@/lib/graph";
import type { ScanReport } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ?address=0x..&chain=ethereum  (un vault)
// ?addresses=0xaaa,0xbbb&chain=ethereum  (plusieurs, footprint agrégé)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = (searchParams.get("chain") ?? "ethereum").trim();
  const raw = searchParams.get("addresses") ?? searchParams.get("address") ?? "";
  const addrs = raw.split(",").map((s) => s.trim()).filter(Boolean);

  const valid = addrs.filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
  if (!valid.length) {
    return NextResponse.json({ error: "aucune adresse de vault valide" }, { status: 400 });
  }

  const reports: ScanReport[] = [];
  const skipped: { address: string; reason: string }[] = [];
  await Promise.all(
    valid.map(async (a) => {
      try {
        reports.push(decompose(await getVault(a, chain)));
      } catch (e) {
        skipped.push({ address: a, reason: String(e instanceof Error ? e.message : e) });
      }
    }),
  );

  if (!reports.length) {
    return NextResponse.json({ error: "aucun vault décomposable", skipped }, { status: 502 });
  }

  const graph = buildGraph(reports);
  return NextResponse.json({ graph, skipped, reports });
}
