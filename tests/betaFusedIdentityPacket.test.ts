import assert from "node:assert/strict";
import bs58 from "bs58";
import { getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder } from "@solana/transaction-messages";
import { getTransactionDecoder } from "@solana/transactions";
import {
  buildMimirBetaIdentityActivationInstruction,
  buildMimirBetaIdentityCompositeInstruction,
  buildMimirBetaIdentityProposalInstruction,
  buildMimirBetaSourceAppendInstruction,
  encodeMimirBetaCompositeV1Config,
  encodeMimirBetaIdentityCompositeData,
  encodeMimirBetaTicker,
} from "../src/beta/abi.js";
import { addressBytes, base64, bytesAddress, hex, sha256 } from "../src/beta/bytes.js";
import { MIMIR_BETA_SPL_TOKEN_PROGRAM_ID } from "../src/beta/capture.js";
import { MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES } from "../src/beta/creation.js";
import { MIMIR_BETA_MPL_CORE_PROGRAM_ID, MIMIR_BETA_SYSTEM_PROGRAM_ID } from "../src/beta/deployment.js";
import { createMimir8004IdentityAdapter } from "../src/beta/identity8004.js";
import { assertMimirBetaFusedSignedTransaction, type MimirBetaPreparedStep } from "../src/beta/review.js";
import { getAddressFromPublicKey } from "@solana/addresses";
import { webcrypto } from "node:crypto";
import { compileMimirBetaTransactionV1 } from "../src/beta/transactionV1.js";
import { buildMimirFusedCompositeRefreshInstruction, buildMimirInitFusedCompositeClosure, deriveMimirFusedRecipe,
  mimirCompositeExecutionLayout } from "../src/beta/compositeExecution.js";
import type { MimirBetaInstruction, MimirBetaInstructionAccount } from "../src/beta/types.js";

