const sdk = await import("@quantulabs/mimir-sdk/advanced");
const root = await import("@quantulabs/mimir-sdk");
if (Object.keys(root).filter((k) => k !== "default" && k !== "__esModule").sort().join() !== "Mimir,MimirError" || typeof new root.Mimir().price !== "function") throw new Error("Installed ESM root must export exactly Mimir and MimirError");
if (typeof sdk.getPrice !== "function" || typeof sdk.planFeed !== "function" || typeof sdk.poolCandidates !== "function") throw new Error("Installed ESM ./advanced must keep the 0.7 names");
const beta = await import("@quantulabs/mimir-sdk/beta");

if (typeof beta.createMimir8004IdentityAdapter !== "function" || typeof beta.buildMimirBetaCoreTransferV1 !== "function" ||
  typeof beta.createMimirBetaClient !== "function" || typeof beta.observeMimirBetaReceipt !== "function" ||
  typeof beta.verifyMimirBetaFinalizedReceiptEvidence !== "function") {
  throw new Error("Installed ESM package is missing the beta facade");
}
if ("encodeCreateCompositeFeedConfigV1Data" in sdk ||
  "createCompositeFeedConfigV1Instruction" in sdk) {
  throw new Error("Installed ESM package exposes rejected tag-64 constructors");
}

if (typeof sdk.MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1 !== "object") {
  throw new Error("Installed ESM package is missing the creation inventory envelope");
}
if (typeof sdk.mimirCreationExecutionInventoryAddressBoundV1 !== "function") {
  throw new Error("Installed ESM package is missing the creation inventory helper");
}
if (
  sdk.mimirCreationExecutionInventoryAddressBoundV1({
    adapterVersion: 0,
    sources: [{ adapterType: 2, shape: "basic" }],
  }) !== 15
) {
  throw new Error("Installed ESM package returned the wrong inventory bound");
}
