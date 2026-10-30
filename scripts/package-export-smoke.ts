import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const packageManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { files?: unknown };
if (
  !Array.isArray(packageManifest.files) ||
  !packageManifest.files.includes("dist/cjs/src") ||
  !packageManifest.files.includes("docs/QUICKSTART.md") ||
  !packageManifest.files.includes("docs/ADVANCED.md") ||
  packageManifest.files.includes("docs")
) {
  throw new Error("Package files must include CJS and the public guides while excluding the docs tree");
}

const sdk = (await import("@quantulabs/mimir-sdk/advanced")) as Record<string, unknown>;
for (const name of ["getPrice", "getPrices", "watchPrices", "withFreshPrice", "refreshInstructions", "mergeFreshPrice", "toWeb3Instruction", "simulatePrice", "listFeeds", "decodePrice",
  "getFeedInfo", "decodeFeedInfo", "scoreFeed", "recommendPools", "dlmmRouteableDepth", "venueLabel", "planFeed", "prepareFeed", "createFeed", "planComposite", "createComposite",
  "prepareFeedStep", "prepareCompositeStep", "keyPairSigner", "jupiterSwapBuild", "recommend", "poolCandidates", "resolveToken", "searchTokens", "autoTicker", "Mimir", "MimirError"]) {
  if (typeof sdk[name] !== "function") throw new Error(`./advanced must export ${name}`);
}
if (typeof sdk.MIMIR_PROGRAM_IDS !== "object") throw new Error("./advanced must export MIMIR_PROGRAM_IDS");
const cjsSdk = createRequire(import.meta.url)("@quantulabs/mimir-sdk/advanced") as Record<
  string,
  unknown
>;
for (const [format, root] of [["ESM", await import("@quantulabs/mimir-sdk")], ["CJS", createRequire(import.meta.url)("@quantulabs/mimir-sdk")]] as const) {
  if (Object.keys(root).filter((k) => k !== "default" && k !== "__esModule").sort().join() !== "Mimir,MimirError") {
    throw new Error(`${format} root must export exactly Mimir and MimirError`);
  }
}
for (const [format, entry] of [["ESM", await import("@quantulabs/mimir-sdk/create")], ["CJS", createRequire(import.meta.url)("@quantulabs/mimir-sdk/create")]] as const) {
  for (const name of ["planFeed", "prepareFeed", "prepareFeedStep", "prepareStep", "prepareCompositeStep", "createFeed", "jupiterSwapBuild", "keyPairSigner", "toleranceLine", "validateJupiterCollateralBuild", "confirmSignature"]) {
    if (typeof (entry as Record<string, unknown>)[name] !== "function") throw new Error(`${format} ./create must export ${name}`);
  }
}
const beta = (await import("@quantulabs/mimir-sdk/beta")) as Record<string, unknown>;
const cjsBeta = createRequire(import.meta.url)("@quantulabs/mimir-sdk/beta") as Record<string, unknown>;

for (const [format, betaSdk] of [["ESM", beta], ["CJS", cjsBeta]] as const) {
  for (const exportName of [
    "validateMimirBetaDeployment",
    "createMimir8004IdentityAdapter",
    "inspectMimirFeedOwnership",
    "revalidateMimirBetaCapture",
    "decodeMimirBetaCoreAsset",
    "decodeMimirBetaCoreCollection",
    "buildMimirBetaCoreTransferV1",
    "createMimirBetaClient",
    "parseMimirBetaIntegerQuantityX64",
    "observeMimirBetaReceipt",
    "verifyMimirBetaFinalizedReceiptEvidence",
    "prepareMimirBetaCompositeFeedJourney",
    "admitMimirBetaWalletSignedTransactionV1",
    "admitMimirBetaWalletSignedBatchV1",
    "parseToken2022PumpSwapMetadataMint",
    "parseToken2022PumpSwapVault",
  ]) {
    if (typeof betaSdk[exportName] !== "function") throw new Error(`Missing ${format} beta export: ${exportName}`);
  }
  if ("MimirBetaCoreAccountCodec" in betaSdk || "coreCodec" in betaSdk) {
    throw new Error(`${format} beta facade exposes the removed injected Core codec`);
  }
}

