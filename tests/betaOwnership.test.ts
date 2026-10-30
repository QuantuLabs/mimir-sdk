import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import bs58 from "bs58";
import {
  Key,
  PluginType,
  basePluginAuthority,
  getKeySerializer,
  getPluginHeaderV1AccountDataSerializer,
  getPluginSerializer,
  getRegistryRecordSerializer,
  plugin,
  ruleSet,
} from "@metaplex-foundation/mpl-core";
import { getAddressFromPublicKey, getProgramDerivedAddress, type Address } from "@solana/kit";
import { getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder } from "@solana/transaction-messages";
import { none, publicKey } from "@metaplex-foundation/umi";
import { option, publicKey as publicKeySerializer, string, u32, u64 } from "@metaplex-foundation/umi/serializers";
import { addressBytes, base64, bytesAddress, canonicalJson, concatBytes, domainHash, utf8 } from "../src/beta/bytes.js";
import { encodeMimirClassicV1, encodeMimirCompositeV1 } from "../src/beta/codecs.js";
import {
  MIMIR_BETA_MPL_CORE_PROGRAM_ID,
  MIMIR_BETA_SYSTEM_PROGRAM_ID,
  type MimirBetaDeployment,
} from "../src/beta/deployment.js";
import { createMimir8004IdentityAdapter } from "../src/beta/identity8004.js";
import {
  buildMimirBetaCoreTransferV1,
  decodeMimirBetaCoreAsset,
  decodeMimirBetaCoreCollection,
} from "../src/beta/mplCore.js";
import { inspectMimirFeedOwnership } from "../src/beta/ownership.js";
import {
  buildMimirBetaCompositeRevenueClaimInstruction,
  authenticateMimirBetaCompositeRevenueClaimReceipt,
  createMimirBetaCompositeRevenueClaimReceipt,
  inspectMimirBetaCompositeRevenue,
  prepareMimirBetaCompositeRevenueClaim,
  reconcileMimirBetaCompositeRevenueClaim,
} from "../src/beta/revenue.js";
import type { MimirBetaFinalizedRpc } from "../src/beta/rpc.js";
import type { MimirBetaAccount } from "../src/beta/types.js";

const bytesEqualTest = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((byte, at) => byte === right[at]);
const addr = (byte: number) => bytesAddress(Uint8Array.from({ length: 32 }, () => byte));
const mimirProgramId = addr(10); const identityProgramId = addr(11);
const collection = addr(13); const creator = addr(14); const asset = addr(15);
const ownerKeys = await webcrypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
const liveOwner = await getAddressFromPublicKey(ownerKeys.publicKey);
const pointer = "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const deployment: MimirBetaDeployment = {
  cluster: "localnet",
  mimirProgramId,
  agentRegistryProgramId: identityProgramId,
  mplCoreProgramId: MIMIR_BETA_MPL_CORE_PROGRAM_ID,
  systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID,
  physicalCollection: collection,
  collectionPointer: pointer,
};
const adapter = createMimir8004IdentityAdapter(deployment);
const feedId = addr(1);
const baseMint = addr(2); const quoteMint = addr(3);
const [[feedAddress, feedBump], [feeAddress, feeBump], [compositeAddress, compositeBump],
  [rootAddress, rootBump], [registryAddress, registryBump], [agentAddress, agentBump], [metadataAddress, metadataBump]] = await Promise.all([
  getProgramDerivedAddress({ programAddress: mimirProgramId, seeds: [utf8("feed_config"), addressBytes(feedId)] }),
  getProgramDerivedAddress({ programAddress: mimirProgramId, seeds: [utf8("feed_fee_vault"), addressBytes(feedId)] }),
  getProgramDerivedAddress({ programAddress: mimirProgramId, seeds: [utf8("composite_feed_config"), addressBytes(feedId)] }),
  adapter.deriveRootConfig(), adapter.deriveRegistryConfig(), adapter.deriveAgentAccount(asset), adapter.deriveDisplayNameMetadata(asset),
]);
const account = (address: Address, owner: Address, data: Uint8Array, executable = false): MimirBetaAccount => ({ address, owner, executable, lamports: 1n, data });

const assetBase = (owner: Address, boundCollection = collection) => concatBytes(
  getKeySerializer().serialize(Key.AssetV1),
  publicKeySerializer().serialize(publicKey(owner)),
  new Uint8Array([2]),
  publicKeySerializer().serialize(publicKey(boundCollection)),
  string().serialize("Agent"),
  string().serialize("ipfs://asset"),
  option(u64()).serialize(none()),
);
const assetWithPlugin = (
  owner: Address,
  bytesKind: "Attributes" | "Royalties" = "Attributes",
  registryKind: PluginType = PluginType.Attributes,
  boundCollection = collection,
) => {
  const base = assetBase(owner, boundCollection);
  const serialized = bytesKind === "Attributes"
    ? getPluginSerializer().serialize(plugin("Attributes", [{ attributeList: [{ key: "role", value: "oracle" }] }]))
    : getPluginSerializer().serialize(plugin("Royalties", [{ basisPoints: 500, creators: [], ruleSet: ruleSet("None") }]));
  const pluginOffset = base.length + 9;
  const registryOffset = pluginOffset + serialized.length;
  const header = getPluginHeaderV1AccountDataSerializer().serialize({ key: Key.PluginHeaderV1, pluginRegistryOffset: registryOffset });
  const registry = concatBytes(
    getKeySerializer().serialize(Key.PluginRegistryV1),
    u32().serialize(1),
    getRegistryRecordSerializer().serialize({ pluginType: registryKind, authority: basePluginAuthority("Owner"), offset: pluginOffset }),
    u32().serialize(0),
  );
  return concatBytes(base, header, serialized, registry);
};
const collectionData = (updateAuthority = registryAddress) => concatBytes(
  getKeySerializer().serialize(Key.CollectionV1),
  publicKeySerializer().serialize(publicKey(updateAuthority)),
  string().serialize("Mimir Agents"),
  string().serialize("ipfs://collection"),
  u32().serialize(1),
  u32().serialize(1),
);

