import { address, getPublicKeyFromAddress, type Address } from "@solana/addresses";
import { signatureBytes, verifySignature } from "@solana/keys";
import { getCompiledTransactionMessageDecoder } from "@solana/transaction-messages";
import bs58 from "bs58";
import { addressBytes, base64, bytesAddress, bytesEqual, canonicalJson, domainHash, fromBase64, hex, isZeroBytes, sha256, utf8 } from "./bytes.js";
import { deriveMimirBetaPda } from "./abi.js";
import type { MimirBetaFacadeDeployment, MimirBetaPlanningRpc } from "./client.js";
import { decodeMimirCompositeConfig } from "./codecs.js";
import { validateMimirBetaDeployment, type MimirBetaDeployment } from "./deployment.js";
import { assertMimirStrictSimulation } from "./abi1Release.js";
import { betaError } from "./errors.js";
import { decodeMimirBetaCoreAsset } from "./mplCore.js";
import { createReviewHash, type MimirBetaSimulationFacts, type MimirBetaUnsignedTransaction } from "./review.js";
import {
  decodeMimirBetaBlockhashValidityResponse,
  decodeMimirBetaFinalizedTransactionResponse,
  decodeMimirBetaSignatureStatusResponse,
  FinalizedRpcReader,
  type MimirBetaFinalizedRpc,
  type MimirBetaReconciliationRpc,
} from "./rpc.js";
import {
  MIMIR_BETA_TRANSACTION_V1_MIN_PRIORITY_FEE_LAMPORTS,
  compileMimirBetaTransactionV1,
  isMimirBetaFeeOnlyWalletRewriteV1,
  isMimirBetaTransactionV1ConfigEnvelope,
  mimirBetaReviewedMessageOfWalletV1,
  verifyMimirBetaWalletSignedTransactionV1,
} from "./transactionV1.js";
import type { MimirBetaFinalizedTransactionEvidence, MimirBetaInstruction } from "./types.js";

const FEE_VAULT_MAGIC = utf8("MIMIRFEE");

export interface MimirBetaCompositeRevenue {
  readonly feed: Address;
  readonly feedId: Address;
  readonly feeVault: Address;
  readonly identityAsset: Address;
  readonly currentOwner: Address;
  readonly eligible: boolean;
  readonly totalOwnerGeneratedLamports: bigint;
  readonly ownerClaimedLamports: bigint;
  readonly ownerClaimableLamports: bigint;
  readonly observedSlot: bigint;
}

export interface MimirBetaCompositeRevenueClaimReviewV1 {
  readonly schema: "mimir-beta-composite-revenue-claim-review";
  readonly version: 1;
  readonly programId: Address;
  readonly feed: Address;
  readonly feedId: Address;
  readonly feeVault: Address;
  readonly identityAsset: Address;
  readonly currentOwner: Address;
  readonly totalOwnerGeneratedLamports: bigint;
  readonly expectedOwnerClaimedLamports: bigint;
  readonly claimAmountLamports: bigint;
  readonly instruction: Readonly<{
    readonly programAddress: Address;
    readonly accounts: MimirBetaInstruction["accounts"];
    readonly dataBase64: string;
    readonly dataSha256: string;
  }>;
  readonly messageHash: string;
  readonly packet: MimirBetaUnsignedTransaction["packet"];
  readonly simulation: MimirBetaSimulationFacts;
  readonly warnings: readonly string[];
}

export interface MimirBetaPreparedCompositeRevenueClaim {
  readonly schema: "mimir-beta-prepared-composite-revenue-claim";
  readonly version: 1;
  readonly revenue: MimirBetaCompositeRevenue;
  readonly transaction: MimirBetaUnsignedTransaction;
  readonly simulation: MimirBetaSimulationFacts;
  readonly review: MimirBetaCompositeRevenueClaimReviewV1;
  readonly canonicalReviewJson: string;
  readonly reviewHash: string;
}

export interface MimirBetaCompositeRevenueClaimReceiptV1 {
  readonly schema: "mimir-beta-composite-revenue-claim-receipt";
  readonly version: 1;
  readonly review: MimirBetaCompositeRevenueClaimReviewV1;
  readonly canonicalReviewJson: string;
  readonly reviewHash: string;
  readonly messageHash: string;
  readonly signature: string;
}

export interface MimirBetaCompositeRevenueClaimReceiptV2 {
  readonly schema: "mimir-beta-composite-revenue-claim-receipt";
  readonly version: 2;
  readonly review: MimirBetaCompositeRevenueClaimReviewV1;
  readonly canonicalReviewJson: string;
  readonly reviewHash: string;
  readonly messageHash: string;
  readonly messageBase64: string;
  readonly signature: string;
}

export type MimirBetaCompositeRevenueClaimReceipt =
  | MimirBetaCompositeRevenueClaimReceiptV1
  | MimirBetaCompositeRevenueClaimReceiptV2;

export type MimirBetaCompositeRevenueClaimOutcome = Readonly<
  | { state: "pending"; signature: string }
  | { state: "expired"; signature: string; observedSlot: bigint; messageHash: string; blockhash: string; evidenceHash: string }
  | { state: "failed"; signature: string; slot: bigint; errorHash: string }
  | { state: "finalized"; signature: string; slot: bigint; revenue: MimirBetaCompositeRevenue }