const requiredFunctionExports = [
  "evaluateRouteableDepthEvidence",
  "fetchRouteableDepthAccountBundle",
  "computeRouteableDepthAccountDataHash",
  "computeRouteableDepthAccountBundleHash",
  "computeRouteableDepthAccountBundleSetHash",
  "buildRouteableDepthEvidenceFromRanges",
  "buildRouteableDepthEvidenceFromDecodedLevels",
  "computeRouteableDepthRangeEvidenceHash",
  "computeRouteableDepthAdapterFixtureHash",
  "computeRouteableDepthAdapterFixtureSetHash",
  "computeRouteableDepthTraversalHash",
  "computeRouteableDepthTraversalSetHash",
  "evaluateFeeLossVector",
  "computeFeeLossVectorHash",
  "computeTierAAnchorPolicyHash",
  "evaluateTierAAnchorPolicy",
  "stringifyAnchorPolicyReport",
  "cpmmZeroFeeImmediateUnwindBounds",
  "inspectCpmmSourceFloorProof",
  "meteoraDlmmPriceFromIdX64",
  "squareQ64ToX64",
  "normalizedDirectQ64PriceX64",
  "normalizedInverseQ64PriceX64",
  "normalizedCpmmPriceX64",
  "computeMeteoraDlmmRouteableSourceAccountsHash",
  "deriveMintPairFeedId",
  "deriveMintPairFeedIdHex",
  "resolveMintOracleAccounts",
  "sourcePriorityForFamily",
  "sourceFamilyToAdapterType",
  "defaultProgramIdForSourceFamily",
  "adapterMaskForSourceFamilies",
  "selectMintOraclePools",
  "discoverMintOraclePoolsForMint",
  "computeMintOraclePoolScore",
  "buildMintOracleSourceConfigArgs",
  "computeMintOracleSourceSetHash",
  "evaluateMintOracleLongTailPools",
  "collectV0AltLookupAddresses",
  "createSyntheticAddressLookupTable",
  "profileMimirV0AltTransaction",
  "buildMimirV0AltTransaction",
  "buildSizeAwareV0Transaction",
  "buildSizeAwareV0TransactionWithResolver",
  "chunkSizeAwareV0InstructionsByPacket",
  "projectRaydiumCpmmObservationAfterCrank",
  "RaydiumCpmmNativeTwapWindowWarmingError",
  "MimirNativeTwapUnavailableError",
] as const;

for (const exportName of requiredFunctionExports) {
  if (typeof sdk[exportName] !== "function") {
    throw new Error(`Missing package export: ${exportName}`);
  }
}

const forbiddenFunctionExports = [
  "buildTestSnapshotHeader",
  "buildTestFeedConfigHeader",
  "buildTestCreatedFeedConfigHeader",
  "buildTestExperimentalFeedConfigHeader",
  "buildTestOracleRegistryHeader",
  "buildTestGovernancePolicyHeader",
  "buildTestGovernanceActionHeader",
  "buildTestOracleAdmissionHeader",
  "buildTestFeedReservationHeader",
  "buildTestSourcingPlanHeader",
  "buildTestSourceConfigHeader",
  "buildTestCpmmSourceConfigHeader",
  "buildTestOrcaWhirlpoolSourceConfigHeader",
  "buildTestMeteoraDlmmSourceConfigHeader",
  "buildTestRaydiumClmmSourceConfigHeader",
  "buildTestOpenBookSourceConfigHeader",
  "buildTestFeedTwapStateHeader",
  "buildTestSourceObservationRingHeader",
  "buildTestSourceObservationBucketHeader",
  "buildTestFeedObservationBucketHeader",
  "buildTestCompactSourceRingArgs",
  "defaultTestSnapshotPolicy",
  "defaultTestRefreshTwapPolicy",
  "encodeCreateFeedConfigWithAdminV1Data",
  "createFeedConfigWithAdminV1Instruction",
  "encodeCreateSourcingPlanCompactData",
  "createSourcingPlanCompactInstruction",
  "encodeCreateFeedConfigCompactData",
  "createFeedConfigCompactInstruction",
  "encodeCreateFeedConfigData",
  "createFeedConfigInstruction",
  "encodePromoteFeedConfigData",
  "promoteFeedConfigInstruction",
  "encodeCreateSourcingPlanData",
  "createSourcingPlanInstruction",
  "encodeUpsertSourceConfigData",
  "createUpsertSourceConfigInstruction",
  "encodeCreateExperimentalFeedConfigData",
  "createExperimentalFeedConfigInstruction",
  "encodeMigrateExperimentalFeedConfigData",
  "migrateExperimentalFeedConfigInstruction",
  "findExperimentalFeedConfigPda",
  "createLocalnetFixtureUpsertFeedConfigInstruction",
  "createLocalnetFixtureUpsertFeedTwapInstruction",
  "createLocalnetFixtureUpsertRegistryInstruction",
  "createLocalnetFixtureUpsertSnapshotInstruction",
  "createLocalnetFixtureUpsertSourceConfigInstruction",
  "createLocalnetFixtureUpsertSourceRingCompactInstruction",
  "createLocalnetFixtureUpsertSourceRingInstruction",
  "createLocalnetFixtureUpsertSourcingPlanInstruction",
  "createFeedCreationCollateralAccountMetas",
  "encodeVerifySnapshotData",
  "createVerifySnapshotInstruction",
  "encodeRefreshFeedTwapFromRingsData",
  "createRefreshFeedTwapFromRingsInstruction",
  "encodePromoteFeedConfigCompactData",
  "freezeFeedInstruction",
  "setFeedConfigLifecycleInstruction",
  "setSourcingPlanStatusInstruction",
  "createVerifyFeedBucketTierAInstruction",
  "createVerifyFeedBucketTierAWithOracleAdmissionInstruction",
  "createRefreshSourceBucketFromRingInstruction",
  "createRefreshFeedBucketFromSourceBucketsInstruction",
  "createRefreshFeedTwapFromBucketsInstruction",
  "createInitFeedTwapFromRingsInstruction",
  "encodeInitFeedTwapFromRingsData",
  "createRefreshSnapshotFromTwapInstruction",
  "encodeRefreshSnapshotFromTwapData",
  "decodeRefreshSnapshotFromTwapData",
  "verifyMimirNativeCpmmRefreshReadBundle",
  "buildAtomicNonCpmmSourceSetExecutionPlan",
  "profileAtomicNonCpmmExecutionPlan",
  "buildDeepRefreshPlan",
  "createRefreshMeteoraRaydiumClmmSourcesAndFeedTwapInstruction",
  "createRefreshOrcaMeteoraDlmmSourcesAndFeedTwapInstruction",
  "createRefreshOrcaMeteoraRaydiumClmmSourcesAndFeedTwapInstruction",
  "createRefreshSourceRingFromMeteoraDlmmRouteableInstruction",
  "buildMintFeedReservationHeader",
  "updateFeedConfigAndSourcingPlanInstruction",
  "updateFeedConfigInstruction",
  "updateSourcingPlanInstruction",
  "compactSourcingPlanArgsFromHeader",
  "createRefresh" + "OpenBookSourceAndFeedTwapInstruction",
  "createRefreshRaydiumClmm" + "OpenBookSourcesAndFeedTwapInstruction",
  "createRefreshSourceRingFrom" + "OpenBookInstruction",
] as const;

