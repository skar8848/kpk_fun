// Cache mémoire TTL avec dédup des calculs concurrents.
// Sur Vercel : persiste tant que l'instance est chaude (suffit pour la démo).
// Le footprint passe de ~25s à <1s entre deux chargements.

type Entry<T> = { value: T; at: number };
const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export type Cached<T> = { data: T; cachedAt: number; fresh: boolean };

export async function cached<T>(
  key: string, ttlMs: number, fn: () => Promise<T>, force = false,
): Promise<Cached<T>> {
  const e = store.get(key) as Entry<T> | undefined;
  if (!force && e && Date.now() - e.at < ttlMs) {
    return { data: e.value, cachedAt: e.at, fresh: true };
  }
  // dédup : un seul calcul même si plusieurs requêtes arrivent en même temps
  if (inflight.has(key)) {
    return { data: (await inflight.get(key)) as T, cachedAt: Date.now(), fresh: false };
  }
  const p = fn()
    .then((v) => { store.set(key, { value: v, at: Date.now() }); return v; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  try {
    const v = (await p) as T;
    return { data: v, cachedAt: Date.now(), fresh: false };
  } catch (err) {
    // en cas d'échec, sert le périmé s'il existe
    if (e) return { data: e.value, cachedAt: e.at, fresh: true };
    throw err;
  }
}
