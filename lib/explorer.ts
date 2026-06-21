// Liens vers les explorers par chaîne.
const EXPLORER: Record<string, string> = {
  ethereum: "https://etherscan.io",
  gnosis: "https://gnosisscan.io",
  arbitrum: "https://arbiscan.io",
  base: "https://basescan.org",
  optimism: "https://optimistic.etherscan.io",
  polygon: "https://polygonscan.com",
  unichain: "https://uniscan.xyz",
};

export function explorerAddr(chain: string | undefined, address: string): string {
  const base = EXPLORER[chain ?? "ethereum"] ?? EXPLORER.ethereum;
  return `${base}/address/${address}`;
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