for (const exportName of forbiddenFunctionExports) {
  if (typeof sdk[exportName] === "function") {
    throw new Error(`Unexpected package export: ${exportName}`);
  }
}

for (const [format, rootSdk] of [["ESM", sdk], ["CJS", cjsSdk]] as const) {
  for (const exportName of [
    "MANIPULATION_COST_VECTOR_HASH_DOMAIN",
    "evaluateManipulationCostVector",
    "computeManipulationCostVectorHash",
    "normalizeManipulationCostVectorValue",
    "stringifyManipulationCostVectorReport",
  ]) {
    if (exportName in rootSdk) throw new Error(`${format} removed export is present: ${exportName}`);
  }
}

for (const [format, rootSdk] of [["ESM", sdk], ["CJS", cjsSdk]] as const) {
  for (const exportName of [
    "encodeCreateCompositeFeedConfigV1Data",
    "createCompositeFeedConfigV1Instruction",
    "INIT_FEED_TWAP_FROM_RINGS_TAG",
    "REFRESH_SNAPSHOT_FROM_TWAP_TAG",
    "REFRESH_SNAPSHOT_FROM_TWAP_LEN",
    "RefreshSnapshotFromTwapArgs",
    "BuildDeepRefreshPlanArgs",
    "DeepRefreshSnapshotBlockedReason",
    "DeepRefreshTelemetry",
    "DeepRefreshExecutionStepKind",
    "DeepRefreshExecutionBlockReason",
    "DeepRefreshExecutionStep",
    "DeepRefreshExecutionPlan",
    "DeepRefreshPlan",
    "AtomicNonCpmmExecutionPlan",
    "ProfileAtomicNonCpmmExecutionPlanArgs",
    "createInitFeedTwapFromRingsInstruction",
    "encodeInitFeedTwapFromRingsData",
    "createRefreshSnapshotFromTwapInstruction",
    "encodeRefreshSnapshotFromTwapData",
    "decodeRefreshSnapshotFromTwapData",
    "verifyMimirNativeCpmmRefreshReadBundle",
    "buildAtomicNonCpmmSourceSetExecutionPlan",
    "profileAtomicNonCpmmExecutionPlan",
    "buildDeepRefreshPlan",
  ] as const) {
    if (exportName in rootSdk) throw new Error(`Unexpected ${format} root export: ${exportName}`);
  }
}