>;

const RECEIPT_V1_KEYS = ["canonicalReviewJson", "messageHash", "review", "reviewHash", "schema", "signature", "version"] as const;
const RECEIPT_V2_KEYS = [...RECEIPT_V1_KEYS, "messageBase64"] as const;
const REVIEW_KEYS = ["claimAmountLamports", "currentOwner", "expectedOwnerClaimedLamports", "feeVault", "feed", "feedId",
  "identityAsset", "instruction", "messageHash", "packet", "programId", "schema", "simulation", "totalOwnerGeneratedLamports",
  "version", "warnings"] as const;

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function receiptBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  return betaError("RECEIPT_MISMATCH", `${label} is not a canonical unsigned bigint`);
}

function receiptAddress(value: unknown, label: string): Address {
  if (typeof value !== "string") return betaError("RECEIPT_MISMATCH", `${label} is not an address`);
  try { const parsed = address(value); if (parsed !== value) throw new Error(); return parsed; }
  catch { return betaError("RECEIPT_MISMATCH", `${label} is not a canonical address`); }
}

function receiptSignature(value: unknown): Uint8Array {
  if (typeof value !== "string") return betaError("RECEIPT_MISMATCH", "Claim signature is not base58");
  try {
    const decoded = Uint8Array.from(bs58.decode(value));
    if (decoded.length !== 64 || decoded.every((byte) => byte === 0) || bs58.encode(decoded) !== value) throw new Error();
    return decoded;
  } catch { return betaError("RECEIPT_MISMATCH", "Claim signature is not canonical 64-byte base58"); }
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, jsonSafe(member)]));
  return value;
}

async function authenticateReview(input: unknown): Promise<MimirBetaCompositeRevenueClaimReviewV1> {
  if (!input || typeof input !== "object" || !exactKeys(input, REVIEW_KEYS)) betaError("RECEIPT_MISMATCH", "Claim review schema is not exact");
  const raw = input as Record<string, unknown>;
  const instruction = raw.instruction as Record<string, unknown> | null;
  const packet = raw.packet as Record<string, unknown> | null;
  const simulation = raw.simulation as Record<string, unknown> | null;
  if (raw.schema !== "mimir-beta-composite-revenue-claim-review" || raw.version !== 1 ||
    !instruction || !exactKeys(instruction, ["accounts", "dataBase64", "dataSha256", "programAddress"]) ||
    !packet || !exactKeys(packet, ["accountCount", "config", "fitsPacketLimit", "instructionCount", "packetLimitBytes",
      "serializedMessageBytes", "serializedTransactionBytes", "signatureCount"]) ||
    !simulation || !exactKeys(simulation, ["contextSlot", "error", "logsHash", "returnDataHash", "status", "unitsConsumed"]) ||
    !Array.isArray(instruction.accounts) || instruction.accounts.length !== 4 ||
    instruction.accounts.some((entry) => !entry || typeof entry !== "object" || !exactKeys(entry, ["address", "isSigner", "isWritable"])) ||
    !Array.isArray(raw.warnings) || raw.warnings.length !== 0) betaError("RECEIPT_MISMATCH", "Claim review lineage is malformed");
  const programId = receiptAddress(raw.programId, "programId"); const feed = receiptAddress(raw.feed, "feed");
  const feedId = receiptAddress(raw.feedId, "feedId"); const feeVault = receiptAddress(raw.feeVault, "feeVault");
  const identityAsset = receiptAddress(raw.identityAsset, "identityAsset"); const currentOwner = receiptAddress(raw.currentOwner, "currentOwner");
  const totalOwnerGeneratedLamports = receiptBigint(raw.totalOwnerGeneratedLamports, "total generated");
  const expectedOwnerClaimedLamports = receiptBigint(raw.expectedOwnerClaimedLamports, "expected claimed");
  const claimAmountLamports = receiptBigint(raw.claimAmountLamports, "claim amount");
  if (claimAmountLamports === 0n || expectedOwnerClaimedLamports + claimAmountLamports > totalOwnerGeneratedLamports ||
    typeof raw.messageHash !== "string" || !/^[0-9a-f]{64}$/.test(raw.messageHash) ||
    instruction.programAddress !== programId || typeof instruction.dataBase64 !== "string" ||
    typeof instruction.dataSha256 !== "string" || !/^[0-9a-f]{64}$/.test(instruction.dataSha256)) {
    betaError("RECEIPT_MISMATCH", "Claim review values are invalid");
  }
  const accounts = instruction.accounts as Array<Record<string, unknown>>;
  const expectedAccounts = [[currentOwner, true, true], [feed, false, false], [feeVault, false, true], [identityAsset, false, false]] as const;
  if (accounts.some((account, index) => receiptAddress(account.address, `instruction account ${index}`) !== expectedAccounts[index]![0] ||
    account.isSigner !== expectedAccounts[index]![1] || account.isWritable !== expectedAccounts[index]![2])) {
    betaError("RECEIPT_MISMATCH", "Claim instruction accounts or roles differ from review");
  }
  let data: Uint8Array;
  try { data = fromBase64(instruction.dataBase64); } catch { return betaError("RECEIPT_MISMATCH", "Claim instruction data is not canonical base64"); }
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const [expectedFeed] = await deriveMimirBetaPda({ programId, seed: "composite_feed_config", values: [addressBytes(feedId)] });
  const [expectedVault] = await deriveMimirBetaPda({ programId, seed: "feed_fee_vault", values: [addressBytes(feedId)] });
  const config = packet.config as Record<string, unknown> | null;
  if (feed !== expectedFeed || feeVault !== expectedVault || data.length !== 49 || data[0] !== 63 ||
    !bytesEqual(data.subarray(1, 33), addressBytes(feedId)) || dataView.getBigUint64(33, true) !== expectedOwnerClaimedLamports ||
    dataView.getBigUint64(41, true) !== claimAmountLamports || hex(await sha256(data)) !== instruction.dataSha256 ||
    packet.packetLimitBytes !== 4096 || packet.accountCount !== 5 || packet.instructionCount !== 1 || packet.signatureCount !== 1 ||
    packet.fitsPacketLimit !== true || typeof packet.serializedMessageBytes !== "number" || !Number.isSafeInteger(packet.serializedMessageBytes) ||
    typeof packet.serializedTransactionBytes !== "number" || packet.serializedTransactionBytes !== packet.serializedMessageBytes + 64 ||
    !config || !(exactKeys(config, ["computeUnitLimit", "loadedAccountsDataSizeLimit"]) ||
      exactKeys(config, ["computeUnitLimit", "loadedAccountsDataSizeLimit", "priorityFeeLamports"]) &&
      receiptBigint(config.priorityFeeLamports, "priority fee") >= MIMIR_BETA_TRANSACTION_V1_MIN_PRIORITY_FEE_LAMPORTS) || config.computeUnitLimit !== 1_400_000 ||
    config.loadedAccountsDataSizeLimit !== 67_108_864 || simulation.status !== "succeeded" || simulation.error !== null ||
    !/^[0-9a-f]{64}$/.test(String(simulation.logsHash)) ||
    !(simulation.returnDataHash === null || /^[0-9a-f]{64}$/.test(String(simulation.returnDataHash)))) {
    betaError("RECEIPT_MISMATCH", "Claim review does not authenticate canonical tag 63 TxV1/ALT0 semantics");
  }
  return { ...(raw as unknown as MimirBetaCompositeRevenueClaimReviewV1), programId, feed, feedId, feeVault, identityAsset,
    currentOwner, totalOwnerGeneratedLamports, expectedOwnerClaimedLamports, claimAmountLamports,
    simulation: { ...(simulation as unknown as MimirBetaSimulationFacts), contextSlot: receiptBigint(simulation.contextSlot, "simulation slot"),
      unitsConsumed: simulation.unitsConsumed === null ? null : receiptBigint(simulation.unitsConsumed, "simulation units") } };
}

