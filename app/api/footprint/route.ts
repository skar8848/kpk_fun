import { NextRequest, NextResponse } from "next/server";
import { getVaultV1, getVaultV2 } from "@/lib/morpho";
import { decompose } from "@/lib/decompose";
import { buildFootprint } from "@/lib/footprint";
import { KPK_SAFES, KPK_VAULTS } from "@/lib/kpkEntities";
import { getSafePositions, mapLimited, type ZPosition } from "@/lib/zerion";
import { cached } from "@/lib/cache";
import { annotatePeg } from "@/lib/stablecoins";
import type { ScanReport } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL = 5 * 60 * 1000;

async function computeFootprint() {
  const vaultReports: ScanReport[] = [];
  const skipped: { address: string; reason: string }[] = [];

  await Promise.all(
    KPK_VAULTS.map(async (v) => {
      try {
        const norm = v.version === "v1"
          ? await getVaultV1(v.address, v.chain)
          : await getVaultV2(v.address, v.chain);
        vaultReports.push(decompose(norm));
      } catch (e) {
        skipped.push({ address: v.address, reason: String(e instanceof Error ? e.message : e) });
      }
    }),
  );

  const key = process.env.ZERION_API_KEY;
  let safePositions: Record<string, ZPosition[]> | undefined;
  let zerion = false;
  if (key) {
    zerion = true;
    safePositions = {};
    const results = await mapLimited(KPK_SAFES, 4, (s) =>
      getSafePositions(s.avatar, s.chains, key).then((pos) => ({ avatar: s.avatar.toLowerCase(), pos })),
    );
    for (const r of results) safePositions[r.avatar] = r.pos;
  }

  const graph = buildFootprint({ vaultReports, v2vaults: [], safes: KPK_SAFES, safePositions });
  await annotatePeg(graph.nodes);
  return { graph, skipped, zerion, counts: { safes: KPK_SAFES.length, vaults: vaultReports.length } };
}

export async function GET(req: NextRequest) {
  const force = new URL(req.url).searchParams.get("fresh") === "1";
  const { data, cachedAt, fresh } = await cached("footprint", TTL, computeFootprint, force);
  return NextResponse.json({ ...data, cachedAt, fromCache: fresh });
}
