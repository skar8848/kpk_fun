// Footprint KPK : entités gérées (Safes de trésorerie de DAOs + vaults Morpho curatés).
// Safes VÉRIFIÉS depuis github.com/karpatkey/client-configs (clients/*/instances/main.ts :
// parameters.avatar = Safe trésorerie, rolesMod = Zodiac Roles Modifier).
// Positions à lire via Zerion (/v1/wallets/{avatar}/positions/). Morpho décomposé en interne.

export type KpkSafe = {
  dao: string;
  label: string;
  avatar: string; // le Safe qui détient les fonds
  chains: string[]; // chainId mappés aux noms de chaîne Zerion/Morpho
  rolesMod?: string;
};

// chainId -> nom (Zerion: ethereum/gnosis/arbitrum/base/optimism)
export const CHAIN_NAME: Record<number, string> = {
  1: "ethereum", 100: "gnosis", 42161: "arbitrum", 8453: "base", 10: "optimism",
};

export const KPK_SAFES: KpkSafe[] = [
  { dao: "ENS DAO", label: "Endowment", avatar: "0x4F2083f5fBede34C2714aFfb3105539775f7FE64", chains: ["ethereum"], rolesMod: "0x703806E61847984346d2D7DDd853049627e50A40" },
  { dao: "Balancer DAO", label: "Treasury", avatar: "0x0EFcCBb9E2C09Ea29551879bd9Da32362b32fc89", chains: ["ethereum", "gnosis", "arbitrum"], rolesMod: "0x13c61a25DB73e7a94a244bD2205aDba8b4a60F4a" },
  { dao: "Arbitrum DAO", label: "Treasury", avatar: "0x4D1D9D7741740A3E2ffC5507aC643DbA5e81cAe5", chains: ["ethereum", "arbitrum"], rolesMod: "0x80BCb96711067eEa42e0Bc2ea89a545483538Cc8" },
  { dao: "GnosisDAO", label: "Illiquid Assets (Eth)", avatar: "0x849D52316331967b6fF1198e5E32A0eB168D039d", chains: ["ethereum"] },
  { dao: "GnosisDAO", label: "Illiquid Assets (Gno)", avatar: "0x458cD345B4C05e8DF39d0A07220feb4Ec19F5e6f", chains: ["gnosis"] },
  { dao: "GnosisDAO", label: "Liquidity Provision (Eth)", avatar: "0xa5C629E04E563355c30885B62928fd6E03558548", chains: ["ethereum"] },
  { dao: "GnosisDAO", label: "Liquidity Provision (Gno)", avatar: "0x509Ad7278A2F6530Bc24590C83E93fAF8fd46E99", chains: ["gnosis"] },
  { dao: "GnosisDAO", label: "Lending Markets (Eth)", avatar: "0x15a954001BB47890a4c46A7FE9f06F7c39fF3D68", chains: ["ethereum"] },
  { dao: "GnosisDAO", label: "Lending Markets (Gno)", avatar: "0x9065A0F9545817d18b58436771b4d87Bda8f008B", chains: ["gnosis"] },
  { dao: "Gnosis Ltd", label: "Treasury (Eth)", avatar: "0x4971DD016127F390a3EF6b956Ff944d0E2e1e462", chains: ["ethereum"] },
  { dao: "Gnosis Ltd", label: "Treasury (Gno)", avatar: "0x10E4597fF93cbee194F4879f8f1d54a370DB6969", chains: ["gnosis"] },
  { dao: "CoW DAO", label: "Main", avatar: "0x616dE58c011F8736fa20c7Ae5352F7f6FB9F0669", chains: ["ethereum", "gnosis", "arbitrum", "base"] },
  { dao: "CoW DAO", label: "Fee", avatar: "0x22af3D38E50ddedeb7C47f36faB321eC3Bb72A76", chains: ["ethereum", "gnosis", "arbitrum", "base"] },
  { dao: "CoW DAO", label: "Defense", avatar: "0x7F8987D6A8bee31bD7bE80E877732579E2582a28", chains: ["ethereum", "gnosis"] },
  { dao: "Safe DAO", label: "Treasury (Eth)", avatar: "0xd28b432f06cb64692379758B88B5fCDFC4F56922", chains: ["ethereum"] },
  { dao: "Safe DAO", label: "Treasury (Gno)", avatar: "0x0c6EEB232800fb86215438C4F7Ae032b5463586C", chains: ["gnosis"] },
  { dao: "Nexus Mutual", label: "Treasury", avatar: "0x8e53D04644E9ab0412a8c6bd228C84da7664cFE3", chains: ["ethereum"] },
  { dao: "Ethereum Foundation", label: "Treasury", avatar: "0x9fC3dc011b461664c835F2527fffb1169b3C213e", chains: ["ethereum"] },
  { dao: "kpk", label: "DAO (Eth)", avatar: "0x58e6c7ab55Aa9012eAccA16d1ED4c15795669E1C", chains: ["ethereum"] },
  { dao: "kpk", label: "USD Fund v1", avatar: "0xdf8ee91120154bdc3cb628f0535b6511e52327ff", chains: ["ethereum", "gnosis", "arbitrum", "base", "optimism"] },
  { dao: "kpk", label: "USD Stable Fund", avatar: "0x846E7F810E08F1E2AF2c5AfD06847cc95F5CaE1B", chains: ["ethereum", "gnosis", "arbitrum", "base", "optimism"] },
];

// Vaults Morpho curatés par KPK (décomposés en interne, sans clé). v1 = décomposable;
// v2 = adapters (décomposition à venir).
export type KpkVault = { name: string; address: string; chain: string; version: "v1" | "v2" };
export const KPK_VAULTS: KpkVault[] = [
  { name: "kpk USDC Yield", address: "0x9178eBE0691593184c1D785a864B62a326cc3509", chain: "ethereum", version: "v1" },
  { name: "KPK USDC Prime", address: "0x4ef53d2caa51c447fdfeeedee8f07fd1962c9ee6", chain: "ethereum", version: "v2" },
  { name: "KPK USDC Prime Core", address: "0x1a1985F50352b58090eb36425AfdFacbaC7806F4", chain: "ethereum", version: "v2" },
  { name: "KPK ETH Yield", address: "0x5dbf760b4fd0cDdDe0366b33aEb338b2A6d77725", chain: "ethereum", version: "v2" },
  { name: "KPK EURe Yield", address: "0x6251482812cE95d11b3E447FE6888b1a1bE66C25", chain: "ethereum", version: "v2" },
  { name: "KPK USDT Prime", address: "0x870F0BF29A25A40E7CC087cD5C53e70C11F2C8A8", chain: "ethereum", version: "v2" },
  { name: "KPK USDC Yield (arb)", address: "0x5837e4189819637853a357aF36650902347F5e73", chain: "arbitrum", version: "v2" },
];