async function authenticateClaimMessage(
  messageBytes: Uint8Array,
  signature: Uint8Array,
  review: MimirBetaCompositeRevenueClaimReviewV1,
  conflict: "RECEIPT_MISMATCH" | "RECONCILIATION_CONFLICT",
  messageHash: string = review.messageHash,
): Promise<Readonly<{ resolved: readonly Address[]; blockhash: string }>> {
  const decode = (bytes: Uint8Array) => {
    try { return getCompiledTransactionMessageDecoder().decode(bytes); }
    catch { return betaError(conflict, "Claim message is not canonical Transaction v1"); }
  };
  const actual = decode(messageBytes);
  if (actual.version !== 1) return betaError(conflict, "Claim message is not Transaction v1");
  if (hex(await sha256(messageBytes)) !== messageHash ||
    !(await verifySignature(await getPublicKeyFromAddress(review.currentOwner), signatureBytes(signature), messageBytes))) {
    betaError(conflict, "Claim message/signature differ from receipt");
  }
  let reviewedBytes = messageBytes;
  if (messageHash !== review.messageHash) {
    try {
      reviewedBytes = mimirBetaReviewedMessageOfWalletV1(messageBytes, { requiredSigners: [review.currentOwner],
        instructions: [review.instruction], packet: review.packet, messageHash: review.messageHash });
    } catch { return betaError(conflict, "Claim message does not reconstruct the reviewed message"); }
    if (!isMimirBetaFeeOnlyWalletRewriteV1(reviewedBytes, messageBytes)) betaError(conflict, "Claim message is not a fee-only rewrite of the review");
  }
  const message = decode(reviewedBytes);
  if (message.version !== 1) return betaError(conflict, "Claim message is not Transaction v1");
  const header = message.header;
  const instruction = message.instructionHeaders[0];
  const payload = message.instructionPayloads[0];
  const resolved = message.staticAccounts;
  const reviewedAccounts = review.instruction.accounts;
  const writable = (index: number): boolean => index < header.numSignerAccounts
    ? index < header.numSignerAccounts - header.numReadonlySignerAccounts
    : index < resolved.length - header.numReadonlyNonSignerAccounts;
  if (hex(await sha256(reviewedBytes)) !== review.messageHash ||
    !isMimirBetaTransactionV1ConfigEnvelope(message) ||
    message.numStaticAccounts !== 5 || message.numInstructions !== 1 ||
    header.numSignerAccounts !== 1 || header.numReadonlySignerAccounts !== 0 ||
    resolved.length !== 5 || new Set(resolved).size !== 5 || resolved[0] !== review.currentOwner ||
    !instruction || !payload || resolved[instruction.programAccountIndex] !== review.programId ||
    payload.instructionAccountIndices.length !== reviewedAccounts.length ||
    payload.instructionAccountIndices.some((index, position) => resolved[index] !== reviewedAccounts[position]!.address ||
      (index < header.numSignerAccounts) !== reviewedAccounts[position]!.isSigner ||
      writable(index) !== reviewedAccounts[position]!.isWritable) ||
    !bytesEqual(new Uint8Array(payload.instructionData), fromBase64(review.instruction.dataBase64))) {
    betaError(conflict, "Claim message/signature/accounts/roles differ from receipt review");
  }
  return { resolved: actual.staticAccounts, blockhash: actual.lifetimeToken };
}