let nextAddress = 1;
const fresh = () => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(28, nextAddress++, false);
  return bytesAddress(bytes);
};
let authority = fresh(); let asset = fresh(); const mimirProgramId = fresh();
const agentRegistryProgramId = fresh(); const physicalCollection = fresh();
const identity = createMimir8004IdentityAdapter({
  cluster: "localnet", mimirProgramId, agentRegistryProgramId,
  mplCoreProgramId: MIMIR_BETA_MPL_CORE_PROGRAM_ID, systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID,
  physicalCollection, collectionPointer: "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});
const meta = (address = fresh(), isSigner = false, isWritable = false): MimirBetaInstructionAccount =>
  ({ address, isSigner, isWritable });
const blockhash = bs58.encode(new Uint8Array(32).fill(91));
const exactBoundaryUri = `https://example.com/${"a".repeat(34)}`;
assert.equal(new TextEncoder().encode(exactBoundaryUri).length, MIMIR_BETA_AGENT_URI_MAX_UTF8_BYTES);
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

function rawCompositeConfig(componentCount: number, ticker = "ABC"): Uint8Array {
  const config = new Uint8Array(661); const view = new DataView(config.buffer);
  view.setUint16(8, 1, true); view.setUint16(10, 661, true); view.setUint32(12, 1, true);
  config[119] = componentCount; config.set(encodeMimirBetaTicker(ticker), 185);
  for (let index = 0; index < componentCount; index += 1) {
    const offset = 229 + index * 80;
    config.fill(index + 1, offset, offset + 32); config.fill(index + 11, offset + 32, offset + 64);
    view.setBigUint64(offset + 64, BigInt(index + 1), true);
  }
  config.set(addressBytes(asset), 629);
  return config;
}

function assertDecodedSemantics(transaction: Awaited<ReturnType<typeof compileMimirBetaTransactionV1>>, kind: "classic" | "composite",
  instructionCount: number): void {
  const decoded = getTransactionDecoder().decode(transaction.serializedTransaction);
  assert.deepEqual(Object.keys(decoded.signatures), transaction.requiredSigners);
  assert.ok(Object.values(decoded.signatures).every((signature) => signature === null));
  assert.deepEqual(new Uint8Array(decoded.messageBytes), transaction.serializedMessage);
  const message = getCompiledTransactionMessageDecoder().decode(transaction.serializedMessage);
  assert.equal(message.version, 1);
  if (message.version !== 1) throw new Error("expected Transaction v1 message");
  assert.equal(message.configMask, 15);
  assert.deepEqual(message.configValues, [
    { kind: "u64", value: 14_000n }, { kind: "u32", value: 1_400_000 }, { kind: "u32", value: 67_108_864 },
  ]);
  assert.equal(message.numInstructions, instructionCount);
  assert.equal(message.header.numSignerAccounts, 2);
  assert.deepEqual(message.staticAccounts.slice(0, 2), [authority, asset]);
}

async function compileFused(kind: "classic" | "composite", count: 1 | 2 | 3 | 4 | 5, withSolConversion: boolean, ticker = "ABC") {
  const [register, pointer] = await Promise.all([
    identity.buildRegister({ asset, authority, agentUri: exactBoundaryUri }), identity.buildSetCollectionPointer({ asset, authority }),
  ]);
  const [agent] = await identity.deriveAgentAccount(asset); const [root] = await identity.deriveRootConfig();
  let terminal: MimirBetaInstruction;
  if (kind === "classic") {
    const prefix = Array.from({ length: 12 }, (_, index) =>
      index === 0 ? meta(authority, true, true) : meta(fresh(), false, index < 8));
    const sources = Array.from({ length: count * 8 }, () => meta(fresh(), false, true));
    const suffix = [meta(agent, false, true), meta(root), meta(physicalCollection, false, true), meta(asset, true, true)];
    const accounts = [...prefix, ...sources, meta(fresh(), false, true), ...suffix];
    assert.throws(() => buildMimirBetaIdentityActivationInstruction({ programId: mimirProgramId,
      accounts: [...accounts, meta(fresh()), meta(fresh()), meta(fresh()), meta(fresh())], sourceBundleAccountCount: sources.length, ticker: "ABC" }));
    terminal = buildMimirBetaIdentityActivationInstruction({ programId: mimirProgramId, accounts,
      sourceBundleAccountCount: sources.length, ticker: "ABC" });
  } else {
    const config = rawCompositeConfig(count, ticker);
    const componentSources = Array.from({ length: count }, (_, index) =>
      bytesAddress(config.subarray(256 + index * 80, 288 + index * 80)));
    const conversionSource = withSolConversion ? fresh() : undefined;
    if (conversionSource) config.set(addressBytes(conversionSource), 197);
    const sourceAccounts = [...componentSources, ...(conversionSource ? [conversionSource] : [])].map((source) => meta(source));
    const componentAccounts = Array.from({ length: count }, (_, index) => {
      const offset = 229 + index * 80;
      return [meta(bytesAddress(config.subarray(offset, offset + 32))), meta(fresh()), meta(authority, false, true)];
    }).flat();
    const accounts = [meta(authority, true, true), meta(authority, true), meta(), meta(fresh(), false, true), meta(),
      meta(fresh(), false, true), meta(MIMIR_BETA_SYSTEM_PROGRAM_ID), ...sourceAccounts,
      meta(fresh(), false, true), meta(fresh(), false, true), meta(fresh(), false, true), meta(MIMIR_BETA_SPL_TOKEN_PROGRAM_ID),
      meta(fresh(), false, true), meta(agent, false, true), meta(root), meta(physicalCollection, false, true), meta(asset, true, true),
      meta(fresh(), false, true), ...componentAccounts];
    assert.throws(() => buildMimirBetaIdentityCompositeInstruction({ programId: mimirProgramId,
      accounts: accounts.slice(0, -1), canonicalConfig: config, componentSourceCount: sourceAccounts.length }));
    terminal = buildMimirBetaIdentityCompositeInstruction({ programId: mimirProgramId, accounts,
      canonicalConfig: config, componentSourceCount: sourceAccounts.length });
  }
  const classicPrefix = kind === "classic" && count === 1 ? [
    buildMimirBetaIdentityProposalInstruction({ programId: mimirProgramId,
      accounts: [meta(authority, true, true), ...terminal.accounts.slice(1, 6), terminal.accounts[8]!], identityAsset: asset,
      init: { baseMint: terminal.accounts[3]!.address, quoteMint: terminal.accounts[4]!.address,
        sourceSetRoot: new Uint8Array(32).fill(1), staticAccountsRoot: new Uint8Array(32).fill(2),
        anchorPolicyHash: new Uint8Array(32).fill(3), nativeExceptionHash: new Uint8Array(32).fill(4), adapterMask: 1n,
        namespaceVersion: 1, planId: 0, planVersion: 0, hashSchemeVersion: 1, ringVersion: 1,
        profile: 0, riskTier: 1, sourceCount: 1, minSources: 1, minVenues: 1, minCorrelationGroups: 1,
        baseDecimals: 6, quoteDecimals: 6, bindingVariants: [0, 0, 0, 0, 0], priceExponent: 0,
        maxDispersionBps: 1, maxSourceActivityAgeSlots: 5, minCoverageRatioBps: 1,
        maxConfidenceBps: 1, maxSnapshotAgeSlots: 1 } }),
    buildMimirBetaSourceAppendInstruction({ programId: mimirProgramId,
      accounts: [terminal.accounts[1]!, terminal.accounts[12]!],
      source: { feedId: terminal.accounts[3]!.address, sourceIndex: 0, adapterType: 7, direction: 0,
        adapterVersion: 0, venueGroup: 1, operatorGroup: 1, liquidityOwnerGroup: 1, routeCorrelationGroup: 1,
        quoteAssetGroup: 1, bridgeOrWrapperGroup: 1, oracleSourceClass: 1, upgradeAuthorityGroup: 1,
        maxSourceWeightBps: 10_000, minLiquidityNative: 1n, minDepthTo50BpsNative: 1n,
        programId: terminal.accounts[12]!.address, poolOrMarket: terminal.accounts[13]!.address,
        baseVault: terminal.accounts[14]!.address, quoteVault: terminal.accounts[15]!.address,
        tokenProgram: terminal.accounts[16]!.address, vaultAuthority: terminal.accounts[17]!.address,
        sourceConfigRevision: 1n, sourceSetRevision: 1n },
      sourceRootProof: Array.from({ length: 3 }, (_, index) => new Uint8Array(32).fill(index + 5)),
      accountRootProof: Array.from({ length: 3 }, (_, index) => new Uint8Array(32).fill(index + 8)) }),
  ] : [];
  const instructions = kind === "composite"
    ? [register, pointer, await identity.buildSetImmutableDisplayName({ asset, authority, displayName: "é".repeat(125) }), terminal]
    : [register, pointer, ...classicPrefix, terminal];
  const transaction = await compileMimirBetaTransactionV1({ feePayer: authority, recentBlockhash: blockhash,
    lastValidBlockHeight: 100n, instructions });
  const expectedInstructionCount = kind === "composite" ? 4 : count === 1 ? 5 : 3;
  assertDecodedSemantics(transaction, kind, expectedInstructionCount);
  assert.equal(transaction.packet.signatureCount, 2); assert.equal(transaction.packet.instructionCount, expectedInstructionCount);
  assert.ok(transaction.packet.serializedTransactionBytes <= 4096);
  return transaction;
}

const profiles = [];
for (const count of [1, 2, 3, 4, 5] as const) {
  const simple = await compileFused("classic", count, false);
  profiles.push({ kind: "classic", count, conversion: false, messageHash: simple.messageHash,
    wireHash: hex(await sha256(simple.serializedTransaction)), ...simple.packet });
  for (const conversion of [false, true]) {
    const composite = await compileFused("composite", count, conversion);
    profiles.push({ kind: "composite", count, conversion, messageHash: composite.messageHash,
      wireHash: hex(await sha256(composite.serializedTransaction)), ...composite.packet });
  }
}
const worstSimple = profiles.find((profile) => profile.kind === "classic" && profile.count === 5)!;
const worstComposite = profiles.find((profile) => profile.kind === "composite" && profile.count === 5 && profile.conversion)!;
assert.equal(worstSimple.serializedTransactionBytes, 2404); assert.equal(worstSimple.accountCount, 62);
// Composite fixtures share the synthetic address sequence with later Classic fixtures.
assert.deepEqual(profiles.filter((profile) => profile.kind === "classic").map(({ count, messageHash, wireHash }) => ({ count, messageHash, wireHash })), [
  { count: 1, messageHash: "714ac0548e094395adfd72e6917d11639316d6118bbd8a918c8224949760d8d8", wireHash: "3c04fc57dcff9827e61ada199ecdf04be65f4ab965b459830a1580c685048ec4" },
  { count: 2, messageHash: "1672d0366c5777556f7a25a94819c9a934f31bd61edb2ae317556af45dc80754", wireHash: "6338576475b97f81e05412e673bd3fac18d95810ada9f906f3a8dbe228b0bab7" },
  { count: 3, messageHash: "4a87e35e9b818e5c98674c4599fdabb2b0bd2fea64017fc8412c9d983a140a07", wireHash: "011792c69d668071236d685e52019d90e0817ed976fa01354dc408de4d2de5bc" },
  { count: 4, messageHash: "5e8e5df1907f0c6fa8463ab6264ada923689e72a6e75b7d0b76cc0750d02b409", wireHash: "3994d16bb9c33a7fb13075b8ac229cb16a1d27ceaad646828091f8e0f7d44e14" },
  { count: 5, messageHash: "74db3541eef0c7220069f1317c15d5b6ff8b7f2e5df913a5e4e055ea31a5d808", wireHash: "5a4f0b0845b8873e683fe91350163d0b69ca574b3c25013d2e052196c24cb3b0" },
], "Classic fused bytes and hashes remain exact");
assert.equal(worstComposite.serializedTransactionBytes, 2547); assert.equal(worstComposite.accountCount, 37);
assert.ok(profiles.every((profile) => profile.fitsPacketLimit && profile.serializedTransactionBytes <= 4096 && profile.accountCount <= 64 &&
  profile.instructionCount === (profile.kind === "composite" ? 4 : profile.count === 1 ? 5 : 3) && profile.signatureCount === 2));

const authorityKeys = await webcrypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
const assetKeys = await webcrypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
authority = await getAddressFromPublicKey(authorityKeys.publicKey); asset = await getAddressFromPublicKey(assetKeys.publicKey);
const signWith = async (message: Uint8Array) => [authorityKeys, assetKeys].map(async (keys) =>
  new Uint8Array(await webcrypto.subtle.sign("Ed25519", keys.privateKey, message)));
const packaged = async (message: Uint8Array, signedOver = message) => {
  const signatures = await Promise.all(await signWith(signedOver));
  return { signed: Uint8Array.from([...message, ...signatures[0]!, ...signatures[1]!]),
    supplied: [{ address: authority, signature: signatures[0]! }, { address: asset, signature: signatures[1]! }] };
};
// Composite tag-81 identity position across ticker lengths, converter presence and fused venues (Orca E7, DLMM E6).
const signedCases = [{ kind: "classic" as const, ticker: "ABC", conversion: false, adapterType: 2, externalWidth: 4 },
  ...["ABC", "ABCDEF", "ABCDEFG", "ABCDEFGH", "ABCDEFGHIJKL"].flatMap((ticker) => [false, true].flatMap((conversion) =>
    [[2, 4], [0, 7], [3, 6]].map(([adapterType, externalWidth]) => ({ kind: "composite" as const, ticker, conversion, adapterType: adapterType!, externalWidth: externalWidth! }))))];
for (const { kind, ticker, conversion, adapterType, externalWidth } of signedCases) {
  const base = await compileFused(kind, 1, conversion, ticker);
  const fusedLayout = mimirCompositeExecutionLayout([deriveMimirFusedRecipe({ role: "component", adapterType, adapterVersion: 0, externalWidth,
    minSlotGap: 1, accountsBindingVersion: 1 })], []);
  const execution = fresh(); const csp = fresh(); const cfc = fresh(); const fusedFeed = new Uint8Array(32).fill(3);
  const externals = Array.from({ length: externalWidth }, fresh);
  const fusedTail = kind === "classic" ? [] : [...buildMimirInitFusedCompositeClosure({ programId: mimirProgramId, payer: authority, execution, collateralLock: fresh(),
    compositeConfig: cfc, registry: fresh(), compositeFeedId: fusedFeed, layout: fusedLayout, witnesses: [{ feedId: new Uint8Array(32).fill(4), sourceIndex: 0,
      ringVersion: 1, minSlotGap: 1, expectedSourceConfigRevision: 1n, expectedSourceSetRevision: 1n, expectedPlanHash: new Uint8Array(32),
      sourceSetSiblings: [0, 1, 2].map(() => new Uint8Array(32)), accountsSiblings: [0, 1, 2].map(() => new Uint8Array(32)) }],
    components: [{ sourceConfig: fresh(), feedConfig: fresh(), sourcingPlan: fresh(), externals }] }),
  buildMimirFusedCompositeRefreshInstruction({ programId: mimirProgramId, payer: authority, compositeSnapshot: csp, compositeConfig: cfc, registry: fresh(),
    adminConfig: fresh(), feeVault: fresh(), treasury: fresh(), execution, layout: fusedLayout, componentExternals: [externals], converterExternals: [],
    request: { compositeFeedId: fusedFeed, expectedConfigRevision: 1n, previousSnapshotRevision: 0n, nextSnapshotRevision: 1n,
      componentSourceConfigRevisions: [1n], maxRefreshFeeLamports: 0n, componentRingNewestSlots: [0n], converterRingNewestSlots: [] } })];
  const transaction = kind === "classic" ? base : await compileMimirBetaTransactionV1({ feePayer: authority, recentBlockhash: blockhash,
    lastValidBlockHeight: 100n, instructions: [...base.instructions, ...fusedTail] });
  const stepId = kind === "classic" ? "classic:activate" : "composite:activate";
  const sdkWrite = (address: string, codec: string, dataLengthAfter?: number) => ({ address, ...(dataLengthAfter ? { dataLengthAfter } : {}),
    proof: { kind: "account", transition: "create", after: { exists: true, data: { kind: "sdk-codec", codec } } } });
  const compositeWrites = kind === "composite" ? [sdkWrite(asset, "mpl-core-asset-v1"),
    sdkWrite(execution, "composite-execution-v1", fusedLayout.exactLength), sdkWrite(csp, "composite-snapshot-v1"),
  { address: authority, proof: { kind: "spl-token-burn-checked", outerInstructionIndex: 3,
    tokenProgram: mimirProgramId, sourceTokenAccount: authority, mint: asset, authority, amountRaw: 1n, decimals: 0 } }] : [];
  const preparedStep = { step: { stepId, stage: "mimir-create", ordinal: 0, prerequisiteStepIds: [],
    requiredSigners: [authority, asset], expectedWrites: compositeWrites }, transaction,
    review: { authority, identityAsset: asset, programId: mimirProgramId, requiredSigners: [authority, asset], expectedWrites: compositeWrites,
      packet: transaction.packet, messageHash: transaction.messageHash,
      instructions: transaction.instructions.map((instruction) => ({ programAddress: instruction.programAddress,
        accounts: instruction.accounts, dataBase64: base64(instruction.data) })) } } as unknown as MimirBetaPreparedStep;
  const { signed, supplied } = await packaged(transaction.serializedMessage);
  const signatures = supplied.map(({ signature }) => signature);
  await assert.doesNotReject(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: signed, signatures: supplied }),
    `${kind} ${ticker} conversion=${conversion} adapter=${adapterType}`);
  await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: signed, signatures: supplied.slice(1) }));
  if (kind === "composite") {
    const flipped = preparedStep.review.instructions.map((instruction, index) => {
      if (index !== 3) return instruction;
      const data = Uint8Array.from(Buffer.from(instruction.dataBase64, "base64")); data.fill(conversion ? 0 : 1, 198, 230);
      return { ...instruction, dataBase64: base64(data) };
    });
    await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep: { ...preparedStep,
      review: { ...preparedStep.review, instructions: flipped } } as MimirBetaPreparedStep, signedTransaction: signed, signatures: supplied }),
    /envelope invalid/, `${ticker} converter flag moves the identity signer`);
  }
  const feeOnly = await compileMimirBetaTransactionV1({ feePayer: authority, recentBlockhash: blockhash, lastValidBlockHeight: 100n,
    instructions: transaction.instructions, priorityFeeLamports: 280_000n });
  assert.notDeepEqual(feeOnly.serializedMessage, transaction.serializedMessage);
  const walletSigned = await packaged(feeOnly.serializedMessage);
  await assert.doesNotReject(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: walletSigned.signed,
    signatures: walletSigned.supplied }), `${kind} fee-only wallet rewrite`);
  // Solflare guards on top of the fee rewrite: payer assertion, then (with a reviewed burn) the collateral token assertion.
  const withGuards = (message: Uint8Array, targets: readonly number[]) => {
    const m = getCompiledTransactionMessageDecoder().decode(message) as Extract<ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>, { version: 1 }>;
    const staticAccounts = [...m.staticAccounts, "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95" as typeof authority];
    const tokenGuard = Uint8Array.from(Buffer.from(`0a05060802ff9f65cf544f1d00040300000600000000000000000001${"00".repeat(32)}00070000`, "hex"));
    tokenGuard.set(addressBytes(authority), 28);
    const guards = targets.map((target, index) => [target, index === 0
      ? Uint8Array.from(Buffer.from("06050300a87cde1f000000000403000001000000000000000000", "hex")) : tokenGuard] as const);
    return new Uint8Array(getCompiledTransactionMessageEncoder().encode({ ...m, staticAccounts, numStaticAccounts: staticAccounts.length,
      numInstructions: m.numInstructions + guards.length,
      header: { ...m.header, numReadonlyNonSignerAccounts: m.header.numReadonlyNonSignerAccounts + 1 },
      instructionHeaders: [...m.instructionHeaders, ...guards.map(([, data]) => ({ programAccountIndex: staticAccounts.length - 1,
        numInstructionAccounts: 1, numInstructionDataBytes: data.length }))],
      instructionPayloads: [...m.instructionPayloads, ...guards.map(([target, data]) => ({ instructionAccountIndices: [target], instructionData: data }))] }));
  };
  const guardedSigned = await packaged(withGuards(feeOnly.serializedMessage, kind === "composite" ? [0, 0] : [0]));
  await assert.doesNotReject(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: guardedSigned.signed,
    signatures: guardedSigned.supplied }), `${kind} fee + Solflare guards`);
  if (kind === "classic") {
    const unreviewed = await packaged(withGuards(feeOnly.serializedMessage, [0, 0]));
    await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: unreviewed.signed,
      signatures: unreviewed.supplied }), /differs from reviewed bytes/, "token guard without a reviewed collateral burn");
  }
  const overReviewed = await packaged(feeOnly.serializedMessage, transaction.serializedMessage);
  await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: overReviewed.signed,
    signatures: overReviewed.supplied }), /mutated fused signature/, `${kind} signature over reviewed bytes`);
  const nonFeeMessage = feeOnly.serializedMessage.slice(); nonFeeMessage[nonFeeMessage.length - 1] ^= 1;
  const nonFee = await packaged(nonFeeMessage);
  await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: nonFee.signed,
    signatures: nonFee.supplied }), /differs from reviewed bytes/, `${kind} non-fee mutation`);
  const thirdSigner = fresh(); const threeSigners = [authority, asset, thirdSigner];
  const forgedPreparedStep = { ...preparedStep,
    step: { ...preparedStep.step, requiredSigners: threeSigners },
    transaction: { ...transaction, requiredSigners: threeSigners, packet: { ...transaction.packet, signatureCount: 3 } },
    review: { ...preparedStep.review, requiredSigners: threeSigners } } as MimirBetaPreparedStep;
  await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep: forgedPreparedStep, signedTransaction: signed,
    signatures: [...supplied, { address: thirdSigner, signature: new Uint8Array(64).fill(33) }] }));
  const mutatedSignature = signed.slice(); mutatedSignature[mutatedSignature.length - 1] ^= 1;
  await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: mutatedSignature, signatures: supplied }));
  const mutatedMessage = signed.slice(); mutatedMessage[10] ^= 1;
  await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: mutatedMessage, signatures: supplied }));
  {
    const metadata = transaction.instructions[2]!;
    const hostile = kind === "composite" ? [
      transaction.instructions.filter((_, index) => index !== 2),
      [transaction.instructions[0]!, metadata, transaction.instructions[1]!, transaction.instructions[3]!],
      [...transaction.instructions.slice(0, 3), metadata, transaction.instructions[3]!],
      transaction.instructions.map((instruction, index) => index === 2 ? { ...instruction,
        data: Uint8Array.from(instruction.data, (byte, byteIndex) => byteIndex === instruction.data.length - 2 ? byte ^ 1 : byte) } : instruction),
    ] : [
      transaction.instructions.filter((_, index) => index !== 2),
      [transaction.instructions[0]!, transaction.instructions[1]!, transaction.instructions[3]!,
        transaction.instructions[2]!, transaction.instructions[4]!],
      transaction.instructions.map((instruction, index) => index === 3 ? { ...instruction,
        data: Uint8Array.from(instruction.data, (byte, byteIndex) => byteIndex === 0 ? byte ^ 1 : byte) } : instruction),
    ];
    for (const instructions of hostile) {
      const altered = await compileMimirBetaTransactionV1({ feePayer: authority, recentBlockhash: blockhash,
        lastValidBlockHeight: 100n, instructions });
      const alteredSigned = altered.serializedTransaction.slice();
      alteredSigned.set(signatures[0]!, altered.serializedMessage.length);
      alteredSigned.set(signatures[1]!, altered.serializedMessage.length + 64);
      await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: alteredSigned, signatures: supplied }));
    }
  }
}

