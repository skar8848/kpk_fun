import { NextResponse } from "next/server";
import { getVaultV1, getVaultV2Brief } from "@/lib/morpho";
import { decompose } from "@/lib/decompose";
import { buildFootprint, type V2Brief } from "@/lib/footprint";
import { KPK_SAFES, KPK_VAULTS } from "@/lib/kpkEntities";
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
        if (v.version === "v1") {
          vaultReports.push(decompose(await getVaultV1(v.address, v.chain)));
        } else {
          const b = await getVaultV2Brief(v.address, v.chain);
          v2vaults.push({ name: b.name ?? v.name, address: v.address, chain: v.chain, tvlUsd: b.tvlUsd });
        }
      } catch (e) {
        skipped.push({ address: v.address, reason: String(e instanceof Error ? e.message : e) });
      }
    }),
  );

  const graph = buildFootprint({ vaultReports, v2vaults, safes: KPK_SAFES });
  return NextResponse.json({
    graph, skipped,
    counts: { safes: KPK_SAFES.length, v1: vaultReports.length, v2: v2vaults.length },
  });
}