function u64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true);
}

export function assertMimirBetaCompositeFeeVaultBinding(data: Uint8Array,
  composite: Readonly<{ feedId: Address; identityAsset: Address | null }>, config: Address, vaultPda: readonly [Address, number]) {
  const vault = decodeMimirBetaCompositeFeeVault(data);
  if (vault.feed !== composite.feedId || vault.compositeConfig !== config || vault.identityAsset !== composite.identityAsset ||
    vault.bump !== vaultPda[1]) betaError("PDA_MISMATCH", "Composite fee vault binding mismatch", vaultPda[0]);
  return vault;
}

export function decodeMimirBetaCompositeFeeVault(data: Uint8Array): Readonly<{
  feed: Address;
  compositeConfig: Address;
  identityAsset: Address;
  ownerGenerated: bigint;
  ownerClaimed: bigint;
  bump: number;
}> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length !== 160 || !bytesEqual(data.subarray(0, 8), FEE_VAULT_MAGIC) ||
    view.getUint16(8, true) !== 1 || view.getUint16(10, true) !== 160 ||
    data.subarray(12, 16).some(Boolean) || data[152] !== 1 || data.subarray(154, 160).some(Boolean) ||
    isZeroBytes(data.subarray(16, 48)) || isZeroBytes(data.subarray(48, 80)) || isZeroBytes(data.subarray(80, 112))) {
    betaError("ACCOUNT_MALFORMED", "Composite fee vault V1 is malformed");
  }
  const ownerGenerated = u64(data, 112);
  const totalRefreshFees = u64(data, 120);
  const ownerClaimed = u64(data, 128);
  const treasuryPaid = u64(data, 136);
  const lastAccrualRevision = u64(data, 144);
  if (ownerGenerated + treasuryPaid !== totalRefreshFees || ownerClaimed > ownerGenerated ||
    ((totalRefreshFees === 0n) !== (lastAccrualRevision === 0n))) {
    betaError("ACCOUNT_MALFORMED", "Composite fee vault ledger is inconsistent");
  }
  return {
    feed: bytesAddress(data.subarray(16, 48)),
    compositeConfig: bytesAddress(data.subarray(48, 80)),
    identityAsset: bytesAddress(data.subarray(80, 112)),
    ownerGenerated,
    ownerClaimed,
    bump: data[153]!,
  };
}

export async function inspectMimirBetaCompositeRevenue(args: Readonly<{
  feed: Address;
  deployment: MimirBetaDeployment;
  rpc: MimirBetaFinalizedRpc;
  minContextSlot?: bigint;
}>): Promise<MimirBetaCompositeRevenue> {
  const deployment = validateMimirBetaDeployment(args.deployment);
  let feed: Address;
  try { feed = address(args.feed); } catch { return betaError("INVALID_ARGUMENT", "Composite feed address is invalid"); }
  const reader = new FinalizedRpcReader(args.rpc);
  const discovery = await reader.account(feed, args.minContextSlot);
  const discoveryAccount = discovery.value;
  if (!discoveryAccount) betaError("ACCOUNT_NOT_FOUND", "Composite feed is missing", feed);
  if (discoveryAccount.owner !== deployment.mimirProgramId || discoveryAccount.executable) {
    betaError("ACCOUNT_OWNER_MISMATCH", "Composite feed owner mismatch", feed);
  }
  const first = decodeMimirCompositeConfig(discoveryAccount.data);
  if (first.components.length < 1) betaError("ACCOUNT_MALFORMED", "Composite requires 1..5 components");
  if (first.version !== 1 || first.identityAsset === null) betaError("IDENTITY_UNVERIFIED", "Composite feed has no Claim identity");
  const configPda = await deriveMimirBetaPda({ programId: deployment.mimirProgramId, seed: "composite_feed_config", values: [addressBytes(first.feedId)] });
  const vaultPda = await deriveMimirBetaPda({ programId: deployment.mimirProgramId, seed: "feed_fee_vault", values: [addressBytes(first.feedId)] });
  if (configPda[0] !== feed || configPda[1] !== first.bump) betaError("PDA_MISMATCH", "Composite feed PDA mismatch", feed);
  const coherent = await reader.accounts([feed, vaultPda[0], first.identityAsset], discovery.slot);
  const [feedAccount, vaultAccount, assetAccount] = coherent.value;
  if (!feedAccount || !vaultAccount || !assetAccount) betaError("ACCOUNT_NOT_FOUND", "Composite revenue account is missing");
  if (feedAccount.owner !== deployment.mimirProgramId || feedAccount.executable ||
    vaultAccount.owner !== deployment.mimirProgramId || vaultAccount.executable) {
    betaError("ACCOUNT_OWNER_MISMATCH", "Composite revenue account owner mismatch");
  }
  const composite = decodeMimirCompositeConfig(feedAccount.data);
  if (composite.version !== 1 || composite.feedId !== first.feedId || composite.identityAsset !== first.identityAsset ||
    composite.bump !== configPda[1]) betaError("RPC_CONTEXT_MISMATCH", "Composite identity changed during revenue read");
  const vault = assertMimirBetaCompositeFeeVaultBinding(vaultAccount.data, composite, feed, vaultPda);
  const asset = decodeMimirBetaCoreAsset(assetAccount, deployment, composite.identityAsset);
  if (asset.collection !== deployment.physicalCollection) betaError("IDENTITY_UNVERIFIED", "Composite Core collection mismatch");
  const claimable = vault.ownerGenerated - vault.ownerClaimed;
  return Object.freeze({
    feed,
    feedId: composite.feedId,
    feeVault: vaultPda[0],
    identityAsset: composite.identityAsset,
    currentOwner: asset.liveOwner,
    eligible: claimable > 0n,
    totalOwnerGeneratedLamports: vault.ownerGenerated,
    ownerClaimedLamports: vault.ownerClaimed,
    ownerClaimableLamports: claimable,
    observedSlot: coherent.slot,
  });
}

