import { NextRequest, NextResponse } from "next/server";
import { compare, compareAllVaults, type CompareRow } from "@/lib/comparator";
import { cached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TTL = 10 * 60 * 1000;
const MULTI = ["ethereum", "base", "arbitrum"];

// ?chain=all|ethereum  ·  ?all=1 (paginé)  ·  ?kpk=1  ·  ?asset=USDC  ·  ?search=gauntlet  ·  ?vaults=0x..  ·  ?fresh=1
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chainParam = (searchParams.get("chain") ?? "all").trim();
  const chains = chainParam === "all" ? MULTI : [chainParam];
  const force = searchParams.get("fresh") === "1";
  const all = searchParams.get("all") === "1";
  const kpk = searchParams.get("kpk") === "1";
  const asset = searchParams.get("asset")?.trim() || undefined;
  const assets = (searchParams.get("assets") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const search = searchParams.get("search")?.trim() || undefined;
  const vaults = (searchParams.get("vaults") ?? "").split(",").map((s) => s.trim()).filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
  const limit = Math.min(30, Math.max(5, Number(searchParams.get("limit") ?? 15)));
  const skip = Math.max(0, Number(searchParams.get("skip") ?? 0));

  if (!all && !kpk && !asset && !assets.length && !search && !vaults.length) {
    return NextResponse.json({ error: "provide ?all=1, ?kpk=1, ?asset=USDC, ?search=… or ?vaults=0x…" }, { status: 400 });
  }

  const key = `cmp:v3:${chainParam}:${all ? `all:${skip}:${limit}` : ""}:${kpk ? "kpk" : ""}:${asset ?? ""}:${assets.sort().join("+")}:${search ?? ""}:${vaults.sort().join(",")}`;
  try {
    const { data, cachedAt, fresh } = await cached(key, TTL, async () => {
      const per = await Promise.all(chains.map(async (chain) => {
        if (all) return compareAllVaults(chain, skip, limit);
        const rows = await compare({ chain, asset, assets, search, vaults, kpk });
        return { rows, total: rows.length };
      }));
      const rows: CompareRow[] = per.flatMap((r) => r.rows);
      rows.sort((a, b) => b.riskAdjApyPct - a.riskAdjApyPct);
      return { rows, total: per.reduce((s, r) => s + r.total, 0) };
    }, force);
    return NextResponse.json({ ...data, skip, limit, cachedAt, fromCache: fresh });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