const classic = new Uint8Array(325);
classic.set(new TextEncoder().encode("MIMIRCFG"));
new DataView(classic.buffer).setUint16(10, 325, true);
classic.set(addressBytes(feedId), 16); classic.set(addressBytes(baseMint), 48); classic.set(addressBytes(quoteMint), 80);
classic[120] = 1; classic[121] = 1; classic[122] = 1; classic[312] = feedBump;
const feedAccount = account(feedAddress, mimirProgramId, encodeMimirClassicV1(classic, asset, "CLASS"));
const composite = new Uint8Array(629); composite.set(utf8("MIMIRCFC")); new DataView(composite.buffer).setUint16(10, 629, true);
composite.set(addressBytes(feedId), 16); composite.set(addressBytes(creator), 48); composite.set(addressBytes(quoteMint), 80);
composite[116] = 1; composite[117] = 4; composite[119] = 2; new DataView(composite.buffer).setUint16(120, 1, true);
new DataView(composite.buffer).setUint16(122, 1, true); composite.fill(1, 128, 160);
new DataView(composite.buffer).setBigUint64(160, 1n, true); new DataView(composite.buffer).setBigUint64(168, 1n, true);
new DataView(composite.buffer).setBigUint64(176, 1n, true); composite[184] = compositeBump;
composite.set(addressBytes(addr(20)), 229); composite.set(addressBytes(addr(21)), 261); new DataView(composite.buffer).setBigUint64(293, 1n, true);
composite.set(addressBytes(addr(22)), 309); composite.set(addressBytes(addr(23)), 341); new DataView(composite.buffer).setBigUint64(373, 1n, true);
const compositeAccount = account(compositeAddress, mimirProgramId, encodeMimirCompositeV1(composite, asset, "COMP"));
const fee = new Uint8Array(160);
fee.set(new TextEncoder().encode("MIMIRFEE"));
new DataView(fee.buffer).setUint16(8, 1, true); new DataView(fee.buffer).setUint16(10, 160, true);
fee.set(addressBytes(feedId), 16); fee.set(addressBytes(compositeAddress), 48); fee.set(addressBytes(asset), 80);
new DataView(fee.buffer).setBigUint64(112, 80n, true); new DataView(fee.buffer).setBigUint64(120, 100n, true);
new DataView(fee.buffer).setBigUint64(128, 5n, true); new DataView(fee.buffer).setBigUint64(136, 20n, true);
new DataView(fee.buffer).setBigUint64(144, 1n, true); fee[152] = 1; fee[153] = feeBump;
const feeAccount = account(feeAddress, mimirProgramId, fee);
const root = new Uint8Array(73); root.set([42,216,8,82,19,209,223,246]); root.set(addressBytes(collection), 8); root.set(addressBytes(creator), 40); root[72] = rootBump;
const registry = new Uint8Array(73); registry.set([23,118,10,246,173,231,243,156]); registry.set(addressBytes(collection), 8); registry.set(addressBytes(creator), 40); registry[72] = registryBump;
const agent = new Uint8Array(748); agent.set([241,119,69,140,233,9,112,50]); agent.set(addressBytes(collection), 8); agent.set(addressBytes(creator), 40);
agent.set(addressBytes(addr(99)), 72); agent.set(addressBytes(asset), 104); agent[136] = agentBump;
let agentOffset = 138; agent[agentOffset++] = 0; agentOffset += 32 + 8 + 32 + 8 + 32 + 8; agent[agentOffset++] = 0; agent[agentOffset++] = 0; agent[agentOffset++] = 1;
const agentString = (value: string) => { const bytes = new TextEncoder().encode(value); new DataView(agent.buffer).setUint32(agentOffset, bytes.length, true); agentOffset += 4; agent.set(bytes, agentOffset); agentOffset += bytes.length; };
agentString("ipfs://agent"); agentString("Agent"); agentString(pointer);
const metadataData = (name = "Café Index", boundAsset = asset, immutable = 1, bump = metadataBump, key = "mimir.display_name.v1") => {
  const data = new Uint8Array(332); data.set([48,145,12,249,176,141,197,187]); data.set(addressBytes(boundAsset), 8);
  data[40] = immutable; data[41] = bump; let cursor = 42;
  for (const value of [key, name]) { const bytes = utf8(value); new DataView(data.buffer).setUint32(cursor, bytes.length, true); cursor += 4; data.set(bytes, cursor); cursor += bytes.length; }
  return data;
};

const coreAssetData = assetWithPlugin(liveOwner);
const finalAccounts = new Map<Address, MimirBetaAccount | null>([
  [feedAddress, feedAccount],
  [feeAddress, feeAccount],
  [rootAddress, account(rootAddress, identityProgramId, root)],
  [registryAddress, account(registryAddress, identityProgramId, registry)],
  [agentAddress, account(agentAddress, identityProgramId, agent)],
  [collection, account(collection, MIMIR_BETA_MPL_CORE_PROGRAM_ID, collectionData())],
  [asset, account(asset, MIMIR_BETA_MPL_CORE_PROGRAM_ID, coreAssetData)],
]);
const compositeAccounts = new Map(finalAccounts);
compositeAccounts.delete(feedAddress);
compositeAccounts.set(compositeAddress, compositeAccount);
compositeAccounts.set(metadataAddress, account(metadataAddress, identityProgramId, metadataData()));

const rpcAccount = (value: MimirBetaAccount | null) => value === null ? null : {
  owner: value.owner,
  executable: value.executable,
  lamports: value.lamports,
  data: [Buffer.from(value.data).toString("base64"), "base64"],
};
function fakeRpc(options: {
  discovery?: MimirBetaAccount | null;
  final?: ReadonlyMap<Address, MimirBetaAccount | null>;
  discoverySlot?: bigint;
  finalSlot?: bigint;
  incomplete?: boolean;
} = {}) {
  const calls: Array<{ method: "account" | "multiple"; addresses: readonly Address[]; config: Record<string, unknown> }> = [];
  const rpc: MimirBetaFinalizedRpc = {
    getAccountInfo(requested, config) {
      calls.push({ method: "account", addresses: [requested], config: config as Record<string, unknown> });
      return { send: async () => ({ context: { slot: options.discoverySlot ?? 40n }, value: rpcAccount(options.discovery === undefined ? feedAccount : options.discovery) }) };
    },
    getMultipleAccounts(requested, config) {
      calls.push({ method: "multiple", addresses: requested, config: config as Record<string, unknown> });
      const values = requested.map((requestedAddress) => rpcAccount((options.final ?? finalAccounts).get(requestedAddress) ?? null));
      return { send: async () => ({ context: { slot: options.finalSlot ?? 50n }, value: options.incomplete ? values.slice(0, -1) : values }) };
    },
  };
  return { rpc, calls };
}

const trusted = fakeRpc();
const inspected = await inspectMimirFeedOwnership({
  feed: feedAddress,
  deployment,
  rpc: trusted.rpc,
  minContextSlot: 30n,
  ...({ observedSlot: 999999n, feedAccount: account(feedAddress, addr(90), Uint8Array.of(1)), verifyFeedPda: () => true } as object),
});
assert.equal(inspected.verificationStatus, "verified");
assert.equal(inspected.observedSlot, 50n, "only the coherent GMA context slot is exposed");
assert.equal(inspected.immutableCreator, creator); assert.equal(inspected.identityAsset, asset); assert.equal(inspected.liveCoreOwner, liveOwner);
assert.equal(inspected.displayName, null, "Classic ownership never acquires a display name");
assert.equal(inspected.baseMint, baseMint); assert.equal(inspected.quoteMint, quoteMint);
assert.notEqual(inspected.liveCoreOwner, addr(99), "cached AgentAccount owner must be ignored");
assert.equal(trusted.calls.length, 2); assert.equal(trusted.calls[0]!.method, "account"); assert.equal(trusted.calls[1]!.method, "multiple");
assert.deepEqual(trusted.calls[1]!.addresses, [feedAddress, rootAddress, registryAddress, agentAddress, collection, asset]);
for (const call of trusted.calls) { assert.equal(call.config.commitment, "finalized"); assert.equal(call.config.encoding, "base64"); }
assert.equal(trusted.calls[0]!.config.minContextSlot, 30n, "discovery honors the caller floor");
assert.equal(trusted.calls[1]!.config.minContextSlot, 40n, "coherent read honors the discovery slot floor");