export async function buildMimirBetaCompositeRevenueClaimInstruction(args: Readonly<{
  deployment: MimirBetaDeployment;
  revenue: MimirBetaCompositeRevenue;
}>): Promise<MimirBetaInstruction> {
  const deployment = validateMimirBetaDeployment(args.deployment);
  if (!args.revenue.eligible || args.revenue.ownerClaimableLamports <= 0n) betaError("INVALID_ARGUMENT", "Composite revenue is not claimable");
  const data = new Uint8Array(49);
  data[0] = 63;
  data.set(addressBytes(args.revenue.feedId), 1);
  const view = new DataView(data.buffer);
  view.setBigUint64(33, args.revenue.ownerClaimedLamports, true);
  view.setBigUint64(41, args.revenue.ownerClaimableLamports, true);
  return {
    programAddress: deployment.mimirProgramId,
    accounts: [
      { address: args.revenue.currentOwner, isSigner: true, isWritable: true },
      { address: args.revenue.feed, isSigner: false, isWritable: false },
      { address: args.revenue.feeVault, isSigner: false, isWritable: true },
      { address: args.revenue.identityAsset, isSigner: false, isWritable: false },
    ],
    data,
  };
}

function parseBlockhash(value: unknown): Readonly<{ blockhash: string; lastValidBlockHeight: bigint }> {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const candidate = record?.value && typeof record.value === "object" ? record.value as Record<string, unknown> : record;
  const height = candidate?.lastValidBlockHeight;
  if (!candidate || typeof candidate.blockhash !== "string" ||
    !((typeof height === "bigint" && height >= 0n) || (typeof height === "number" && Number.isSafeInteger(height) && height >= 0))) {
    betaError("RPC_CONTEXT_MISMATCH", "latest finalized blockhash response malformed");
  }
  return { blockhash: candidate.blockhash, lastValidBlockHeight: typeof height === "bigint" ? height : BigInt(height) };
}

async function simulateExact(rpc: MimirBetaPlanningRpc, wire: Uint8Array, minContextSlot: bigint,
  expectedProgram: Address): Promise<MimirBetaSimulationFacts> {
  const response = await rpc.simulateTransaction(base64(wire), {
    commitment: "confirmed", encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, minContextSlot,
  }).send();
  if (!response || typeof response !== "object") betaError("SIMULATION_FAILED", "Claim simulation response malformed");
  const record = response as Record<string, unknown>;
  const context = record.context as Record<string, unknown> | undefined;
  const value = record.value as Record<string, unknown> | undefined;
  const rawSlot = context?.slot;
  const contextSlot = typeof rawSlot === "bigint" ? rawSlot : typeof rawSlot === "number" && Number.isSafeInteger(rawSlot) ? BigInt(rawSlot) : -1n;
  if (!value || contextSlot < minContextSlot || value.err !== null) betaError("SIMULATION_FAILED", "exact Claim simulation failed");
  const logs = Array.isArray(value.logs) && value.logs.every((entry) => typeof entry === "string") ? value.logs as string[] : [];
  let returnDataHash: string | null = null;
  if (value.returnData !== null && value.returnData !== undefined) {
    const returned = value.returnData as Record<string, unknown>; const data = returned.data;
    if (returned.programId !== expectedProgram || !Array.isArray(data) || data.length !== 2 || data[1] !== "base64" || typeof data[0] !== "string") {
      betaError("SIMULATION_FAILED", "Claim simulation return data malformed");
    }
    returnDataHash = hex(await sha256(fromBase64(data[0])));
  }
  const units = value.unitsConsumed;
  const unitsConsumed = units === undefined || units === null ? null : typeof units === "bigint" ? units :
    typeof units === "number" && Number.isSafeInteger(units) && units >= 0 ? BigInt(units) :
      betaError("SIMULATION_FAILED", "Claim simulation units malformed");
  return { status: "succeeded", contextSlot, unitsConsumed,
    logsHash: hex(await sha256(utf8(canonicalJson(logs as never)))), returnDataHash, error: null };
}