// Staged composite with missing helpers: burn proofs bind the assembled tag-80/81 positions, whatever each helper's length.
for (const helperExtras of [[0], [0, 1]]) {
  const keys = await Promise.all([...helperExtras, 0].map(() => webcrypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as Promise<CryptoKeyPair>));
  const [payer, ...assets] = await Promise.all([authorityKeys, ...keys].map((pair) => getAddressFromPublicKey(pair.publicKey)));
  const rootAsset = assets.at(-1)!; const helperAssets = assets.slice(0, -1);
  const keyOf = new Map([[payer, authorityKeys], ...assets.map((address, index) => [address, keys[index]!] as const)]);
  const tagged = (tag: number, accounts: MimirBetaInstructionAccount[] = [meta()]): MimirBetaInstruction =>
    ({ programAddress: mimirProgramId, accounts: [meta(payer, true, true), ...accounts], data: Uint8Array.of(tag, 0) });
  const other = () => ({ programAddress: fresh(), accounts: [meta(payer, true, true)], data: Uint8Array.of(1) });
  const root81 = new Uint8Array(225); root81[0] = 81;
  const instructions = [...helperAssets.flatMap((helper, index) => [other(), other(), tagged(78), tagged(78),
    ...Array.from({ length: helperExtras[index]! }, other), tagged(80, [meta(), meta(helper, true, false)])]),
  other(), other(), other(), { programAddress: mimirProgramId, accounts: [...Array.from({ length: 15 }, () => meta()), meta(rootAsset, true, false)], data: root81 }];
  const activationIndexes = instructions.flatMap((instruction, index) => instruction.programAddress === mimirProgramId &&
    (instruction.data[0] === 80 || instruction.data[0] === 81) ? [index] : []);
  assert.deepEqual(activationIndexes, helperExtras.length === 1 ? [4, 8] : [4, 10, 14]);
  const transaction = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: blockhash, lastValidBlockHeight: 100n, instructions });
  const writesFor = (burnIndexes: readonly number[]) => [...assets.map((address) => ({ address,
    proof: { kind: "account", transition: "create", after: { exists: true, data: { kind: "sdk-codec", codec: "mpl-core-asset-v1" } } } })),
  ...helperExtras.flatMap((extra) => Array.from({ length: extra }, () => ({ address: fresh(),
    proof: { kind: "account", transition: "create", after: { exists: true, data: { kind: "sdk-codec", codec: "source-ring-v1" } } } }))),
  ...burnIndexes.map((outerInstructionIndex) => ({ address: payer, proof: { kind: "spl-token-burn-checked", outerInstructionIndex,
    tokenProgram: MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, sourceTokenAccount: payer, mint: rootAsset, authority: payer, amountRaw: 1n, decimals: 0 } }))];
  const preparedFor = (burnIndexes: readonly number[]) => ({ step: { stepId: "composite:activate", stage: "mimir-create", ordinal: 0, prerequisiteStepIds: [],
    requiredSigners: transaction.requiredSigners, expectedWrites: writesFor(burnIndexes) }, transaction,
  review: { authority: payer, identityAsset: rootAsset, programId: mimirProgramId, requiredSigners: transaction.requiredSigners,
    expectedWrites: writesFor(burnIndexes), packet: transaction.packet, messageHash: transaction.messageHash,
    instructions: transaction.instructions.map((instruction) => ({ programAddress: instruction.programAddress,
      accounts: instruction.accounts, dataBase64: base64(instruction.data) })) } }) as unknown as MimirBetaPreparedStep;
  const supplied = await Promise.all(transaction.requiredSigners.map(async (address) => ({ address,
    signature: new Uint8Array(await webcrypto.subtle.sign("Ed25519", keyOf.get(address)!.privateKey, transaction.serializedMessage)) })));
  const signed = Uint8Array.from([...transaction.serializedMessage, ...supplied.flatMap(({ signature }) => [...signature])]);
  const preparedStep = preparedFor(activationIndexes);
  await assert.doesNotReject(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: signed, signatures: supplied }),
    `${helperExtras.length} missing helper(s) bind ${activationIndexes}`);
  const corrupted = signed.slice(); corrupted[transaction.serializedMessage.length] ^= 1;
  await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: corrupted, signatures: supplied }));
  for (const burnIndexes of [[0, ...activationIndexes.slice(1)], activationIndexes.map((index, at) => at ? index + 1 : index)]) {
    await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep: preparedFor(burnIndexes), signedTransaction: signed, signatures: supplied }),
      /envelope invalid/, `burn at non-activation index ${burnIndexes}`);
  }
  const reordered = [supplied[0]!, ...supplied.slice(1).reverse()];
  await assert.rejects(() => assertMimirBetaFusedSignedTransaction({ preparedStep, signedTransaction: signed, signatures: reordered }));
}

