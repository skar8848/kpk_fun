import { NextRequest, NextResponse } from "next/server";
import { compare } from "@/lib/comparator";
import { cached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL = 10 * 60 * 1000;

// ?asset=USDC&chain=ethereum  (auto-discovery)  ·  ?vaults=0x..,0x..&chain=..  ·  ?fresh=1
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = (searchParams.get("chain") ?? "ethereum").trim();
  const asset = searchParams.get("asset")?.trim() || undefined;
  const force = searchParams.get("fresh") === "1";
  const vaults = (searchParams.get("vaults") ?? "").split(",").map((s) => s.trim())
    .filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));

  if (!asset && !vaults.length) {
    return NextResponse.json({ error: "provide ?asset=USDC or ?vaults=0x..." }, { status: 400 });
  }

  const key = `compare:${chain}:${asset ?? ""}:${vaults.sort().join(",")}`;
  try {
    const { data, cachedAt, fresh } = await cached(key, TTL, () => compare({ chain, asset, vaults }), force);
    return NextResponse.json({ rows: data, cachedAt, fromCache: fresh });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