export async function prepareMimirBetaCompositeRevenueClaim(
  dependencies: Readonly<{ deployment: MimirBetaFacadeDeployment; rpc: MimirBetaPlanningRpc }>,
  args: Readonly<{ feed: Address; currentOwner: Address; minContextSlot?: bigint }>,
): Promise<MimirBetaPreparedCompositeRevenueClaim> {
  let currentOwner: Address;
  try { currentOwner = address(args.currentOwner); } catch { return betaError("INVALID_ARGUMENT", "Claim owner is invalid"); }
  const revenue = await inspectMimirBetaCompositeRevenue({ ...args, deployment: dependencies.deployment, rpc: dependencies.rpc });
  if (revenue.currentOwner !== currentOwner) betaError("IDENTITY_UNVERIFIED", "Claim signer is not the current Core owner");
  const instruction = await buildMimirBetaCompositeRevenueClaimInstruction({ deployment: dependencies.deployment, revenue });
  const blockhash = parseBlockhash(await dependencies.rpc.getLatestBlockhash({ commitment: "confirmed" }).send());
  const transaction = await compileMimirBetaTransactionV1({ feePayer: currentOwner, recentBlockhash: blockhash.blockhash,
    lastValidBlockHeight: blockhash.lastValidBlockHeight, instructions: [instruction] });
  if (transaction.requiredSigners.length !== 1 || transaction.requiredSigners[0] !== currentOwner ||
    transaction.instructions.length !== 1 || transaction.serializedTransaction[0] !== 0x81) {
    betaError("PROGRAM_ABI_MISMATCH", "Claim must be one Transaction v1 with one current-owner signer");
  }
  const simulation = await simulateExact(dependencies.rpc, transaction.serializedTransaction, revenue.observedSlot,
    dependencies.deployment.mimirProgramId);
  if (dependencies.deployment.cluster === "mainnet-beta") assertMimirStrictSimulation(transaction, { err: null, unitsConsumed: simulation.unitsConsumed });
  const review: MimirBetaCompositeRevenueClaimReviewV1 = {
    schema: "mimir-beta-composite-revenue-claim-review",
    version: 1,
    programId: dependencies.deployment.mimirProgramId,
    feed: revenue.feed,
    feedId: revenue.feedId,
    feeVault: revenue.feeVault,
    identityAsset: revenue.identityAsset,
    currentOwner,
    totalOwnerGeneratedLamports: revenue.totalOwnerGeneratedLamports,
    expectedOwnerClaimedLamports: revenue.ownerClaimedLamports,
    claimAmountLamports: revenue.ownerClaimableLamports,
    instruction: {
      programAddress: instruction.programAddress,
      accounts: instruction.accounts,
      dataBase64: base64(instruction.data),
      dataSha256: hex(await sha256(instruction.data)),
    },
    messageHash: transaction.messageHash,
    packet: transaction.packet,
    simulation,
    warnings: [],
  };
  const hashes = await createReviewHash(review);
  return Object.freeze({ schema: "mimir-beta-prepared-composite-revenue-claim", version: 1,
    revenue, transaction, simulation, review, ...hashes });
}

export async function createMimirBetaCompositeRevenueClaimReceipt(args: Readonly<{
  prepared: MimirBetaPreparedCompositeRevenueClaim;
  signature: string;
  walletSignedTransaction?: Uint8Array;
}>): Promise<MimirBetaCompositeRevenueClaimReceiptV2> {
  const review = await authenticateReview(args.prepared.review);
  const hashes = await createReviewHash(review);
  const signature = receiptSignature(args.signature);
  if (args.prepared.canonicalReviewJson !== hashes.canonicalReviewJson || args.prepared.reviewHash !== hashes.reviewHash ||
    args.prepared.transaction.messageHash !== review.messageHash || args.prepared.transaction.messageHash !== args.prepared.review.messageHash ||
    args.prepared.transaction.messageVersion !== 1 || args.prepared.transaction.feePayer !== review.currentOwner ||
    args.prepared.transaction.requiredSigners.length !== 1 || args.prepared.transaction.requiredSigners[0] !== review.currentOwner ||
    args.prepared.transaction.instructions.length !== 1 ||
    !bytesEqual(args.prepared.transaction.instructions[0]?.data ?? new Uint8Array(), fromBase64(review.instruction.dataBase64))) {
    betaError("RECEIPT_MISMATCH", "signed Claim does not match the exact prepared review/message");
  }
  let message = { serializedMessage: args.prepared.transaction.serializedMessage, messageHash: review.messageHash };
  if (args.walletSignedTransaction) {
    const verified = await verifyMimirBetaWalletSignedTransactionV1({ transaction: args.prepared.transaction,
      walletAddress: review.currentOwner, walletSignedTransaction: args.walletSignedTransaction, preservedSignatures: [] });
    if (verified.firstSignature !== args.signature) betaError("RECEIPT_MISMATCH", "wallet-signed Claim signature differs from receipt signature");
    message = verified;
  }
  await authenticateClaimMessage(message.serializedMessage, signature, review, "RECEIPT_MISMATCH", message.messageHash);
  const receipt: MimirBetaCompositeRevenueClaimReceiptV2 = { schema: "mimir-beta-composite-revenue-claim-receipt", version: 2,
    review, canonicalReviewJson: hashes.canonicalReviewJson, reviewHash: hashes.reviewHash, messageHash: message.messageHash,
    messageBase64: base64(message.serializedMessage), signature: args.signature };
  Object.defineProperty(receipt, "toJSON", { enumerable: false, value: () => jsonSafe(receipt) });
  return Object.freeze(receipt);
}

