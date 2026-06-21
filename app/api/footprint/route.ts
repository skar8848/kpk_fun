import { NextResponse } from "next/server";
import { getVaultV1, getVaultV2 } from "@/lib/morpho";
import { decompose } from "@/lib/decompose";
import { buildFootprint, type V2Brief } from "@/lib/footprint";
import { KPK_SAFES, KPK_VAULTS } from "@/lib/kpkEntities";
import { getSafePositions, mapLimited, type ZPosition } from "@/lib/zerion";
import type { ScanReport } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const vaultReports: ScanReport[] = [];
  const v2vaults: V2Brief[] = [];
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

  // Positions des Safes via Zerion (si clé configurée)
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

  const graph = buildFootprint({ vaultReports, v2vaults, safes: KPK_SAFES, safePositions });
  return NextResponse.json({
    graph, skipped, zerion,
    counts: { safes: KPK_SAFES.length, v1: vaultReports.length, v2: v2vaults.length },
  });
}