await assert.doesNotReject(() => encodeMimirBetaCompositeV1Config({
  programId: mimirProgramId, creator: authority, quoteMint: fresh(), priceExponent: 0,
  maxSnapshotAgeSlots: 1, maxComponentSnapshotAgeSlots: 1,
  maxComponentConfidenceBps: 1, maxComponentDispersionBps: 1,
  registryEpoch: 1n, configRevision: 1n, adminConfigRevisionAtCreation: 1n,
  components: [{ feedId: fresh(), sourceConfig: fresh(), quantityX64: 1n }], identityAsset: asset, ticker: "ABC",
}));

const oneComponentConfig = rawCompositeConfig(1);
const repeatedFeedConfig = rawCompositeConfig(2);
repeatedFeedConfig.set(repeatedFeedConfig.subarray(229, 261), 309);
const repeatedSourceConfig = rawCompositeConfig(2);
repeatedSourceConfig.set(repeatedSourceConfig.subarray(261, 293), 341);
const reversedConfig = rawCompositeConfig(2); const firstComponent = reversedConfig.slice(229, 309);
reversedConfig.copyWithin(229, 309, 389); reversedConfig.set(firstComponent, 309);
const zeroQuantityConfig = rawCompositeConfig(2); zeroQuantityConfig.fill(0, 293, 309);
const dirtyInactiveConfig = rawCompositeConfig(2); dirtyInactiveConfig[389] = 1;
for (const config of [repeatedFeedConfig, repeatedSourceConfig, reversedConfig,
  zeroQuantityConfig, dirtyInactiveConfig]) {
  assert.throws(() => encodeMimirBetaIdentityCompositeData(config), code("PROGRAM_ABI_MISMATCH"));
}
assert.throws(() => buildMimirBetaIdentityCompositeInstruction({
  programId: mimirProgramId, accounts: Array.from({ length: 16 }, () => meta()),
  canonicalConfig: oneComponentConfig, componentSourceCount: 1,
}), code("PROGRAM_ABI_MISMATCH"));

console.log(JSON.stringify({ fusedIdentityTransactionV1Profiles: profiles }, (_, value) => typeof value === "bigint" ? value.toString() : value));