export async function authenticateMimirBetaCompositeRevenueClaimReceipt(
  input: unknown,
): Promise<MimirBetaCompositeRevenueClaimReceipt> {
  if (!input || typeof input !== "object") betaError("RECEIPT_MISMATCH", "Claim receipt schema is not exact");
  const raw = input as Record<string, unknown>;
  if ((raw.version !== 1 && raw.version !== 2) || !exactKeys(raw, raw.version === 1 ? RECEIPT_V1_KEYS : RECEIPT_V2_KEYS) ||
    raw.schema !== "mimir-beta-composite-revenue-claim-receipt" ||
    typeof raw.canonicalReviewJson !== "string" || typeof raw.reviewHash !== "string" || !/^[0-9a-f]{64}$/.test(raw.reviewHash) ||
    typeof raw.messageHash !== "string" || !/^[0-9a-f]{64}$/.test(raw.messageHash)) betaError("RECEIPT_MISMATCH", "Claim receipt fields are invalid");
  receiptSignature(raw.signature);
  const review = await authenticateReview(raw.review);
  const hashes = await createReviewHash(review);
  if (raw.canonicalReviewJson !== hashes.canonicalReviewJson || raw.reviewHash !== hashes.reviewHash ||
    raw.version === 1 && raw.messageHash !== review.messageHash) {
    betaError("RECEIPT_MISMATCH", "Claim receipt review hash binding failed");
  }
  if (raw.version === 1) return Object.freeze({ schema: "mimir-beta-composite-revenue-claim-receipt", version: 1, review,
    canonicalReviewJson: hashes.canonicalReviewJson, reviewHash: hashes.reviewHash, messageHash: review.messageHash,
    signature: raw.signature as string });
  if (typeof raw.messageBase64 !== "string") betaError("RECEIPT_MISMATCH", "Claim message is not canonical base64");
  let messageBytes: Uint8Array;
  try { messageBytes = fromBase64(raw.messageBase64); }
  catch { return betaError("RECEIPT_MISMATCH", "Claim message is not canonical base64"); }
  if (messageBytes.length < 1 || messageBytes.length > 4096 ||
    hex(await sha256(messageBytes)) !== raw.messageHash) betaError("RECEIPT_MISMATCH", "Claim message hash binding failed");
  await authenticateClaimMessage(messageBytes, receiptSignature(raw.signature), review, "RECEIPT_MISMATCH", raw.messageHash);
  return Object.freeze({ schema: "mimir-beta-composite-revenue-claim-receipt", version: 2, review,
    canonicalReviewJson: hashes.canonicalReviewJson, reviewHash: hashes.reviewHash, messageHash: raw.messageHash,
    messageBase64: raw.messageBase64, signature: raw.signature as string });
}