const compositeTrusted = fakeRpc({ discovery: compositeAccount, final: compositeAccounts });
const inspectedComposite = await inspectMimirFeedOwnership({ feed: compositeAddress, deployment, rpc: compositeTrusted.rpc });
assert.equal(inspectedComposite.verificationStatus, "verified"); assert.equal(inspectedComposite.displayName, "Café Index");
assert.equal(inspectedComposite.identityAsset, asset); assert.equal(inspectedComposite.liveCoreOwner, liveOwner);
assert.equal(inspectedComposite.baseMint, null); assert.equal(inspectedComposite.quoteMint, quoteMint);
assert.deepEqual(compositeTrusted.calls[1]!.addresses,
  [compositeAddress, rootAddress, registryAddress, agentAddress, collection, asset, metadataAddress]);
const revenue = await inspectMimirBetaCompositeRevenue({ feed: compositeAddress, deployment,
  rpc: fakeRpc({ discovery: compositeAccount, final: compositeAccounts }).rpc });
assert.deepEqual({ eligible: revenue.eligible, generated: revenue.totalOwnerGeneratedLamports,
  claimed: revenue.ownerClaimedLamports, claimable: revenue.ownerClaimableLamports, owner: revenue.currentOwner },
{ eligible: true, generated: 80n, claimed: 5n, claimable: 75n, owner: liveOwner });
const claim = await buildMimirBetaCompositeRevenueClaimInstruction({ deployment, revenue });
assert.equal(claim.data.length, 49); assert.equal(claim.data[0], 63);
assert.deepEqual(claim.accounts.map(({ address, isSigner, isWritable }) => [address, isSigner, isWritable]), [
  [liveOwner, true, true], [compositeAddress, false, false], [feeAddress, false, true], [asset, false, false],
]);
assert.equal(new DataView(claim.data.buffer).getBigUint64(33, true), 5n);
assert.equal(new DataView(claim.data.buffer).getBigUint64(41, true), 75n);
const planningBase = fakeRpc({ discovery: compositeAccount, final: compositeAccounts });
const planningRpc = {
  ...planningBase.rpc,
  getLatestBlockhash: (config: { commitment: string }) => ({ send: async () => { assert.equal(config.commitment, "confirmed"); return { value: {
    blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 99,
  } }; } }),
  simulateTransaction: (_wire: string, config: { commitment: string }) => ({ send: async () => (claimSimulationCommitments.push(config.commitment),
    config.commitment !== "confirmed" ? { context: { slot: 50 }, value: { err: "BlockhashNotFound", logs: [] } } : { context: { slot: 50 }, value: {
    err: null, logs: [], unitsConsumed: 1, returnData: null,
  } }) }),
};
const claimSimulationCommitments: string[] = [];
const preparedClaim = await prepareMimirBetaCompositeRevenueClaim({
  deployment: { ...deployment, tokenProgramId: addr(77) }, rpc: planningRpc,
}, { feed: compositeAddress, currentOwner: liveOwner });
for (const unitsConsumed of [undefined, 0, 1_400_001]) {
  await assert.rejects(prepareMimirBetaCompositeRevenueClaim({ deployment: { ...deployment, cluster: "mainnet-beta", tokenProgramId: addr(77) }, rpc: { ...planningRpc,
    simulateTransaction: () => ({ send: async () => ({ context: { slot: 50 }, value: { err: null, logs: [], unitsConsumed, returnData: null } }) }) } },
  { feed: compositeAddress, currentOwner: liveOwner }), /no valid compute units/);
}
assert.equal(preparedClaim.transaction.serializedTransaction[0], 0x81);
assert.equal(preparedClaim.transaction.instructions.length, 1);
assert.deepEqual(preparedClaim.transaction.requiredSigners, [liveOwner]);
assert.equal(preparedClaim.review.claimAmountLamports, 75n);
assert.equal(preparedClaim.review.expectedOwnerClaimedLamports, 5n);
assert.equal(preparedClaim.transaction.packet.fitsPacketLimit, true);
const claimSignatureBytes = new Uint8Array(await webcrypto.subtle.sign(
  "Ed25519", ownerKeys.privateKey, preparedClaim.transaction.serializedMessage,
));
const claimSignature = bs58.encode(claimSignatureBytes);
const receipt = await createMimirBetaCompositeRevenueClaimReceipt({ prepared: preparedClaim, signature: claimSignature });
const persistedReceipt = JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>;
assert.deepEqual(Object.keys(persistedReceipt).sort(),
  ["canonicalReviewJson", "messageBase64", "messageHash", "review", "reviewHash", "schema", "signature", "version"]);
assert.equal((persistedReceipt.review as Record<string, unknown>).claimAmountLamports, "75");
assert.equal((persistedReceipt.review as Record<string, unknown>).expectedOwnerClaimedLamports, "5");
assert.equal((persistedReceipt.review as Record<string, unknown>).totalOwnerGeneratedLamports, "80");
assert.equal(persistedReceipt.messageBase64, base64(preparedClaim.transaction.serializedMessage));
assert.doesNotMatch(JSON.stringify(persistedReceipt), /"(?:serialized(?:Message|Transaction)|wireTransaction)":/);
const authenticatedReceipt = await authenticateMimirBetaCompositeRevenueClaimReceipt(persistedReceipt);
assert.equal(authenticatedReceipt.version, 2);
assert.equal(authenticatedReceipt.review.claimAmountLamports, 75n);
assert.deepEqual(await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: persistedReceipt,
  rpc: { ...planningRpc, getTransaction: () => ({ send: async () => null }),
    getSignatureStatuses: () => ({ send: async () => ({ context: { slot: 60 }, value: [null] }) }),
    isBlockhashValid: (_blockhash: string, config: { commitment: string }) => ({ send: async () => {
      assert.equal(config.commitment, "confirmed"); return { context: { slot: 60 }, value: true }; } }) } }),
{ state: "pending", signature: claimSignature });
const cloneReceipt = () => JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>;
for (const mutate of [
  (value: Record<string, unknown>) => { value.reviewHash = "0".repeat(64); },
  (value: Record<string, unknown>) => { value.messageHash = "0".repeat(64); },
  (value: Record<string, unknown>) => { const message = String(value.messageBase64); value.messageBase64 = `${message[0] === "A" ? "B" : "A"}${message.slice(1)}`; },
  (value: Record<string, unknown>) => { value.signature = bs58.encode(new Uint8Array(64).fill(42)); },
  (value: Record<string, unknown>) => { (value.review as Record<string, unknown>).claimAmountLamports = "74"; },
  (value: Record<string, unknown>) => { ((value.review as Record<string, unknown>).instruction as Record<string, unknown>).dataBase64 = "Pw=="; },
  (value: Record<string, unknown>) => { ((((value.review as Record<string, unknown>).instruction as Record<string, unknown>).accounts as Array<Record<string, unknown>>)[0]!).isWritable = false; },
]) {
  const tampered = cloneReceipt(); mutate(tampered);
  await assert.rejects(() => authenticateMimirBetaCompositeRevenueClaimReceipt(tampered), { code: "RECEIPT_MISMATCH" });
}
for (const invalidReceipt of [
  { ...cloneReceipt(), extra: true },
  { ...cloneReceipt(), version: 3 },
  { ...cloneReceipt(), messageBase64: `${String(receipt.messageBase64)}=` },
  { ...cloneReceipt(), version: 1 },
]) await assert.rejects(() => authenticateMimirBetaCompositeRevenueClaimReceipt(invalidReceipt), { code: "RECEIPT_MISMATCH" });
const otherPreparedClaim = await prepareMimirBetaCompositeRevenueClaim({
  deployment: { ...deployment, tokenProgramId: addr(77) },
  rpc: { ...planningRpc, getLatestBlockhash: () => ({ send: async () => ({ value: {
    blockhash: addr(88), lastValidBlockHeight: 100,
  } }) }) },
}, { feed: compositeAddress, currentOwner: liveOwner });
const otherSignature = bs58.encode(new Uint8Array(await webcrypto.subtle.sign(
  "Ed25519", ownerKeys.privateKey, otherPreparedClaim.transaction.serializedMessage,
)));
const otherReceipt = await createMimirBetaCompositeRevenueClaimReceipt({ prepared: otherPreparedClaim, signature: otherSignature });
const crossedReceipt = cloneReceipt(); crossedReceipt.messageBase64 = otherReceipt.messageBase64; crossedReceipt.signature = otherReceipt.signature;
await assert.rejects(() => authenticateMimirBetaCompositeRevenueClaimReceipt(crossedReceipt), { code: "RECEIPT_MISMATCH" });
await assert.rejects(() => createMimirBetaCompositeRevenueClaimReceipt({ prepared: preparedClaim,
  signature: bs58.encode(new Uint8Array(64).fill(42)) }), { code: "RECEIPT_MISMATCH" });
