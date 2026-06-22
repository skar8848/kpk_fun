// Client Zerion : positions DeFi d'une adresse (Safe) multi-chaînes.
// Clé via ZERION_API_KEY (jamais commitée). Basic auth base64("zk_KEY:").

export type ZPosition = {
  symbol: string;
  value: number;
  protocol: string;
  type: string; // deposit / staked / loan / reward / locked …
  chain: string;
  address?: string; // contrat du token
};

const BASE = "https://api.zerion.io/v1";

function authHeader(key: string): string {
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}

// Zerion utilise ses propres chain ids (Gnosis = "xdai"). On normalise pour l'affichage.
const ZERION_CHAIN: Record<string, string> = { xdai: "gnosis", "binance-smart-chain": "bsc" };

export async function getSafePositions(
  address: string, _chains: string[], key: string,
): Promise<ZPosition[]> {
  // PAS de filtre de chaînes : les ids Zerion diffèrent des nôtres (gnosis≠xdai) et
  // la liste client-configs est incomplète -> on lit toutes les chaînes pour ne rien perdre.
  const url = new URL(`${BASE}/wallets/${address}/positions/`);
  url.searchParams.set("filter[positions]", "no_filter");
  url.searchParams.set("currency", "usd");
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
      const rawChain = it.relationships?.chain?.data?.id ?? "?";
      const chain = ZERION_CHAIN[rawChain] ?? rawChain;
      const impls = fi.implementations ?? [];
      const impl = impls.find((i: { chain_id?: string }) => i.chain_id === rawChain) ?? impls[0];
      out.push({
        symbol: (fi.symbol ?? "?").toString(),
        value,
        protocol: (a.protocol ?? "wallet").toString(),
        type: (a.position_type ?? "?").toString(),
        chain,
        address: impl?.address,
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
