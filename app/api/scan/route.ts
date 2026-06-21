import { NextRequest, NextResponse } from "next/server";
import { getVaultV1 } from "@/lib/morpho";
import { decompose } from "@/lib/decompose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address")?.trim();
  const chain = (searchParams.get("chain") ?? "ethereum").trim();

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "adresse de vault invalide" }, { status: 400 });
  }
  try {
    const vault = await getVaultV1(address, chain);
    const report = decompose(vault);
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
