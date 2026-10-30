import type { Address } from '@solana/kit';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!, (b) => parseInt(b, 16));

/** The LIVE mainnet runtime config (app.mimirfeeds.io/mimir-runtime.json, 2026-10-27): deployment and creation terms. Never read at runtime. */
export const MIMIR_MAINNET_DEPLOYMENT = Object.freeze({
  cluster: 'mainnet-beta' as const,
  mimirProgramId: 'hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR' as Address,
  agentRegistryProgramId: '8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ' as Address,
  mplCoreProgramId: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' as Address,
  systemProgramId: '11111111111111111111111111111111' as Address,
  physicalCollection: 'DbjsWo7iUs7QZyJxLgNyVxvAAjQZCXroJHoGok8h8Umg' as Address,
  collectionPointer: 'c1:bafkreieg7klcmrpejtmawmder24hpaoll2e22nfc4d2w4kbqzo4fk654bu',
  tokenProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address,
});
export const MIMIR_MAINNET_COLLATERAL_MINT = 'CoLAyH8CRuBLyr2BRDozka3dJ5XH97BSa6WpZL9NAqWL' as Address;
export const MIMIR_MAINNET_SOL_CONVERSION_SOURCE_CONFIG = 'F5fXuWuVFwBF3eBVtFkxXS5PMY651uVQ1bL4W4mse5Qj' as Address;
export const MIMIR_MAINNET_CLASSIC_POLICY = Object.freeze({
  profile: 0, riskTier: 1, priceExponent: -8, maxDispersionBps: 100, maxSourceActivityAgeSlots: 150, minCoverageRatioBps: 8_000,
  maxConfidenceBps: 100, maxSnapshotAgeSlots: 150,
  anchorPolicyHash: hex('233690dbbb9a97d43abb4da1eda3a7a8d4361eaacc26686bfdcf0d7df96a3376'),
  nativeExceptionHash: hex('e88a1593d69ebbdd22c4671b34a61443726ba3dfecf1b62e4e0518090487a066'),
});
export const MIMIR_MAINNET_COMPOSITE_POLICY = Object.freeze({
  priceExponent: -8, maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150, maxComponentConfidenceBps: 100, maxComponentDispersionBps: 100,
});
export const MIMIR_MAINNET_EVIDENCE_TTL_SLOTS = 150n;
export const MIMIR_MAINNET_MAX_SCAN_RESULTS_PER_FAMILY = 32;