await assert.rejects(() => reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt,
  prepared: { ...preparedClaim, reviewHash: "0".repeat(64) }, rpc: { ...planningRpc,
    getTransaction: () => ({ send: async () => null }) } }), { code: "RECONCILIATION_CONFLICT" });
const claimedFee = fee.slice(); new DataView(claimedFee.buffer).setBigUint64(128, 80n, true);
const claimedAccounts = new Map(compositeAccounts);
claimedAccounts.set(feeAddress, account(feeAddress, mimirProgramId, claimedFee));
const finalizedWire = preparedClaim.transaction.serializedTransaction.slice();
finalizedWire.set(claimSignatureBytes, preparedClaim.transaction.serializedMessage.length);
const claimMessage = getCompiledTransactionMessageDecoder().decode(preparedClaim.transaction.serializedMessage);
assert.equal(claimMessage.version, 1);
if (claimMessage.version !== 1) throw new Error("expected Claim Transaction v1");
const initialBalances = claimMessage.staticAccounts.map(() => 10_000);
const ownerIndex = claimMessage.staticAccounts.indexOf(liveOwner);
const vaultIndex = claimMessage.staticAccounts.indexOf(feeAddress);
assert.notEqual(ownerIndex, -1); assert.notEqual(vaultIndex, -1);
const successfulBalances = initialBalances.slice();
successfulBalances[ownerIndex] = successfulBalances[ownerIndex]! + 70;
successfulBalances[vaultIndex] = successfulBalances[vaultIndex]! - 75;
const finalizedResponse = (err: unknown, postBalances: readonly number[]) => ({
  version: 1, slot: 70, blockTime: null,
  transaction: [Buffer.from(finalizedWire).toString("base64"), "base64"],
  meta: { err, fee: 5, preBalances: initialBalances, postBalances, preTokenBalances: [], postTokenBalances: [],
    loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [] },
});
const finalizedBase = fakeRpc({ discovery: compositeAccount, final: claimedAccounts, discoverySlot: 70n, finalSlot: 71n });
const failedBalances = initialBalances.slice(); failedBalances[ownerIndex] = failedBalances[ownerIndex]! - 5;
const historyStatus = (confirmationStatus: "processed" | "confirmed" | "finalized", slot = 60) =>
  ({ slot, confirmations: null, err: null, confirmationStatus });
function claimReconciliationRpc(options: {
  transactions?: readonly unknown[];
  statuses?: readonly unknown[];
  validity?: unknown;
  finalizedAccounts?: boolean;
} = {}) {
  const calls: string[] = []; let transactionIndex = 0; let statusIndex = 0;
  const transactions = options.transactions ?? [null];
  const statuses = options.statuses ?? [
    { context: { slot: 60 }, value: [null] },
    { context: { slot: 62 }, value: [null] },
  ];
  const base = options.finalizedAccounts ? finalizedBase.rpc : planningRpc;
  return { calls, rpc: {
    ...base,
    getTransaction: () => ({ send: async () => { calls.push("transaction"); return transactions[transactionIndex++] ?? null; } }),
    getSignatureStatuses: () => ({ send: async () => { calls.push("status"); return statuses[statusIndex++]; } }),
    isBlockhashValid: (blockhash: string) => ({ send: async () => {
      calls.push(`validity:${blockhash}`); return options.validity ?? { context: { slot: 61 }, value: false };
    } }),
  } };
}

const validRpc = claimReconciliationRpc({ validity: { context: { slot: 61 }, value: true } });
assert.deepEqual(await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: persistedReceipt, rpc: validRpc.rpc }),
  { state: "pending", signature: claimSignature });
assert.deepEqual(validRpc.calls, ["transaction", "status", `validity:${claimMessage.lifetimeToken}`]);
for (const confirmationStatus of ["processed", "confirmed"] as const) {
  const pendingRpc = claimReconciliationRpc({ statuses: [
    { context: { slot: 60 }, value: [historyStatus(confirmationStatus)] },
  ] });
  assert.equal((await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt, rpc: pendingRpc.rpc })).state, "pending");
  assert.deepEqual(pendingRpc.calls, ["transaction", "status"]);
  const postInvalidRpc = claimReconciliationRpc({ statuses: [
    { context: { slot: 60 }, value: [null] },
    { context: { slot: 62 }, value: [historyStatus(confirmationStatus, 62)] },
  ] });
  assert.equal((await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt, rpc: postInvalidRpc.rpc })).state, "pending");
  assert.deepEqual(postInvalidRpc.calls, ["transaction", "status", `validity:${claimMessage.lifetimeToken}`, "status"]);
}
const claimLagCommitments: string[] = [];
assert.deepEqual(await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: persistedReceipt, rpc: {
  ...claimReconciliationRpc().rpc,
  isBlockhashValid: (_blockhash: string, config: { commitment: string }) => ({ send: async () => {
    claimLagCommitments.push(config.commitment);
    return config.commitment === "finalized" ? { context: { slot: 40 }, value: false } : { context: { slot: 61 }, value: true };
  } }) } }), { state: "pending", signature: claimSignature });
assert.deepEqual(claimLagCommitments, ["confirmed"]);
const expiredRpc = claimReconciliationRpc();
const expired = await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: persistedReceipt, rpc: expiredRpc.rpc });
assert.deepEqual(expiredRpc.calls,
  ["transaction", "status", `validity:${claimMessage.lifetimeToken}`, "status", "transaction"]);
assert.deepEqual(expired, {
  state: "expired", signature: claimSignature, observedSlot: 62n, messageHash: receipt.messageHash,
  blockhash: claimMessage.lifetimeToken,
  evidenceHash: await domainHash("MIMIR_BETA_CLAIM_EXPIRED_EVIDENCE_V1\0", canonicalJson({ signature: claimSignature,
    messageHash: receipt.messageHash, blockhash: claimMessage.lifetimeToken, observedSlot: 62n })),
});
const statusRace = claimReconciliationRpc({ finalizedAccounts: true, transactions: [null, finalizedResponse(null, successfulBalances)],
  statuses: [{ context: { slot: 70 }, value: [historyStatus("finalized", 70)] }] });