const forbiddenValueExports = [
  "TEST_FEED_ID",
  "TEST_PLAN_HASH",
  "TEST_ANCHOR_POLICY_HASH",
  "TEST_NATIVE_EXCEPTION_HASH",
  "TEST_FEED_CONFIG",
  "TEST_GOVERNANCE_AUTHORITY",
  "TEST_GOVERNANCE_SIGNER_1",
  "TEST_GOVERNANCE_SIGNER_2",
  "TEST_SNAPSHOT_SLOT",
  "TEST_CLOCK_SLOT",
  "TEST_VALID_UNTIL_SLOT",
  "TEST_MAX_RECOMMENDED_NOTIONAL",
  "TEST_NOTIONAL",
  "TEST_PRICE_EXPONENT",
  "TEST_PLAN_ID",
  "TEST_PLAN_VERSION",
  "TEST_TWAP_VERSION",
  "TEST_RING_VERSION",
  "CREATE_EXPERIMENTAL_FEED_CONFIG_TAG",
  "CREATE_FEED_CONFIG_TAG",
  "PROMOTE_FEED_CONFIG_TAG",
  "CREATE_SOURCING_PLAN_TAG",
  "UPSERT_SOURCE_CONFIG_TAG",
  "MIGRATE_EXPERIMENTAL_FEED_CONFIG_TAG",
  "MIGRATE_EXPERIMENTAL_FEED_CONFIG_LEN",
  "REFRESH_SOURCE_RING_FROM_OPENBOOK_TAG",
  "REFRESH_OPENBOOK_SOURCE_AND_FEED_TWAP_TAG",
  "REFRESH_RAYDIUM_CLMM_OPENBOOK_SOURCES_AND_FEED_TWAP_TAG",
  "REFRESH_SOURCE_RING_FROM_OPENBOOK_LEN",
  "REFRESH_OPENBOOK_SOURCE_AND_FEED_TWAP_LEN",
  "REFRESH_RAYDIUM_CLMM_OPENBOOK_SOURCES_AND_FEED_TWAP_LEN",
  "INIT_FEED_TWAP_FROM_RINGS_TAG",
  "REFRESH_SNAPSHOT_FROM_TWAP_TAG",
  "REFRESH_SNAPSHOT_FROM_TWAP_LEN",
] as const;

for (const [format, packageSdk] of [
  ["ESM", sdk],
  ["CJS", cjsSdk],
] as const) {
  for (const exportName of forbiddenValueExports) {
    if (exportName in packageSdk) {
      throw new Error(`Unexpected ${format} package export: ${exportName}`);
    }
  }
}

if (typeof sdk.MINT_ORACLE_MARKET_FLAGS !== "object") {
  throw new Error("Missing package export: MINT_ORACLE_MARKET_FLAGS");
}

for (const [format, packageSdk] of [
  ["ESM", sdk],
  ["CJS", cjsSdk],
] as const) {
  if (typeof packageSdk.MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1 !== "object") {
    throw new Error(
      `Missing ${format} package export: MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1`,
    );
  }
  if (typeof packageSdk.mimirCreationExecutionInventoryAddressBoundV1 !== "function") {
    throw new Error(
      `Missing ${format} package export: mimirCreationExecutionInventoryAddressBoundV1`,
    );
  }
}

const v1 = (await import("@quantulabs/mimir-sdk/v1")) as Record<string, unknown>;
const cjsV1 = createRequire(import.meta.url)("@quantulabs/mimir-sdk/v1") as Record<string, unknown>;
for (const [format, v1Sdk] of [["ESM", v1], ["CJS", cjsV1], ["MimirV1", sdk.MimirV1 as Record<string, unknown>]] as const) {
  if (v1Sdk.MIMIR_V1_MAINNET_PROGRAM_ID !== "hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR") {
    throw new Error(`Missing ${format} v1 export: MIMIR_V1_MAINNET_PROGRAM_ID`);
  }
  for (const exportName of [
    "decodeV1ClassicFeed",
    "decodeV1CompositeFeed",
    "listV1ClassicFeeds",
    "checkV1ConsumerPin",
    "createV1RentReader",
    "buildMimirV1CreateClassicInstruction",
    "planMimirV1ClassicCreation",
    "measureMimirV1Transaction",
    "buildMimirV1ClassicDefinition",
    "planMimirV1ClassicCreationFromPools",
    "prepareMimirV1ClassicCreation",
  ]) {
    if (typeof v1Sdk[exportName] !== "function") throw new Error(`Missing ${format} v1 export: ${exportName}`);
  }
}

export {};
