import { NextRequest, NextResponse } from "next/server";
import { compare, compareAllVaults } from "@/lib/comparator";
import { cached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL = 10 * 60 * 1000;

// ?asset=USDC&chain=ethereum  (auto-discovery)  ·  ?vaults=0x..,0x..&chain=..  ·  ?fresh=1
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = (searchParams.get("chain") ?? "ethereum").trim();
  const force = searchParams.get("fresh") === "1";

  // mode "all vaults" paginé
  if (searchParams.get("all") === "1") {
    const limit = Math.min(30, Math.max(5, Number(searchParams.get("limit") ?? 15)));
    const skip = Math.max(0, Number(searchParams.get("skip") ?? 0));
    const key = `compare:all:${chain}:${skip}:${limit}`;
    try {
      const { data, cachedAt, fresh } = await cached(key, TTL, () => compareAllVaults(chain, skip, limit), force);
      return NextResponse.json({ ...data, skip, limit, cachedAt, fromCache: fresh });
    } catch (e) {
      return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
    }
  }

  const asset = searchParams.get("asset")?.trim() || undefined;
  const assets = (searchParams.get("assets") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const search = searchParams.get("search")?.trim() || undefined;
  const vaults = (searchParams.get("vaults") ?? "").split(",").map((s) => s.trim())
    .filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));

  if (!asset && !assets.length && !vaults.length && !search) {
    return NextResponse.json({ error: "provide ?asset=USDC, ?search=gauntlet or ?vaults=0x..." }, { status: 400 });
  }

  const key = `compare:${chain}:${asset ?? ""}:${assets.sort().join("+")}:${search ?? ""}:${vaults.sort().join(",")}`;
  try {
    const { data, cachedAt, fresh } = await cached(key, TTL, () => compare({ chain, asset, assets, search, vaults }), force);
    return NextResponse.json({ rows: data, cachedAt, fromCache: fresh });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