assert.equal((await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt, rpc: statusRace.rpc })).state, "finalized");
assert.deepEqual(statusRace.calls.slice(0, 3), ["transaction", "status", "transaction"]);
const finalRace = claimReconciliationRpc({ transactions: [null, finalizedResponse({ InstructionError: [0, 1] }, failedBalances)] });
assert.equal((await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt, rpc: finalRace.rpc })).state, "failed");
assert.deepEqual(finalRace.calls,
  ["transaction", "status", `validity:${claimMessage.lifetimeToken}`, "status", "transaction"]);
await assert.rejects(() => reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt,
  rpc: { ...planningRpc, getTransaction: () => ({ send: async () => null }) } }),
{ code: "TRANSACTION_MALFORMED", message: /authenticated expiry history/ });
await assert.rejects(() => reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt,
  rpc: claimReconciliationRpc({ statuses: [{ context: { slot: 60 }, value: [] }] }).rpc }), { code: "TRANSACTION_MALFORMED" });
await assert.rejects(() => reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt,
  rpc: claimReconciliationRpc({ validity: { context: { slot: 61 }, value: "false" } }).rpc }), { code: "TRANSACTION_MALFORMED" });
await assert.rejects(() => reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt,
  rpc: claimReconciliationRpc({ statuses: [
    { context: { slot: 60 }, value: [null] }, { context: { slot: 59 }, value: [null] },
  ], validity: { context: { slot: 61 }, value: false } }).rpc }), { code: "RPC_CONTEXT_MISMATCH" });
for (const statuses of [
  [{ context: { slot: 60 }, value: [historyStatus("finalized")] }],
  [{ context: { slot: 60 }, value: [null] }, { context: { slot: 62 }, value: [historyStatus("finalized", 62)] }],
] as const) {
  await assert.rejects(() => reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt,
    rpc: claimReconciliationRpc({ statuses }).rpc }), { code: "RECONCILIATION_CONFLICT",
      message: /finalized signature status has no finalized transaction body/ });
}

const legacyReceipt = cloneReceipt(); delete legacyReceipt.messageBase64; legacyReceipt.version = 1;
assert.equal((await authenticateMimirBetaCompositeRevenueClaimReceipt(legacyReceipt)).version, 1);
const legacyCalls: string[] = [];
assert.deepEqual(await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: legacyReceipt, rpc: {
  ...planningRpc, getTransaction: () => ({ send: async () => { legacyCalls.push("transaction"); return null; } }),
  getSignatureStatuses: () => ({ send: async () => { legacyCalls.push("status"); throw new Error("unexpected"); } }),
  isBlockhashValid: () => ({ send: async () => { legacyCalls.push("validity"); throw new Error("unexpected"); } }),
} }), { state: "pending", signature: claimSignature });
assert.deepEqual(legacyCalls, ["transaction"]);
const failed = await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: legacyReceipt,
  rpc: { ...planningRpc, getTransaction: () => ({ send: async () => finalizedResponse({ InstructionError: [0, 1] }, failedBalances) }) } });
assert.equal(failed.state, "failed");
const finalized = await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: legacyReceipt,
  rpc: { ...finalizedBase.rpc, getTransaction: () => ({ send: async () => finalizedResponse(null, successfulBalances) }) } });
assert.equal(finalized.state, "finalized");
if (finalized.state === "finalized") {
  assert.equal(finalized.revenue.ownerClaimedLamports, 80n);
  assert.equal(finalized.revenue.ownerClaimableLamports, 0n);
}
const tamperedSignatureReceipt = { ...legacyReceipt };
tamperedSignatureReceipt.signature = bs58.encode(new Uint8Array(64).fill(42));
await assert.rejects(() => reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: tamperedSignatureReceipt,
  rpc: { ...planningRpc, getTransaction: () => ({ send: async () => finalizedResponse(null, successfulBalances) }) } }),
{ code: "RECONCILIATION_CONFLICT" });

