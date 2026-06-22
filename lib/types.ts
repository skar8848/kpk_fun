// Types partagés entre le moteur de scan et l'UI.

export type Asset = { symbol: string | null; address: string; decimals: number };

export type OracleFeed = { address: string | null } | null;
export type OracleVaultRef = { address: string | null } | null;

export type OracleData = {
  __typename?: string;
  baseFeedOne?: OracleFeed;
  baseFeedTwo?: OracleFeed;
  quoteFeedOne?: OracleFeed;
  quoteFeedTwo?: OracleFeed;
  baseOracleVault?: OracleVaultRef;
  quoteOracleVault?: OracleVaultRef;
};

export type Market = {
  marketId: string;
  lltv: string;
  collateralAsset: Asset | null;
  loanAsset: Asset;
  warnings: { type: string; level: string }[] | null;
  oracle: { address: string; type: string | null; data: OracleData | null } | null;
  state: {
    supplyAssetsUsd: string | null;
    borrowAssetsUsd: string | null;
    collateralAssetsUsd: string | null;
    liquidityAssetsUsd: string | null;
    utilization: number | null;
    supplyApy: number | null;
    borrowApy: number | null;
  } | null;
};

// Métriques de marché Morpho remontées sur un nœud.
export type MarketMetrics = {
  marketId?: string;
  collateralAddr?: string;
  loanAddr?: string;
  lltvPct?: number;
  utilPct?: number;
  supplyApyPct?: number;
  borrowApyPct?: number;
  liquidityUsd?: number;
  oracleAddr?: string;
};

export type VaultNorm = {
  address: string;
  chain: string;
  name: string | null;
  version: "v1" | "v2";
  asset: Asset | null;
  tvlUsd: number;
  apyPct?: number; // net APY du vault
  allocations: { supplyUsd: number; market: Market }[];
};

export type TreeNode = {
  symbol: string;
  usd: number;
  depth: number;
  protocol?: string;
  mechanism?: string;
  yield_source?: string;
  risk?: string;
  kind?: string;
  unmapped: boolean;
  terminal: boolean;
  address?: string;
  children: TreeNode[];
};

export type OracleAnalysis = {
  oracle_type: string | null;
  oracle_address: string | null;
  flags: string[];
  severity: "RED" | "YELLOW" | "OK";
};

export type Position = {
  label: string;
  usd: number;
  pct: number;
  lltv_pct: number;
  tree: TreeNode;
  oracle: OracleAnalysis;
  unmapped_collateral: boolean;
  metrics: MarketMetrics;
};

export type ExposureRow = { name: string; usd: number; pct: number };

export type Loop = { market: string; lltv_pct: number; max_leverage_x: number | null };

export type ContagionBucket = { usd: number; markets: number; examples: string[] };

export type ScanReport = {
  vault: { address: string; chain: string; name: string | null; version: string; apyPct?: number };
  tvlUsd: number;
  positions: Position[];
  transitive_exposure: ExposureRow[];
  protocol_exposure: ExposureRow[];
  loops: Loop[];
  oracle_contagion: Record<string, ContagionBucket>;
  unmapped: string[];
};