export async function reconcileMimirBetaCompositeRevenueClaim(args: Readonly<{
  deployment: MimirBetaDeployment;
  rpc: MimirBetaReconciliationRpc;
  receipt: unknown;
  prepared?: MimirBetaPreparedCompositeRevenueClaim;
}>): Promise<MimirBetaCompositeRevenueClaimOutcome> {
  const deployment = validateMimirBetaDeployment(args.deployment);
  const receipt = await authenticateMimirBetaCompositeRevenueClaimReceipt(args.receipt);
  if (deployment.mimirProgramId !== receipt.review.programId || args.prepared &&
    (args.prepared.reviewHash !== receipt.reviewHash || args.prepared.transaction.messageHash !== receipt.review.messageHash ||
      args.prepared.canonicalReviewJson !== receipt.canonicalReviewJson)) {
    betaError("RECONCILIATION_CONFLICT", "Claim receipt differs from deployment or in-memory prepared Claim");
  }
  const getTransaction = async () => decodeMimirBetaFinalizedTransactionResponse(receipt.signature,
    await args.rpc.getTransaction(receipt.signature, {
      commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 1,
    }).send());
  const verify = async (evidence: MimirBetaFinalizedTransactionEvidence): Promise<MimirBetaCompositeRevenueClaimOutcome> => {
    const { resolved } = await authenticateClaimMessage(evidence.messageBytes, receiptSignature(receipt.signature), receipt.review,
      "RECONCILIATION_CONFLICT", receipt.messageHash);
    if (evidence.signatures.length !== 1 || evidence.signatures[0] !== receipt.signature ||
      evidence.meta.loadedAddresses.writable.length !== 0 || evidence.meta.loadedAddresses.readonly.length !== 0 ||
      evidence.resolvedAccountKeys.length !== resolved.length ||
      evidence.resolvedAccountKeys.some((value, index) => value !== resolved[index])) {
      betaError("RECONCILIATION_CONFLICT", "finalized Claim message/signature/accounts/roles differ from receipt");
    }
    const ownerIndex = resolved.indexOf(receipt.review.currentOwner); const vaultIndex = resolved.indexOf(receipt.review.feeVault);
    if (evidence.meta.preBalances.length !== resolved.length || evidence.meta.postBalances.length !== resolved.length || ownerIndex < 0 || vaultIndex < 0) {
      betaError("RECONCILIATION_CONFLICT", "finalized Claim balance vectors are incomplete");
    }
    if (evidence.meta.err !== null) {
      if (evidence.meta.postBalances.some((balance, index) => balance - evidence.meta.preBalances[index]! !== (index === ownerIndex ? -evidence.meta.fee : 0n))) {
        betaError("RECONCILIATION_CONFLICT", "failed Claim has non-atomic balance effects");
      }
      return Object.freeze({ state: "failed", signature: receipt.signature, slot: evidence.slot,
        errorHash: await domainHash("MIMIR_BETA_CLAIM_ERROR_V1\0", evidence.meta.err) });
    }
    if (evidence.meta.postBalances.some((balance, index) => {
      const delta = balance - evidence.meta.preBalances[index]!;
      return delta !== (index === ownerIndex ? receipt.review.claimAmountLamports - evidence.meta.fee :
        index === vaultIndex ? -receipt.review.claimAmountLamports : 0n);
    })) betaError("RECONCILIATION_CONFLICT", "successful Claim payment/vault debit is not exact after fee");
    const revenue = await inspectMimirBetaCompositeRevenue({ feed: receipt.review.feed,
      deployment, rpc: args.rpc, minContextSlot: evidence.slot });
    const expectedClaimed = receipt.review.expectedOwnerClaimedLamports + receipt.review.claimAmountLamports;
    if (revenue.feedId !== receipt.review.feedId || revenue.feeVault !== receipt.review.feeVault ||
      revenue.identityAsset !== receipt.review.identityAsset || revenue.currentOwner !== receipt.review.currentOwner ||
      revenue.ownerClaimedLamports !== expectedClaimed ||
      revenue.totalOwnerGeneratedLamports < receipt.review.totalOwnerGeneratedLamports) {
      betaError("RECONCILIATION_CONFLICT", "finalized Claim ledger transition is not exact");
    }
    return Object.freeze({ state: "finalized", signature: receipt.signature, slot: evidence.slot, revenue });
  };
  let transaction = await getTransaction();
  if (transaction) return verify(transaction);
  if (receipt.version === 1) return Object.freeze({ state: "pending", signature: receipt.signature });
  const authenticatedMessage = await authenticateClaimMessage(fromBase64(receipt.messageBase64), receiptSignature(receipt.signature),
    receipt.review, "RECEIPT_MISMATCH", receipt.messageHash);
  if (!args.rpc.getSignatureStatuses || !args.rpc.isBlockhashValid) {
    betaError("TRANSACTION_MALFORMED", "reconciliation RPC does not support authenticated expiry history");
  }
  const getSignatureStatuses = args.rpc.getSignatureStatuses.bind(args.rpc);
  const isBlockhashValid = args.rpc.isBlockhashValid.bind(args.rpc);
  const status1 = decodeMimirBetaSignatureStatusResponse(await getSignatureStatuses([receipt.signature],
    { searchTransactionHistory: true }).send());
  if (status1.status) {
    if (status1.status.confirmationStatus !== "finalized") return Object.freeze({ state: "pending", signature: receipt.signature });
    transaction = await getTransaction();
    if (!transaction) betaError("RECONCILIATION_CONFLICT", "finalized signature status has no finalized transaction body");
    return verify(transaction);
  }
  const validity = decodeMimirBetaBlockhashValidityResponse(await isBlockhashValid(authenticatedMessage.blockhash,
    { commitment: "confirmed" }).send());
  if (validity.valid) return Object.freeze({ state: "pending", signature: receipt.signature });
  const status2 = decodeMimirBetaSignatureStatusResponse(await getSignatureStatuses([receipt.signature],
    { searchTransactionHistory: true }).send());
  if (status2.slot < validity.slot || status2.slot < status1.slot) {
    betaError("RPC_CONTEXT_MISMATCH", "post-invalidity signature status context regressed");
  }
  if (status2.status) {
    if (status2.status.confirmationStatus !== "finalized") return Object.freeze({ state: "pending", signature: receipt.signature });
    transaction = await getTransaction();
    if (!transaction) betaError("RECONCILIATION_CONFLICT", "finalized signature status has no finalized transaction body");
    return verify(transaction);
  }
  transaction = await getTransaction();
  if (transaction) return verify(transaction);
  const evidenceHash = await domainHash("MIMIR_BETA_CLAIM_EXPIRED_EVIDENCE_V1\0", canonicalJson({ signature: receipt.signature,
    messageHash: receipt.messageHash, blockhash: authenticatedMessage.blockhash, observedSlot: status2.slot }));
  return Object.freeze({ state: "expired", signature: receipt.signature, observedSlot: status2.slot,
    messageHash: receipt.messageHash, blockhash: authenticatedMessage.blockhash, evidenceHash });
}