type ClaimV1 = Extract<ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>, { version: 1 }>;
const claimCompiled = claimMessage as ClaimV1;
const computeBudgetKey = "ComputeBudget111111111111111111111111111111" as Address;
const encodeClaim = (message: ClaimV1) => new Uint8Array(getCompiledTransactionMessageEncoder().encode(message));
const insertBudget = (message: ClaimV1, data: Uint8Array): ClaimV1 => {
  const present = message.staticAccounts.indexOf(computeBudgetKey);
  const staticAccounts = present >= 0 ? message.staticAccounts : [...message.staticAccounts, computeBudgetKey];
  return { ...message, staticAccounts, numStaticAccounts: staticAccounts.length, numInstructions: message.numInstructions + 1,
    header: present >= 0 ? message.header : { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1 },
    instructionHeaders: [{ programAccountIndex: staticAccounts.indexOf(computeBudgetKey), numInstructionAccounts: 0, numInstructionDataBytes: data.length },
      ...message.instructionHeaders],
    instructionPayloads: [{ instructionAccountIndices: [], instructionData: data }, ...message.instructionPayloads] };
};
assert.equal(claimCompiled.configValues[0]!.value, 14000n);
const claimWire = async (messageBytes: Uint8Array) => {
  const signatureBytes = new Uint8Array(await webcrypto.subtle.sign("Ed25519", ownerKeys.privateKey, messageBytes));
  const wire = new Uint8Array(messageBytes.length + 64); wire.set(messageBytes); wire.set(signatureBytes, messageBytes.length);
  return { wire, signature: bs58.encode(signatureBytes) };
};
const claimFinalized = (wire: Uint8Array, err: unknown, preBalances: readonly number[], postBalances: readonly number[]) => ({
  version: 1, slot: 70, blockTime: null, transaction: [Buffer.from(wire).toString("base64"), "base64"],
  meta: { err, fee: 7, preBalances, postBalances, preTokenBalances: [], postTokenBalances: [],
    loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [] },
});
const rewrittenClaims: Array<[string, Uint8Array]> = [
  ["unchanged", preparedClaim.transaction.serializedMessage],
  ["config priority fee 14000 -> 28000", encodeClaim({ ...claimCompiled,
    configValues: claimCompiled.configValues.map((value, at) => at === 0 ? { ...value, value: 28000n } : value) as ClaimV1["configValues"] })],
  ["config CU limit", encodeClaim({ ...claimCompiled, configValues: claimCompiled.configValues.map((value, at) =>
    at === claimCompiled.configValues.length - 2 ? { kind: "u32", value: 200_000 } : value) as ClaimV1["configValues"] })],
  ["insert CB disc-3 + key", encodeClaim(insertBudget(claimCompiled, Uint8Array.of(3, 5, 0, 0, 0, 0, 0, 0, 0)))],
  ["insert CB disc-2 + disc-3 + key", encodeClaim(insertBudget(insertBudget(claimCompiled, Uint8Array.of(3, 5, 0, 0, 0, 0, 0, 0, 0)),
    Uint8Array.of(2, 0x20, 0xa1, 0x07, 0)))],
];
for (const [label, walletMessage] of rewrittenClaims) {
  const unchanged = label === "unchanged";
  assert.equal(unchanged, bytesEqualTest(walletMessage, preparedClaim.transaction.serializedMessage), label);
  const { wire, signature } = await claimWire(walletMessage);
  const walletReceipt = await createMimirBetaCompositeRevenueClaimReceipt({ prepared: preparedClaim, signature, walletSignedTransaction: wire });
  assert.equal(walletReceipt.review.messageHash, preparedClaim.review.messageHash, label);
  assert.equal(walletReceipt.reviewHash, preparedClaim.reviewHash, label);
  assert.equal(walletReceipt.messageBase64, base64(walletMessage), label);
  assert.equal(walletReceipt.messageHash === preparedClaim.review.messageHash, unchanged, label);
  const reloaded = JSON.parse(JSON.stringify(walletReceipt)) as Record<string, unknown>;
  assert.equal((await authenticateMimirBetaCompositeRevenueClaimReceipt(reloaded)).messageHash, walletReceipt.messageHash, label);
  const actual = getCompiledTransactionMessageDecoder().decode(walletMessage) as ClaimV1;
  for (const prepared of [undefined, preparedClaim]) {
    assert.deepEqual(await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: reloaded, prepared,
      rpc: claimReconciliationRpc({ validity: { context: { slot: 61 }, value: true } }).rpc }), { state: "pending", signature }, label);
    const expiry = claimReconciliationRpc();
    const expiredClaim = await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: reloaded, prepared, rpc: expiry.rpc });
    assert.deepEqual(expiry.calls, ["transaction", "status", `validity:${actual.lifetimeToken}`, "status", "transaction"], label);
    assert.equal(expiredClaim.state === "expired" && expiredClaim.messageHash, walletReceipt.messageHash, label);
    const pre = actual.staticAccounts.map(() => 10_000);
    const post = pre.slice();
    post[actual.staticAccounts.indexOf(liveOwner)] = 10_000 + 75 - 7;
    post[actual.staticAccounts.indexOf(feeAddress)] = 10_000 - 75;
    const finalizedClaim = await reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: reloaded, prepared,
      rpc: { ...finalizedBase.rpc, getTransaction: () => ({ send: async () => claimFinalized(wire, null, pre, post) }) } });
    assert.equal(finalizedClaim.state, "finalized", label);
    const leaked = post.slice(); leaked[leaked.length - 1] = leaked[leaked.length - 1]! + 1;
    await assert.rejects(() => reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: reloaded, prepared,
      rpc: { ...finalizedBase.rpc, getTransaction: () => ({ send: async () => claimFinalized(wire, null, pre, leaked) }) } }),
    { code: "RECONCILIATION_CONFLICT" }, label);
  }
  if (unchanged) continue;
  await assert.rejects(() => createMimirBetaCompositeRevenueClaimReceipt({ prepared: preparedClaim, signature }), { code: "RECEIPT_MISMATCH" }, label);
  await assert.rejects(() => createMimirBetaCompositeRevenueClaimReceipt({ prepared: preparedClaim, signature: claimSignature, walletSignedTransaction: wire }),
    { code: "RECEIPT_MISMATCH" }, label);
  await assert.rejects(() => authenticateMimirBetaCompositeRevenueClaimReceipt({ ...reloaded, version: 1, messageBase64: undefined }),
    { code: "RECEIPT_MISMATCH" }, label);
  const { messageBase64: _dropped, ...v1Shape } = reloaded;
  await assert.rejects(() => authenticateMimirBetaCompositeRevenueClaimReceipt({ ...v1Shape, version: 1 }), { code: "RECEIPT_MISMATCH" }, label);
  for (const tampered of [
    { ...reloaded, messageHash: preparedClaim.review.messageHash },
    { ...reloaded, messageBase64: base64(preparedClaim.transaction.serializedMessage) },
    { ...reloaded, signature: claimSignature },
    { ...reloaded, messageHash: persistedReceipt.messageHash, messageBase64: persistedReceipt.messageBase64 },
  ]) await assert.rejects(() => authenticateMimirBetaCompositeRevenueClaimReceipt(tampered), { code: "RECEIPT_MISMATCH" }, label);
  const original = await claimWire(preparedClaim.transaction.serializedMessage);
  await assert.rejects(() => reconcileMimirBetaCompositeRevenueClaim({ deployment, receipt: reloaded,
    rpc: { ...finalizedBase.rpc, getTransaction: () => ({ send: async () => claimFinalized(original.wire, null, initialBalances, successfulBalances) }) } }),
  { code: "RECONCILIATION_CONFLICT" }, label);
}
const n1729Message = rewrittenClaims[1]![1];
const n1729Compiled = getCompiledTransactionMessageDecoder().decode(n1729Message) as ClaimV1;
const swapped = (message: ClaimV1, from: number, to: number) => {
  const staticAccounts = message.staticAccounts.slice(); [staticAccounts[from], staticAccounts[to]] = [staticAccounts[to]!, staticAccounts[from]!];
  return { ...message, staticAccounts };
};
const ownerAt = n1729Compiled.staticAccounts.indexOf(liveOwner);
const vaultAt = n1729Compiled.staticAccounts.indexOf(feeAddress);
const feedAt = n1729Compiled.staticAccounts.indexOf(compositeAddress);
const programAt = n1729Compiled.instructionHeaders[0]!.programAccountIndex;
const tamperedClaims: Array<[string, ClaimV1]> = [
  ["claim amount", { ...n1729Compiled, instructionPayloads: [{ ...n1729Compiled.instructionPayloads[0]!,
    instructionData: Uint8Array.from(n1729Compiled.instructionPayloads[0]!.instructionData, (byte, at) => at === 41 ? byte - 1 : byte) }] }],
  ["blockhash", { ...n1729Compiled, lifetimeToken: addr(88) as unknown as ClaimV1["lifetimeToken"] }],
  ["owner", { ...n1729Compiled, staticAccounts: n1729Compiled.staticAccounts.map((value, at) => at === ownerAt ? addr(41) : value) }],
  ["program", { ...n1729Compiled, staticAccounts: n1729Compiled.staticAccounts.map((value, at) => at === programAt ? addr(42) : value) }],
  ["vault/feed roles", swapped(n1729Compiled, vaultAt, feedAt)],
  ["extra instruction", { ...n1729Compiled, numInstructions: 2, instructionHeaders: [...n1729Compiled.instructionHeaders, n1729Compiled.instructionHeaders[0]!],
    instructionPayloads: [...n1729Compiled.instructionPayloads, n1729Compiled.instructionPayloads[0]!] }],
  ["CB with account", { ...insertBudget(n1729Compiled, Uint8Array.of(3, 5, 0, 0, 0, 0, 0, 0, 0)), instructionPayloads:
    insertBudget(n1729Compiled, Uint8Array.of(3, 5, 0, 0, 0, 0, 0, 0, 0)).instructionPayloads.map((payload, at) =>
      at === 0 ? { ...payload, instructionAccountIndices: [ownerAt] } : payload),
    instructionHeaders: insertBudget(n1729Compiled, Uint8Array.of(3, 5, 0, 0, 0, 0, 0, 0, 0)).instructionHeaders.map((header, at) =>
      at === 0 ? { ...header, numInstructionAccounts: 1 } : header) }],
];
for (const [label, message] of tamperedClaims) {
  let bytes: Uint8Array;
  try { bytes = encodeClaim(message); } catch { continue; }
  const { wire, signature } = await claimWire(bytes);
  await assert.rejects(() => createMimirBetaCompositeRevenueClaimReceipt({ prepared: preparedClaim, signature, walletSignedTransaction: wire }), label);
  const forged = { ...JSON.parse(JSON.stringify(receipt)), messageHash: Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex"),
    messageBase64: base64(bytes), signature };
  await assert.rejects(() => authenticateMimirBetaCompositeRevenueClaimReceipt(forged), { code: "RECEIPT_MISMATCH" }, label);
}
const n1729Wire = await claimWire(n1729Message);
const missingSignature = n1729Wire.wire.slice(); missingSignature.fill(0, n1729Message.length);
await assert.rejects(() => createMimirBetaCompositeRevenueClaimReceipt({ prepared: preparedClaim, signature: n1729Wire.signature,
  walletSignedTransaction: missingSignature }), { code: "RECEIPT_MISMATCH" });
