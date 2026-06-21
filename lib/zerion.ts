// Client Zerion : positions DeFi d'une adresse (Safe) multi-chaînes.
// Clé via ZERION_API_KEY (jamais commitée). Basic auth base64("zk_KEY:").

export type ZPosition = {
  symbol: string;
  value: number;
  protocol: string;
  type: string; // deposit / staked / loan / reward / locked …
  chain: string;
};

const BASE = "https://api.zerion.io/v1";

function authHeader(key: string): string {
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}

export async function getSafePositions(
  address: string, chains: string[], key: string,
): Promise<ZPosition[]> {
  const url = new URL(`${BASE}/wallets/${address}/positions/`);
  url.searchParams.set("filter[positions]", "only_complex");
  url.searchParams.set("currency", "usd");
  url.searchParams.set("filter[chain_ids]", chains.join(","));
  try {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(url.toString(), {
        headers: { Authorization: authHeader(key) },
        cache: "no-store",
      });
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // backoff sur throttle
    }
    if (!res || !res.ok) return [];
    const body = await res.json();
    const out: ZPosition[] = [];
    for (const it of body.data ?? []) {
      const a = it.attributes ?? {};
      const value = Number(a.value ?? 0);
      if (!value || value < 1000) continue; // ignore la poussière
      const fi = a.fungible_info ?? {};
      const chain = it.relationships?.chain?.data?.id ?? "?";
      out.push({
        symbol: (fi.symbol ?? "?").toString(),
        value,
        protocol: (a.protocol ?? "wallet").toString(),
        type: (a.position_type ?? "?").toString(),
        chain,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// Map limitée en concurrence (Zerion free = ~10 req/s).
export async function mapLimited<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      res[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return res;
}
