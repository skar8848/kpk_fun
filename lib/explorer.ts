// Liens vers les explorers par chaîne.
const EXPLORER: Record<string, string> = {
  ethereum: "https://etherscan.io",
  gnosis: "https://gnosisscan.io",
  arbitrum: "https://arbiscan.io",
  base: "https://basescan.org",
  optimism: "https://optimistic.etherscan.io",
  polygon: "https://polygonscan.com",
  unichain: "https://uniscan.xyz",
  bsc: "https://bscscan.com",
};

// Affichage joli des chaînes (BSC en majuscules, etc.)
const CHAIN_LABEL: Record<string, string> = { bsc: "BSC" };
export function chainLabel(c?: string | null): string {
  if (!c) return "";
  return CHAIN_LABEL[c] ?? c;
}

export function explorerAddr(chain: string | undefined, address: string): string {
  const base = EXPLORER[chain ?? "ethereum"] ?? EXPLORER.ethereum;
  return `${base}/address/${address}`;
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Overrides connus oracle/feed -> vendor (extensible). Sinon déduit du type Morpho.
const VENDOR_BY_ADDR: Record<string, string> = {
  // ex: "0x...": "Pyth" / "RedStone" (à compléter au besoin)
};

export function oracleVendor(type?: string | null, addr?: string | null): string {
  if (addr && VENDOR_BY_ADDR[addr.toLowerCase()]) return VENDOR_BY_ADDR[addr.toLowerCase()];
  const t = (type ?? "").toLowerCase();
  if (t.includes("chainlink")) return "Chainlink";
  if (t.includes("pyth")) return "Pyth";
  if (t.includes("redstone")) return "RedStone";
  if (t === "unknown" || t === "") return "Unknown";
  return "Custom";
}