const badSignature = n1729Wire.wire.slice(); badSignature[n1729Message.length] ^= 1;
await assert.rejects(() => createMimirBetaCompositeRevenueClaimReceipt({ prepared: preparedClaim, signature: bs58.encode(badSignature.subarray(n1729Message.length)),
  walletSignedTransaction: badSignature }), { code: "RECEIPT_MISMATCH" });

const regressedContext = fakeRpc({ discoverySlot: 40n, finalSlot: 39n });
await assert.rejects(
  () => inspectMimirFeedOwnership({ feed: feedAddress, deployment, rpc: regressedContext.rpc, minContextSlot: 30n }),
  { code: "RPC_CONTEXT_MISMATCH" },
);
assert.equal(regressedContext.calls.length, 2); assert.equal(regressedContext.calls[1]!.config.minContextSlot, 40n);
await assert.rejects(() => inspectMimirFeedOwnership({ feed: compositeAddress, deployment,
  rpc: fakeRpc({ discovery: compositeAccount, final: compositeAccounts, discoverySlot: 40n, finalSlot: 39n }).rpc }),
{ code: "RPC_CONTEXT_MISMATCH" });

const transferOwner = addr(40);
const transfer = buildMimirBetaCoreTransferV1({ deployment, asset, authority: liveOwner, payer: liveOwner, newOwner: transferOwner });
assert.equal(transfer.programAddress, MIMIR_BETA_MPL_CORE_PROGRAM_ID); assert.equal(transfer.data[0], 14);
assert.deepEqual(transfer.accounts.map(({ address, isSigner, isWritable }) => [address, isSigner, isWritable]), [
  [asset, false, true], [collection, false, false], [liveOwner, true, true], [liveOwner, true, false],
  [transferOwner, false, false], [MIMIR_BETA_SYSTEM_PROGRAM_ID, false, false], [MIMIR_BETA_MPL_CORE_PROGRAM_ID, false, false],
]);
const transferredAccounts = new Map(finalAccounts);
transferredAccounts.set(asset, account(asset, MIMIR_BETA_MPL_CORE_PROGRAM_ID, assetWithPlugin(transferOwner)));
const afterTransfer = await inspectMimirFeedOwnership({ feed: feedAddress, deployment, rpc: fakeRpc({ final: transferredAccounts, finalSlot: 51n }).rpc });
assert.equal(afterTransfer.liveCoreOwner, transferOwner); assert.equal(afterTransfer.observedSlot, 51n);
assert.deepEqual(feedAccount.data, finalAccounts.get(feedAddress)!.data, "standard transfer does not change feed bytes");
const transferredCompositeAccounts = new Map(compositeAccounts);
transferredCompositeAccounts.set(asset, account(asset, MIMIR_BETA_MPL_CORE_PROGRAM_ID, assetWithPlugin(transferOwner)));
const afterCompositeTransfer = await inspectMimirFeedOwnership({ feed: compositeAddress, deployment,
  rpc: fakeRpc({ discovery: compositeAccount, final: transferredCompositeAccounts, finalSlot: 51n }).rpc });
assert.equal(afterCompositeTransfer.liveCoreOwner, transferOwner); assert.equal(afterCompositeTransfer.displayName, "Café Index");

const status = async (options: Parameters<typeof fakeRpc>[0], feed = feedAddress, selectedDeployment = deployment) =>
  (await inspectMimirFeedOwnership({ feed, deployment: selectedDeployment, rpc: fakeRpc(options).rpc })).verificationStatus;
const replaced = (key: Address, value: MimirBetaAccount | null) => { const map = new Map(finalAccounts); map.set(key, value); return map; };
const compositeStatus = async (final: ReadonlyMap<Address, MimirBetaAccount | null>, finalSlot = 50n) =>
  (await inspectMimirFeedOwnership({ feed: compositeAddress, deployment,
    rpc: fakeRpc({ discovery: compositeAccount, final, finalSlot }).rpc })).verificationStatus;
const replacedComposite = (key: Address, value: MimirBetaAccount | null) => {
  const map = new Map(compositeAccounts); map.set(key, value); return map;
};
const singleCompositeConfig = composite.slice();
singleCompositeConfig[119] = 1; singleCompositeConfig.fill(0, 304, 384);
const singleCompositeAccount = account(compositeAddress, mimirProgramId, encodeMimirCompositeV1(singleCompositeConfig, asset, "COMP"));
const singleCompositeAccounts = new Map(compositeAccounts); singleCompositeAccounts.set(compositeAddress, singleCompositeAccount);
const singleCompositeOwnership = await inspectMimirFeedOwnership({ feed: compositeAddress, deployment,
  rpc: fakeRpc({ discovery: singleCompositeAccount, final: singleCompositeAccounts }).rpc });
assert.equal(singleCompositeOwnership.verificationStatus, "verified");
assert.equal(singleCompositeOwnership.liveCoreOwner, liveOwner);
const singleCompositeRevenue = await inspectMimirBetaCompositeRevenue({ feed: compositeAddress, deployment,
  rpc: fakeRpc({ discovery: singleCompositeAccount, final: singleCompositeAccounts }).rpc });
assert.deepEqual({ eligible: singleCompositeRevenue.eligible, generated: singleCompositeRevenue.totalOwnerGeneratedLamports,
  claimed: singleCompositeRevenue.ownerClaimedLamports, claimable: singleCompositeRevenue.ownerClaimableLamports,
  owner: singleCompositeRevenue.currentOwner }, { eligible: true, generated: 80n, claimed: 5n, claimable: 75n, owner: liveOwner });
const zeroCompositeBytes = singleCompositeAccount.data.slice(); zeroCompositeBytes[119] = 0; zeroCompositeBytes.fill(0, 229, 629);
const zeroCompositeAccount = account(compositeAddress, mimirProgramId, zeroCompositeBytes);
const zeroCompositeAccounts = new Map(compositeAccounts); zeroCompositeAccounts.set(compositeAddress, zeroCompositeAccount);
const zeroCompositeOwnership = await inspectMimirFeedOwnership({ feed: compositeAddress, deployment,
  rpc: fakeRpc({ discovery: zeroCompositeAccount, final: zeroCompositeAccounts }).rpc });
assert.equal(zeroCompositeOwnership.verificationStatus, "unverified");
await assert.rejects(() => inspectMimirBetaCompositeRevenue({ feed: compositeAddress, deployment,
  rpc: fakeRpc({ discovery: zeroCompositeAccount, final: zeroCompositeAccounts }).rpc }));
assert.equal(await compositeStatus(replacedComposite(metadataAddress, null)), "unverified");
assert.equal(await compositeStatus(replacedComposite(metadataAddress, account(metadataAddress, addr(90), metadataData()))), "unverified");
assert.equal(await compositeStatus(replacedComposite(metadataAddress, account(metadataAddress, identityProgramId, metadataData(), true))), "unverified");
assert.equal(await compositeStatus(replacedComposite(metadataAddress, account(metadataAddress, identityProgramId, metadataData("Café Index", asset, 1, metadataBump ^ 1)))), "unverified");
assert.equal(await compositeStatus(replacedComposite(metadataAddress, account(metadataAddress, identityProgramId, metadataData("Café Index", addr(91))))), "unverified");
assert.equal(await compositeStatus(replacedComposite(metadataAddress, account(metadataAddress, identityProgramId, metadataData("Café Index", asset, 0)))), "unverified");
assert.equal(await compositeStatus(replacedComposite(metadataAddress, account(metadataAddress, identityProgramId, metadataData("Café Index", asset, 1, metadataBump, "forged")))), "unverified");
const malformedMetadata = metadataData(); malformedMetadata[70] = 0xff;
assert.equal(await compositeStatus(replacedComposite(metadataAddress, account(metadataAddress, identityProgramId, malformedMetadata))), "unverified");
const paddedMetadata = metadataData(); paddedMetadata[331] = 1;
assert.equal(await compositeStatus(replacedComposite(metadataAddress, account(metadataAddress, identityProgramId, paddedMetadata))), "unverified");
assert.equal(await status({ final: replaced(rootAddress, account(rootAddress, addr(90), root)) }), "unverified");
assert.equal(await status({ final: replaced(rootAddress, account(rootAddress, identityProgramId, root, true)) }), "unverified");
assert.equal(await status({ final: replaced(asset, account(asset, addr(91), coreAssetData)) }), "unverified");
assert.equal(await status({ final: replaced(asset, account(asset, MIMIR_BETA_MPL_CORE_PROGRAM_ID, Uint8Array.of(5))) }), "unverified");
assert.equal(await status({ final: replaced(asset, account(asset, MIMIR_BETA_MPL_CORE_PROGRAM_ID, assetWithPlugin(liveOwner, "Attributes", PluginType.Attributes, addr(42)))) }), "unverified");
assert.equal(await status({ final: replaced(collection, account(collection, MIMIR_BETA_MPL_CORE_PROGRAM_ID, collectionData(addr(43)))) }), "unverified");
const wrongAgentBump = agent.slice(); wrongAgentBump[136] ^= 1;
assert.equal(await status({ final: replaced(agentAddress, account(agentAddress, identityProgramId, wrongAgentBump)) }), "unverified");
const atom = agent.slice(); atom[137] = 1; assert.equal(await status({ final: replaced(agentAddress, account(agentAddress, identityProgramId, atom)) }), "unverified");
const unlocked = agent.slice(); unlocked[261] = 0; assert.equal(await status({ final: replaced(agentAddress, account(agentAddress, identityProgramId, unlocked)) }), "unverified");
const alternateClassicCreator = agent.slice(); alternateClassicCreator.set(addressBytes(addr(44)), 40);
assert.equal(await status({ final: replaced(agentAddress, account(agentAddress, identityProgramId, alternateClassicCreator)) }), "verified");

const wrongFeedBumpData = feedAccount.data.slice(); wrongFeedBumpData[312] ^= 1;
const wrongFeedBump = account(feedAddress, mimirProgramId, wrongFeedBumpData);
assert.equal(await status({ discovery: wrongFeedBump, final: replaced(feedAddress, wrongFeedBump) }), "unverified");
const wrongRequestedFeed = addr(20);
const wrongRequestedMap = new Map(finalAccounts); wrongRequestedMap.set(wrongRequestedFeed, feedAccount);
assert.equal(await status({ final: wrongRequestedMap }, wrongRequestedFeed), "unverified", "requested feed must equal the canonical PDA");
const mutatedFeed = account(feedAddress, mimirProgramId, classic);
assert.equal(await status({ final: replaced(feedAddress, mutatedFeed) }), "unverified", "discovery/final mutation fails closed");
const changedUnitData = feedAccount.data.slice(); changedUnitData.set(addressBytes(addr(4)), 48);
const changedUnit = await inspectMimirFeedOwnership({ feed: feedAddress, deployment,
  rpc: fakeRpc({ discovery: account(feedAddress, mimirProgramId, changedUnitData), final: finalAccounts }).rpc });
assert.equal(changedUnit.verificationStatus, "unverified", "discovery/final unit mutation fails closed");
assert.equal(changedUnit.baseMint, null); assert.equal(changedUnit.quoteMint, null);
await assert.rejects(() => inspectMimirFeedOwnership({ feed: feedAddress, deployment, rpc: fakeRpc({ incomplete: true }).rpc }));
await assert.rejects(() => inspectMimirFeedOwnership({ feed: feedAddress, deployment: { ...deployment, physicalCollection: asset }, rpc: fakeRpc().rpc }));

const legacyMap = new Map<Address, MimirBetaAccount | null>([[feedAddress, account(feedAddress, mimirProgramId, classic)]]);
const legacy = await inspectMimirFeedOwnership({ feed: feedAddress, deployment, rpc: fakeRpc({ discovery: legacyMap.get(feedAddress), final: legacyMap }).rpc });
assert.equal(legacy.verificationStatus, "unverified"); assert.equal(legacy.identityAsset, null); assert.equal(legacy.liveCoreOwner, null);
assert.equal(legacy.baseMint, null); assert.equal(legacy.quoteMint, null);
const missingRpc = fakeRpc({ discovery: null, discoverySlot: 62n });
const missing = await inspectMimirFeedOwnership({ feed: feedAddress, deployment, rpc: missingRpc.rpc });
assert.equal(missing.verificationStatus, "not-found"); assert.equal(missing.observedSlot, 62n); assert.equal(missing.liveCoreOwner, null); assert.equal(missingRpc.calls.length, 1);
assert.equal(missing.baseMint, null); assert.equal(missing.quoteMint, null);

assert.throws(() => decodeMimirBetaCoreAsset(account(asset, MIMIR_BETA_MPL_CORE_PROGRAM_ID, assetWithPlugin(liveOwner, "Attributes", PluginType.Royalties)), deployment, asset));
assert.throws(() => decodeMimirBetaCoreAsset(account(asset, MIMIR_BETA_MPL_CORE_PROGRAM_ID, assetWithPlugin(liveOwner, "Royalties", PluginType.Attributes)), deployment, asset));
const attackerDeployment = { ...deployment, mplCoreProgramId: addr(88), systemProgramId: addr(89) };
assert.throws(() => decodeMimirBetaCoreAsset(account(asset, addr(88), coreAssetData), attackerDeployment, asset));
assert.throws(() => decodeMimirBetaCoreCollection(account(collection, addr(88), collectionData()), attackerDeployment));
assert.throws(() => buildMimirBetaCoreTransferV1({ deployment: attackerDeployment, asset, authority: liveOwner, payer: liveOwner, newOwner: transferOwner }));

assert.ok(claimSimulationCommitments.length > 0);
assert.deepEqual([...new Set(claimSimulationCommitments)], ["confirmed"]);
console.log("beta finalized ownership, official MPL Core, PDA, and transfer tests passed");
