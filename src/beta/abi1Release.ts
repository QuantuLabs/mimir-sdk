import type { Address } from "@solana/kit";
import { addressBytes, base64, bytesAddress, bytesEqual, hex, isZeroBytes, sha256, utf8 } from "./bytes.js";
import { MIMIR_COMPOSITE_EXECUTION, MIMIR_FUSED_COMPOSITE_TAG, mimirFusedRecipeBindingVariant, MIMIR_INIT_FUSED_COMPOSITE_TAG, MIMIR_REMOVED_COMPOSITE_TAGS, decodeMimirFusedRefreshData,
  mimirAdmittedRecipe, buildMimirFusedCompositeRefreshInstruction, decodeMimirCompositeExecution, deriveMimirCompositeExecutionAddress, mimirFusedCfcDigest,
  type MimirFusedRefreshRequest, type MimirFusedRecipe } from "./compositeExecution.js";
import { MIMIR_DELETED_CLASSIC_TAGS, MIMIR_FUSED_CLASSIC_TAG, assertMimirClassicConverterAdmitted, MIMIR_INIT_FUSED_CLASSIC_TAG, decodeMimirFusedClassicData, decodeMimirClassicExecutionAccount, deriveMimirClassicExecutionAddress,
  buildMimirFusedClassicInstruction, mimirFusedClassicRequest } from "./classicExecution.js";
import { MimirBetaError, MimirBetaSimulationError, betaError, mimirBetaSimulationFailure } from "./errors.js";
import type { MimirRefreshGroup, MimirRefreshTarget } from "./refreshPlanner.js";
import type { MimirBetaUnsignedTransaction } from "./review.js";
import { compileMimirBetaTransactionV1 } from "./transactionV1.js";
import type { MimirBetaInstruction } from "./types.js";

import { deriveMimirBetaCanonicalPdas, deriveMimirBetaPda } from "./abi.js";
import { MIMIR_BETA_SYSTEM_PROGRAM_ID } from "./deployment.js";
import { decodeMimirCompositeConfig } from "./codecs.js";
import { decodeMimirBetaAdminContext } from "./context.js";
import { decodeMimirBetaLiveFeed, decodeMimirBetaLiveSource } from "./liveAbi.js";
import { decodeFeedSnapshotHeader, decodeMimirBrowserCompositeSnapshotHeader, MIMIR_NATIVE_CLOCK_ADDRESS,
  mimirExecutableGenerationPins, verifyOrcaExecutableGeneration, verifyDammExecutableGeneration, verifyCpmmExecutableGeneration,
  verifyDlmmExecutableGeneration, type MimirGenerationCluster } from "../internal/nativeMonoRefreshCore.js";
import { mimirSampledSourceAdapters, verifyMimirSampledExecutableGeneration } from "../internal/sampledTemporalCore.js";
import { deriveMimirBetaCaptureReadPlan, derivePdaSync, mimirBetaAllCaptureScanDescriptors } from "./capture.js";
import { mimirAuthenticClockUnix } from "./live.js";
import { decodeMimirBetaCaptureRpcAccount } from "./rpc.js";
import { COHORT_NOT_CONVERGED } from "../chunkedAccounts.js";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** Compact UTF-8 JSON with recursively sorted object keys: the hash preimage of the manifest and of consumer budget contracts. */
export function mimirSortedJson(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort)
    : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sort(value));
}
export const mimirSortedJsonSha256 = async (value: unknown) => hex(await sha256(utf8(mimirSortedJson(value))));

export interface MimirBankCellV1 {
  readonly id: string; readonly fixtureSha256: string; readonly action: string; readonly recipe: string; readonly sourceCount: number;
  readonly converter: boolean; readonly keys: number; readonly bytes: number; readonly instructions: number; readonly signers: number;
  readonly freeKeys: number; readonly cuBefore: number | null; readonly cuAfter: number | null; readonly outputSha256: string;
  readonly status: "measured" | "model" | "open";
  readonly executionKind: MimirExecutionKindV2; readonly primarySourceCount: number; readonly converterSourceCount: number;
  /** Ordered `mimirRecipeTupleKey` of all N+S rows. */
  readonly recipeTupleKeys: readonly string[];
  /** `mimirInstructionsSha256` of the exact measured producer instructions. */
  readonly instructionsSha256: string;
}
export interface MimirRecipeCapabilityV1 {
  readonly adapterType: number; readonly adapterVersion: number; readonly mode: number; readonly temporalKind: number; readonly externalWidth: number;
  readonly bindingWidth: number; readonly accountsBindingVersion: number; readonly bindingVariant: number; readonly clusterEnabled: boolean;
  /** Candidate measured exact-ELF bank cells per action; an action without one stays disabled. */
  readonly exactElfCells: Readonly<Partial<Record<MimirCapabilityActionV1, readonly string[]>>>;
}
/** Packet kinds a bank cell is measured for: the execution initializer, the fresh-creation packet, the sample-only and the publishing refresh. */
export type MimirCapabilityActionV1 = "init" | "fresh-creation" | "sample" | "publish";
export type MimirExecutionKindV2 = "classic" | "composite";
/** Canonical recipe tuple a bank cell is banked under: family/version/mode/kind/E/K/binding version/variant. */
export function mimirRecipeTupleKey(r: MimirFusedRecipe): string {
  return `${r.adapterType}.${r.adapterVersion}.m${r.mode}.k${r.temporalKind}.E${r.externalWidth}.K${r.bindingWidth}.b${r.accountsBindingVersion}` +
    `.v${mimirFusedRecipeBindingVariant(r)}`;
}
export const MIMIR_CAPABILITY_MANIFEST_SCHEMA = "mimir-capability-manifest-a2-v3";
export interface MimirCapabilityManifestV1 {
  readonly schema: typeof MIMIR_CAPABILITY_MANIFEST_SCHEMA; readonly abi: "ABI-1+A2";
  readonly clusterGenesisHash: string; readonly programId: Address; readonly programDataAddress: Address; readonly deploymentSlot: number;
  readonly sourceCommit: string; readonly elfSha256: string; readonly elfLength: number;
  readonly sdkVersion: string; readonly sdkTarballSha256: string; readonly appCommit: string; readonly indexerCommit: string;
  readonly tags: Readonly<Record<"fusedClassic" | "initFusedClassic" | "fusedComposite" | "initFusedComposite", number>>;
  readonly removedTags: readonly number[];
  readonly state: Readonly<Record<string, Json>>;
  readonly limits: Readonly<{ staticKeys: number; targetMaxKeys: number; bytes: number; outerInstructions: number; cu: number; reallocGrowth: number }>;
  readonly recipes: readonly MimirRecipeCapabilityV1[];
  /** Hash-pinned consumer budget contracts this deployment was measured against (any consuming program). */
  readonly consumerBudgets: readonly Readonly<{ schema: "mimir-consumer-budget-a2-v1"; sha256: string }>[];
  readonly bank: Readonly<{ runnerSha256: string; candidateElfSha256: string; cells: readonly MimirBankCellV1[] }>;
  readonly frameGate: Readonly<{ toolchain: string; passed: boolean; logSha256: string }>;
  readonly review: Readonly<{ daybreakMaxReportSha256: string; ponytailReportSha256: string }>;
}

export const MIMIR_ABI1_LIMITS = Object.freeze({ staticKeys: 64, targetMaxKeys: 54, bytes: 4_096, outerInstructions: 64, cu: 1_400_000, reallocGrowth: 10_240 });
const STATE = Object.freeze({ cfcLength: 661, cspLength: 720, classicSnapshotLength: 512, executionMagic: "MIMIRCEF", executionVersion: 1,
  executionSeed: "composite_execution", headerLength: 128, componentRowLength: 1_621, converterFixedLength: 1_829, converterSourceRowLength: 944,
  membershipRecordHeaderLength: 4, physicalIdentityLength: 65, maxBindingWidth: 8, transactionClosedInit: true, freshCfcSameTx: true, lazyInit: false,
  classicExecutionMagic: "MIMIRCLX", classicExecutionSeed: "classic_execution", classicHeaderLength: 384, classicProofLength: 256, classicRowLength: 944 });
const TAGS = Object.freeze({ fusedClassic: MIMIR_FUSED_CLASSIC_TAG, initFusedClassic: MIMIR_INIT_FUSED_CLASSIC_TAG,
  fusedComposite: MIMIR_FUSED_COMPOSITE_TAG, initFusedComposite: MIMIR_INIT_FUSED_COMPOSITE_TAG });
const REMOVED_TAGS = Object.freeze([...MIMIR_DELETED_CLASSIC_TAGS, ...MIMIR_REMOVED_COMPOSITE_TAGS].sort((a, b) => a - b));

export interface MimirAbi1DeploymentObservation {
  readonly clusterGenesisHash: string; readonly programId: Address; readonly programDataAddress: Address; readonly deploymentSlot: number;
  readonly elfSha256: string;
}
/** The verified manifest recipes and bank cells a recipe check reads, for any capability ABI. */
export interface MimirCapabilityCells {
  readonly manifest: Readonly<{ recipes: readonly MimirRecipeCapabilityV1[] }>; readonly cells: ReadonlyMap<string, MimirBankCellV1>;
}
export interface MimirAbi1Capability {
  readonly manifest: MimirCapabilityManifestV1; readonly manifestSha256: string; readonly cells: ReadonlyMap<string, MimirBankCellV1>;
}

const mismatch = (what: string): never => betaError("PROGRAM_ABI_MISMATCH", `ABI-1 capability mismatch: ${what}; tags 87/88 are not sent and there is no tag 65-72 fallback`);
const abi1Mismatch = mismatch;

/** Upgradeable-loader observation of the deployed program: genesis, ProgramData, deployment slot, and exact ELF hash. */
export async function observeMimirAbi1Deployment(args: Readonly<{ programId: Address; elfLength: number; clusterGenesisHash: string;
  readAccount: (address: Address) => Promise<Readonly<{ owner: Address; data: Uint8Array }> | null> }>): Promise<MimirAbi1DeploymentObservation> {
  const program = await args.readAccount(args.programId);
  if (!program || program.data.length !== 36 || new DataView(program.data.buffer, program.data.byteOffset).getUint32(0, true) !== 2) mismatch("program account");
  const programDataAddress = bytesAddress(program!.data.subarray(4, 36));
  const pd = await args.readAccount(programDataAddress);
  if (!pd || pd.data.length < 45 + args.elfLength || new DataView(pd.data.buffer, pd.data.byteOffset).getUint32(0, true) !== 3) mismatch("ProgramData account");
  const view = new DataView(pd!.data.buffer, pd!.data.byteOffset);
  if (pd!.data.subarray(45 + args.elfLength).some((b) => b !== 0)) mismatch("ELF length");
  return { clusterGenesisHash: args.clusterGenesisHash, programId: args.programId, programDataAddress,
    deploymentSlot: Number(view.getBigUint64(4, true)), elfSha256: hex(await sha256(pd!.data.subarray(45, 45 + args.elfLength))) };
}

/**
 * Fail-closed ABI-1 gate (§10): manifest hash, frozen tags/state/limits, deployment/ELF identity, consumer budget contract hash, frame gate,
 * and a measured exact-ELF cell for every requested recipe. Required before any tag 87/88 producer is returned for sending.
 */
export async function verifyMimirAbi1Capability(args: Readonly<{
  manifest: MimirCapabilityManifestV1; expectedManifestSha256: string; observed: MimirAbi1DeploymentObservation;
  consumerContractSha256?: string; recipes?: readonly MimirFusedRecipe[]; packet?: MimirCapabilityPacketV1;
}>): Promise<MimirAbi1Capability> {
  if (STATE.componentRowLength !== MIMIR_COMPOSITE_EXECUTION.componentRowLength) mismatch("SDK layout");
  return verifyMimirCapabilityManifest(args, { schema: MIMIR_CAPABILITY_MANIFEST_SCHEMA, abi: "ABI-1+A2", tags: TAGS, removedTags: REMOVED_TAGS,
    state: STATE, limits: MIMIR_ABI1_LIMITS, fail: mismatch });
}

/** Manifest fields shared by every capability ABI; each ABI pins its own schema, abi, tags and review. */
export type MimirCapabilityManifestCore = Omit<MimirCapabilityManifestV1, "schema" | "abi" | "tags" | "review"> &
  Readonly<{ schema: string; abi: string; tags: Readonly<Record<string, number>> }>;
/** Frozen release constants a manifest is checked against, and the release's mismatch failure. */
export interface MimirCapabilityRelease {
  readonly schema: string; readonly abi: string; readonly tags: Readonly<Record<string, number>>; readonly removedTags: readonly number[];
  readonly state: unknown; readonly limits: unknown; readonly fail: (what: string) => never;
}

/** The shared fail-closed manifest gate behind `verifyMimirAbi1Capability` and the V1 `verifyMimirAbi2Capability`. */
export async function verifyMimirCapabilityManifest<M extends MimirCapabilityManifestCore>(args: Readonly<{
  manifest: M; expectedManifestSha256: string; observed: MimirAbi1DeploymentObservation;
  consumerContractSha256?: string; recipes?: readonly MimirFusedRecipe[]; packet?: MimirCapabilityPacketV1;
}>, release: MimirCapabilityRelease): Promise<Readonly<{ manifest: M; manifestSha256: string; cells: ReadonlyMap<string, MimirBankCellV1> }>> {
  const m = args.manifest; const mismatch = release.fail;
  const manifestSha256 = await mimirSortedJsonSha256(m);
  if (manifestSha256 !== args.expectedManifestSha256) mismatch("manifest hash");
  if (m.schema !== release.schema || m.abi !== release.abi) mismatch("schema");
  if (mimirSortedJson(m.tags) !== mimirSortedJson(release.tags) || mimirSortedJson(m.removedTags) !== mimirSortedJson(release.removedTags)) mismatch("tags");
  if (mimirSortedJson(m.state) !== mimirSortedJson(release.state) || mimirSortedJson(m.limits) !== mimirSortedJson(release.limits)) mismatch("state/limits");
  const o = args.observed;
  if (m.clusterGenesisHash !== o.clusterGenesisHash || m.programId !== o.programId || m.programDataAddress !== o.programDataAddress ||
      m.deploymentSlot !== o.deploymentSlot || m.elfSha256 !== o.elfSha256 || m.bank.candidateElfSha256 !== m.elfSha256) mismatch("deployment/ELF");
  if (m.frameGate.passed !== true) mismatch("frame gate");
  const tuples = m.recipes.map((x) => [x.adapterType, x.adapterVersion, x.mode, x.temporalKind, x.externalWidth, x.bindingWidth, x.accountsBindingVersion,
    x.bindingVariant].join("."));
  if (new Set(tuples).size !== tuples.length) mismatch("duplicate recipe tuple");
  if (new Set(m.bank.cells.map((c) => c.id)).size !== m.bank.cells.length) mismatch("duplicate cell id");
  if (m.recipes.some((x) => Object.entries(x.exactElfCells).some(([action, ids]) => !Array.isArray(ids) || new Set(ids).size !== ids.length ||
      ids.some((id) => m.bank.cells.find((c) => c.id === id)?.action !== action)))) mismatch("cell candidates");
  if (m.bank.cells.some((c) => (c.executionKind !== "classic" && c.executionKind !== "composite") || !Number.isSafeInteger(c.primarySourceCount) ||
      c.primarySourceCount < 1 || !Number.isSafeInteger(c.converterSourceCount) || c.converterSourceCount < 0 ||
      c.sourceCount !== c.primarySourceCount + c.converterSourceCount || c.converter !== c.converterSourceCount > 0 ||
      !Array.isArray(c.recipeTupleKeys) || c.recipeTupleKeys.length !== c.sourceCount || !c.recipeTupleKeys.includes(c.recipe))) mismatch("cell shape");
  if (m.recipes.some((x) => Object.values(x.exactElfCells).some((ids) => ids.some((id) => {
    const c = m.bank.cells.find((cell) => cell.id === id)!;
    return !measuredFor(c, c as unknown as MimirCapabilityPacketV1) || c.primarySourceCount > MIMIR_ABI1_PRIMARY_ROWS.max || c.converterSourceCount > MIMIR_ABI1_CONVERTER_ROWS.max ||
      !c.recipeTupleKeys.includes(`${x.adapterType}.${x.adapterVersion}.m${x.mode}.k${x.temporalKind}.E${x.externalWidth}.K${x.bindingWidth}.b${x.accountsBindingVersion}.v${x.bindingVariant}`);
  })))) mismatch("referenced cell evidence");
  if (args.consumerContractSha256 !== undefined && !m.consumerBudgets.some((b) => b.sha256 === args.consumerContractSha256)) mismatch("consumer budget contract hash");
  const capability = { manifest: m, manifestSha256, cells: new Map(m.bank.cells.map((c) => [c.id, c])) };
  if (args.recipes?.length) assertMimirAbi1RecipesCapable(capability, args.recipes, args.packet ?? { action: "publish", executionKind: "composite", converterSourceCount: 0 }, mismatch);
  return capability;
}

/** The packet a recipe set is enabled for: action, execution kind and converter width S; the recipes are the ordered N+S rows. */
export interface MimirCapabilityPacketV1 { readonly action: MimirCapabilityActionV1; readonly executionKind: MimirExecutionKindV2; readonly converterSourceCount: number }

/** Program count domains of a fused packet: N primary rows in 1..5, S converter rows in 0..5. */
export const MIMIR_ABI1_PRIMARY_ROWS = Object.freeze({ min: 1, max: 5 });
export const MIMIR_ABI1_CONVERTER_ROWS = Object.freeze({ min: 0, max: 5 });

const HEX32 = /^[0-9a-f]{64}$/;
const sameMultiset = (a: readonly string[], b: readonly string[]) => mimirSortedJson([...a].sort()) === mimirSortedJson([...b].sort());
const measuredFor = (cell: MimirBankCellV1 | undefined, packet: MimirCapabilityPacketV1): cell is MimirBankCellV1 => !!cell && cell.status === "measured" &&
  cell.action === packet.action && cell.executionKind === packet.executionKind && Number.isSafeInteger(cell.cuAfter) && cell.cuAfter! > 0 &&
  cell.cuAfter! <= MIMIR_ABI1_LIMITS.cu && [cell.fixtureSha256, cell.outputSha256, cell.instructionsSha256].every((h) => HEX32.test(h));
/**
 * Every row's full tuple (binding variant included) must be cluster-enabled and covered by at least one referenced measured exact-ELF cell
 * for this action and execution kind in which that tuple occupies the same role (primary or converter); N and S must lie in the program
 * domains. Cells need not be common to all rows nor match the requested multiplicities. Returns the unique cell whose kind, N/S and
 * primary/converter tuple multisets match exactly, or `null` when none does; ambiguity fails closed.
 */
export function assertMimirAbi1RecipesCapable(capability: MimirCapabilityCells, recipes: readonly MimirFusedRecipe[], packet: MimirCapabilityPacketV1,
  mismatch: (what: string) => never = abi1Mismatch): string | null {
  const keys = recipes.map(mimirRecipeTupleKey);
  const s = packet.converterSourceCount; const n = recipes.length - s;
  if (!Number.isSafeInteger(s) || s < MIMIR_ABI1_CONVERTER_ROWS.min || s > MIMIR_ABI1_CONVERTER_ROWS.max ||
      n < MIMIR_ABI1_PRIMARY_ROWS.min || n > MIMIR_ABI1_PRIMARY_ROWS.max) mismatch(`${packet.executionKind} N${n}S${s} is outside the program row domains`);
  assertMimirAbi1ReleaseRecipeScope(capability, recipes);
  assertMimirClassicConverterAdmitted(recipes.slice(n));
  const lists: (readonly string[])[] = [];
  recipes.forEach((r, row) => {
    const variant = mimirFusedRecipeBindingVariant(r);
    const cap = capability.manifest.recipes.find((x) => x.adapterType === r.adapterType && x.adapterVersion === r.adapterVersion && x.mode === r.mode &&
      x.temporalKind === r.temporalKind && x.externalWidth === r.externalWidth && x.bindingWidth === r.bindingWidth &&
      x.accountsBindingVersion === r.accountsBindingVersion && x.bindingVariant === variant);
    const ids = cap?.clusterEnabled ? cap.exactElfCells[packet.action] ?? [] : [];
    const primary = row < n;
    if (!ids.some((id) => { const c = capability.cells.get(id); return measuredFor(c, packet) &&
        (primary ? c.recipeTupleKeys.slice(0, c.primarySourceCount) : c.recipeTupleKeys.slice(c.primarySourceCount)).includes(keys[row]!); })) {
      mismatch(`recipe ${r.adapterType}/${r.adapterVersion}/mode${r.mode}/E${r.externalWidth} has no measured ${packet.executionKind} ${packet.action} ` +
        `${primary ? "primary" : "converter"} cell`);
    }
    lists.push(ids);
  });
  const matches = (lists[0] ?? []).filter((id) => {
    const cell = capability.cells.get(id);
    return measuredFor(cell, packet) && lists.every((ids) => ids.includes(id)) && cell.primarySourceCount === n && cell.converterSourceCount === s &&
      cell.sourceCount === n + s && cell.converter === s > 0 && cell.recipeTupleKeys.length === keys.length &&
      sameMultiset(cell.recipeTupleKeys.slice(0, n), keys.slice(0, n)) && sameMultiset(cell.recipeTupleKeys.slice(n), keys.slice(n));
  });
  if (matches.length > 1) mismatch(`${packet.executionKind} N${n}S${s} has ambiguous ${packet.action} cell for this packet`);
  return matches[0] ?? null;
}

/**
 * Release recipe scope: every row's full tuple must be cluster-enabled in the pinned capability manifest, independent of action and packet.
 * A missing capability fails closed. Refusal is `RELEASE_SCOPE_UNSUPPORTED`.
 */
export function assertMimirAbi1ReleaseRecipeScope(capability: MimirCapabilityCells | undefined, recipes: readonly MimirFusedRecipe[]): void {
  if (!capability) betaError("RELEASE_SCOPE_UNSUPPORTED", "no pinned release capability manifest for the release recipe scope");
  for (const r of recipes) {
    if (r.mode === 4) betaError("RELEASE_SCOPE_UNSUPPORTED", `recipe ${mimirRecipeTupleKey(r)} is a sampled mode-4 arm outside the release recipe scope`);
    const variant = mimirFusedRecipeBindingVariant(r);
    if (!capability!.manifest.recipes.some((x) => x.clusterEnabled && x.adapterType === r.adapterType && x.adapterVersion === r.adapterVersion && x.mode === r.mode &&
      x.temporalKind === r.temporalKind && x.externalWidth === r.externalWidth && x.bindingWidth === r.bindingWidth &&
      x.accountsBindingVersion === r.accountsBindingVersion && x.bindingVariant === variant)) {
      betaError("RELEASE_SCOPE_UNSUPPORTED", `recipe ${mimirRecipeTupleKey(r)} is outside the pinned release recipe scope`);
    }
  }
}

const MIMIR_CANONICAL_GENESIS = {
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
} as const;

/** Validated standalone producer grammar: tag 89 or tag 87 with its wire N/S and sample (`new == prev`) or publish (`new == prev + 1`) action. */
function standaloneProducer(ix: MimirBetaInstruction): Readonly<{ executionKind: MimirExecutionKindV2; action: "sample" | "publish"; n: number; s: number }> {
  const d = ix.data;
  if (d[0] === MIMIR_FUSED_CLASSIC_TAG) {
    const r = decodeMimirFusedClassicData(d);
    return { executionKind: "classic", action: r.nextSnapshotRevision === r.previousSnapshotRevision ? "sample" : "publish", n: r.componentCount, s: r.converterSourceCount };
  }
  if (d[0] === MIMIR_FUSED_COMPOSITE_TAG) {
    const r = (() => { try { return decodeMimirFusedRefreshData(d); } catch { return null; } })();
    if (r) return { executionKind: "composite", action: r.nextSnapshotRevision === r.previousSnapshotRevision ? "sample" : "publish",
      n: r.componentSourceConfigRevisions.length, s: r.converterRingNewestSlots.length };
  }
  return betaError("PROGRAM_ABI_MISMATCH", `standalone publication instruction tag ${d[0]} is not a validated tag-87/89 producer`);
}

type StandaloneAccount = Readonly<{ owner: Address; executable: boolean; data: Uint8Array }>;
type StandaloneBlockhash = Readonly<{ blockhash: string; lastValidBlockHeight: bigint }>;
type StandaloneReader = (address: Address) => Promise<StandaloneAccount | null>;
type StandaloneCohortReader = (addresses: readonly Address[], minContextSlot: bigint | undefined) =>
  Promise<Readonly<{ slot: bigint; value: readonly (StandaloneAccount | null)[] }>>;
type StandalonePrefetch = (execution: Address, addresses: readonly Address[]) => void;

async function authenticateStandaloneTail(image: Uint8Array, recipe: MimirFusedRecipe, vector: readonly Address[],
  read: StandaloneReader, cluster: MimirGenerationCluster, converterRow: boolean) {
  const source = decodeMimirBetaLiveSource(image);
  const programId = bytesAddress(source.programId); const poolAddress = bytesAddress(source.poolOrMarket);
  if (source.adapterType !== recipe.adapterType || source.adapterVersion !== recipe.adapterVersion) mismatch("external source recipe");
  const required = async (address: Address, sparseTick = false) => {
    const account = await read(address) ?? (sparseTick ? decodeMimirBetaCaptureRpcAccount(address, null) : null);
    if (!account) mismatch("external account missing");
    return { ...account!, address, lamports: 0n };
  };
  const pool = await required(poolAddress);
  if (pool.owner !== programId || pool.executable || !vector.includes(poolAddress)) mismatch("external source pool");
  const staticWidth = mimirAdmittedRecipe({ ...recipe, accountsBindingVersion: 1, converterRow }).bindingWidth;
  const expected = vector.slice(0, staticWidth);
  if ([0, 1, 2, 3].includes(source.adapterType)) {
    const descriptors = mimirBetaAllCaptureScanDescriptors().filter((d) => d.programId === programId && d.allocationSize === pool.data.length &&
      (!d.discriminator || bytesEqual(pool.data.subarray(d.discriminatorOffset, d.discriminatorOffset + d.discriminator.length), d.discriminator)));
    const plans = [];
    const clock = await required(MIMIR_NATIVE_CLOCK_ADDRESS);
    if (clock.data.length !== 40) mismatch("external Clock");
    const slot = new DataView(clock.data.buffer, clock.data.byteOffset).getBigUint64(0, true);
    const context = { observedSlot: slot, observedUnixTimestamp: mimirAuthenticClockUnix(clock, slot, "external Clock is not authentic") };
    for (const descriptor of descriptors) {
      try { plans.push(deriveMimirBetaCaptureReadPlan({ descriptor, primary: pool,
        pair: { baseMint: bytesAddress(source.baseMint), quoteMint: bytesAddress(source.quoteMint) }, context })); } catch { }
    }
    if (plans.length !== 1) mismatch("external capture plan");
    const readPlan = plans[0]!;
    if (readPlan.baseVault !== bytesAddress(source.baseVault) || readPlan.quoteVault !== bytesAddress(source.quoteVault)) mismatch("external source vaults");
    if ([0, 1, 3].includes(source.adapterType)) {
      if (source.adapterType === 3) {
        const rule = descriptors.find((d) => d.descriptorHash === readPlan.descriptorHash)!.planRule;
        if (rule.kind !== "meteora-dlmm") mismatch("external DLMM descriptor");
        if (rule.kind === "meteora-dlmm") {
          const active = Math.floor(new DataView(pool.data.buffer, pool.data.byteOffset).getInt32(rule.activeIdOffset, true) / rule.binsPerArray);
          for (const offset of mimirFusedRecipeBindingVariant(recipe) === 0 ? [0] : [-1, 0, 1]) {
            const index = new Uint8Array(8); new DataView(index.buffer).setBigInt64(0, BigInt(active + offset), true);
            expected.push(derivePdaSync(programId, [utf8("bin_array"), addressBytes(poolAddress), index]));
          }
        }
      } else {
        for (const role of ["tick-array-lower", "tick-array-active", "tick-array-upper"]) {
          const node = readPlan.auxiliary.find((n) => n.role === role);
          if (!node) mismatch("external tick array binding");
          expected.push(node!.address);
        }
      }
    }
    if (source.adapterType === 2 || source.adapterType === 1 && recipe.mode === 2) {
      const observation = readPlan.auxiliary.find((n) => n.role === (source.adapterType === 2 ? "cpmm-observation" : "clmm-observation"));
      if (!observation) mismatch("external observation binding");
      expected.push(observation!.address);
    }
    if (source.adapterType === 3 && recipe.mode === 2) {
      expected.push((await deriveMimirBetaPda({ programId, seed: "oracle", values: [addressBytes(poolAddress)] }))[0]);
    }
  }
  for (const [index, address] of expected.slice(staticWidth).entries()) {
    const sparseTick = source.adapterType === 1 && index < 3;
    const account = await required(address, sparseTick);
    if (sparseTick && account.owner === MIMIR_BETA_SYSTEM_PROGRAM_ID && !account.executable && account.data.length === 0) continue;
    if (account.owner !== programId || account.executable) mismatch("external tail owner/executable");
  }
  const generationFamily = source.adapterType === 0 && recipe.mode === 3 ? "orca"
    : source.adapterType === 2 && (recipe.mode === 3 || recipe.temporalKind === 6) ? "cpmm" : source.adapterType === 7 && recipe.mode === 3 ? "damm"
    : source.adapterType === 3 && (recipe.mode === 2 || recipe.mode === 5) ? "dlmm" : null;
  if (generationFamily) {
    const [program, programData] = mimirExecutableGenerationPins(cluster)[generationFamily];
    const verify = { orca: verifyOrcaExecutableGeneration, cpmm: verifyCpmmExecutableGeneration,
      damm: verifyDammExecutableGeneration, dlmm: verifyDlmmExecutableGeneration }[generationFamily];
    if (programId !== program || !verify(await required(program), await required(programData), cluster)) mismatch("external executable generation");
    expected.push(program, programData);
  } else if (source.adapterType === 4 || source.adapterType === 6) {
    const adapter = mimirSampledSourceAdapters(cluster)[source.adapterType];
    const program = await required(adapter.program as Address); const programData = await required(adapter.programData as Address);
    if (programId !== adapter.program || program.owner !== "BPFLoaderUpgradeab1e11111111111111111111111" ||
        programData.owner !== program.owner || !verifyMimirSampledExecutableGeneration(adapter, program, programData)) mismatch("external executable generation");
    expected.push(adapter.program as Address, adapter.programData as Address);
  }
  if (expected.length !== vector.length || expected.some((address, i) => address !== vector[i])) mismatch("external tail identity");
}

/** Producer inputs authenticated from one context: externals, bound PDAs, admin (composite) and Clock for native tails. */
async function standaloneCohortAddresses(ix: MimirBetaInstruction, recipes: readonly MimirFusedRecipe[]): Promise<Address[]> {
  const producer = standaloneProducer(ix); const programId = ix.programAddress; const id = ix.data.slice(1, 33);
  const bound = await Promise.all((producer.executionKind === "classic" ? ["feed_snapshot"] : ["composite_feed_config", "composite_snapshot"])
    .map(async (seed) => (await deriveMimirBetaPda({ programId, seed, values: [id] }))[0]));
  return [...ix.accounts.slice(producer.executionKind === "classic" ? 3 : 9).map((m) => m.address), ...bound,
    ...(producer.executionKind === "classic" ? [] : [(await deriveMimirBetaCanonicalPdas(programId)).admin[0]]),
    ...(recipes.some((r) => r.externalWidth > r.bindingWidth && r.adapterType <= 3) ? [MIMIR_NATIVE_CLOCK_ADDRESS] : [])];
}

async function authenticateStandaloneProducer(ix: MimirBetaInstruction, payer: Address, read: StandaloneReader, cluster: MimirGenerationCluster,
  prefetch: StandalonePrefetch) {
  const producer = standaloneProducer(ix); const programId = ix.programAddress; const id = ix.data.slice(1, 33);
  if (!Array.isArray(ix.accounts) || Array.from(ix.accounts).some((m) => !m)) mismatch("missing producer account meta");
  const fixedCount = producer.executionKind === "classic" ? 3 : 9;
  if (ix.accounts.length < fixedCount) mismatch("missing producer fixed roles");
  const executionRole = producer.executionKind === "classic" ? 2 : 8;
  const [execution, bump] = await (producer.executionKind === "classic"
    ? deriveMimirClassicExecutionAddress(programId, id) : deriveMimirCompositeExecutionAddress(programId, id));
  if (ix.accounts[executionRole]!.address !== execution) mismatch("execution PDA");
  const owned = async (address: Address, length?: number) => {
    const account = await read(address);
    if (!account || account.owner !== programId || account.executable || length !== undefined && account.data.length !== length) mismatch("owned account " + address);
    return account!;
  };
  const account = await owned(execution); const canonical = await deriveMimirBetaCanonicalPdas(programId);
  const state = producer.executionKind === "classic"
    ? await decodeMimirClassicExecutionAccount({ programId, address: execution, owner: account.owner, data: account.data, requireActive: true })
    : decodeMimirCompositeExecution(account.data);
  if (!state.active || state.bump !== bump) mismatch("inactive execution or bump");
  const rows = "primary" in state ? [...state.primary, ...(state.converter?.sources ?? [])] : [...state.components, ...(state.converter?.sources ?? [])];
  const recipes = state.layout.descriptors;
  const expectedCount = fixedCount + recipes.reduce((n, r) => n + r.externalWidth, 0) + (recipes.some((r) => r.requiresInstructionsSysvar) ? 1 : 0);
  if (ix.accounts.length !== expectedCount || state.componentCount !== producer.n || state.converterSourceCount !== producer.s) mismatch("producer account or row count");
  prefetch(execution, await standaloneCohortAddresses(ix, recipes));
  let cursor = fixedCount;
  const vectors = [] as Address[][];
  for (const [index, row] of rows.entries()) {
    const vector = ix.accounts.slice(cursor, cursor + recipes[index]!.externalWidth).map((m) => m.address);
    cursor += vector.length; vectors.push(vector);
    const recipe = recipes[index]!;
    const tickStart = recipe.adapterType === 1
      ? mimirAdmittedRecipe({ ...recipe, accountsBindingVersion: 1, converterRow: index >= producer.n }).bindingWidth : -1;
    for (const [k, address] of vector.entries()) {
      const member = row.membership.accounts[k];
      if (member && address !== member.address) mismatch("stored membership address");
      const live = await read(address) ?? (tickStart >= 0 && k >= tickStart && k < tickStart + 3
        ? decodeMimirBetaCaptureRpcAccount(address, null) : null);
      if (!live || member && (live.owner !== member.owner || live.executable !== member.executable)) mismatch("stored membership owner/executable");
      const executable = recipe.adapterType === 4 && (recipe.mode === 4 || recipe.mode === 5) ? k === 5 || k === 6
        : recipe.adapterType === 6 && (recipe.mode === 4 || recipe.mode === 5) ? k === 7
        : recipe.adapterType === 3 && (recipe.mode === 2 || recipe.mode === 5) || [2, 0, 7].includes(recipe.adapterType) && recipe.mode === 3 ||
          recipe.adapterType === 2 && recipe.temporalKind === 6 ? k === recipe.externalWidth - 2 : false;
      if (!member && live!.executable !== executable) mismatch("external executable role");
    }
    if (recipe.externalWidth > recipe.bindingWidth) await authenticateStandaloneTail(row.sourceConfigImage, recipe, vector, read, cluster, index >= producer.n);
  }
  let rebuilt: MimirBetaInstruction;
  if ("primary" in state) {
    const [snapshot] = await deriveMimirBetaPda({ programId, seed: "feed_snapshot", values: [id] });
    const [feedConfig] = await deriveMimirBetaPda({ programId, seed: "feed_config", values: [id] });
    if (!bytesEqual(state.feedId, id) || state.snapshot !== snapshot) mismatch("classic feed/snapshot binding");
    const snap = decodeFeedSnapshotHeader((await owned(snapshot, 512)).data);
    if (!bytesEqual(snap.feedId, id) || bytesAddress(snap.feedConfig) !== feedConfig) mismatch("classic public snapshot binding");
    const wire = decodeMimirFusedClassicData(ix.data);
    const current = mimirFusedClassicRequest({ state, snapshotRevision: snap.snapshotRevision, mode: producer.action, declaredMaxSnapshotAge: wire.declaredMaxSnapshotAge,
      maxReuseAgeSlots: wire.maxReuseAgeSlots ?? 0 });
    rebuilt = buildMimirFusedClassicInstruction({ programId, snapshot, registry: canonical.registry[0], execution, layout: state.layout,
      primaryExternals: vectors.slice(0, producer.n), converterExternals: vectors.slice(producer.n),
      request: producer.action === "publish" ? { ...current, ...publishFloors(wire.previousSnapshotRevision, current.previousSnapshotRevision,
        wire.ringNewestSlots, current.ringNewestSlots), ringNewestSlots: wire.ringNewestSlots }
        : wire.ensureSample ? { ...current, ...sampleFloors(wire.previousSnapshotRevision, current.previousSnapshotRevision,
          wire.ringNewestSlots, current.ringNewestSlots), ringNewestSlots: wire.ringNewestSlots, ensureSample: true } : current });
  } else {
    const [cfcAddress, cfcBump] = await deriveMimirBetaPda({ programId, seed: "composite_feed_config", values: [id] });
    const cfc = (await owned(cfcAddress, 661)).data; const config = decodeMimirCompositeConfig(cfc);
    const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength); const u = (o: number) => view.getBigUint64(o, true);
    const revision = new DataView(cfc.buffer, cfc.byteOffset, cfc.byteLength).getBigUint64(168, true);
    const converterAddress = isZeroBytes(cfc.subarray(197, 229)) ? null : bytesAddress(cfc.subarray(197, 229));
    if (!bytesEqual(state.compositeFeedId, id) || state.cfc !== cfcAddress || config.feedId !== bytesAddress(id) || config.bump !== cfcBump ||
        config.components.length !== producer.n || !!state.converter !== !!converterAddress || state.cfcRevision !== revision || u(33) !== revision ||
        !bytesEqual(await mimirFusedCfcDigest(cfcAddress, cfc), state.cfcDigest)) mismatch("composite config binding");
    const sourceAddress = async (image: Uint8Array, feedId: Uint8Array) => {
      const source = decodeMimirBetaLiveSource(image);
      const [address, sourceBump] = await deriveMimirBetaPda({ programId, seed: "source_config", values: [source.feedId, Uint8Array.of(source.sourceIndex)] });
      if (!bytesEqual(source.feedId, feedId) || source.bump !== sourceBump) mismatch("composite source binding");
      return address;
    };
    for (const [i, row] of state.components.entries()) {
      const feed = decodeMimirBetaLiveFeed(row.feedConfigImage);
      if (bytesAddress(feed.feedId) !== config.components[i]!.feed || await sourceAddress(row.sourceConfigImage, feed.feedId) !== config.components[i]!.sourceConfig) mismatch("ordered component binding");
    }
    if (state.converter) {
      const feed = decodeMimirBetaLiveFeed(state.converter.feedConfigImage);
      const addresses = await Promise.all(state.converter.sources.map((row, j) => {
        if (decodeMimirBetaLiveSource(row.sourceConfigImage).sourceIndex !== j) mismatch("ordered converter source binding");
        return sourceAddress(row.sourceConfigImage, feed.feedId);
      }));
      if (addresses[0] !== converterAddress) mismatch("converter source binding");
    }
    const [snapshot] = await deriveMimirBetaPda({ programId, seed: "composite_snapshot", values: [id] });
    const current = await read(snapshot); let snapshotRevision = 0n;
    if (current && !(current.owner === MIMIR_BETA_SYSTEM_PROGRAM_ID && !current.executable && current.data.length === 0)) {
      const snap = decodeMimirBrowserCompositeSnapshotHeader((await owned(snapshot, 720)).data);
      if (!bytesEqual(snap.compositeFeedId, id) || bytesAddress(snap.compositeConfig) !== cfcAddress) mismatch("composite snapshot binding");
      snapshotRevision = snap.snapshotRevision;
    } else if (u(41) !== 0n || u(49) !== (producer.action === "sample" ? 0n : 1n)) mismatch("missing composite snapshot");
    const admin = await decodeMimirBetaAdminContext(canonical.admin[0], (await owned(canonical.admin[0], 192)).data);
    if (admin.bump !== canonical.admin[1]) mismatch("admin bump");
    const [feeVault] = await deriveMimirBetaPda({ programId, seed: "feed_fee_vault", values: [id] });
    const heads = [...state.components, ...(state.converter?.sources ?? [])].map((r) => r.ringNewestSlot);
    const publish = producer.action === "publish"; const ensure = ix.data[63] === 1;
    const signed = publish || ensure ? heads.map((_, i) => u(106 + 8 * i)) : heads;
    const previous = publish || ensure ? publishFloors(u(41), snapshotRevision, signed, heads).previousSnapshotRevision : snapshotRevision;
    const request: MimirFusedRefreshRequest = { compositeFeedId: id, expectedConfigRevision: revision, previousSnapshotRevision: previous,
      nextSnapshotRevision: publish ? previous + 1n : previous,
      componentSourceConfigRevisions: state.components.map((r) => r.sourceConfigRevision), maxRefreshFeeLamports: u(98),
      componentRingNewestSlots: signed.slice(0, producer.n), converterRingNewestSlots: signed.slice(producer.n),
      maxReuseAgeSlots: view.getUint16(64, true), ...(ensure ? { ensureSample: true } : {}) };
    rebuilt = buildMimirFusedCompositeRefreshInstruction({ programId, payer, compositeSnapshot: snapshot, compositeConfig: cfcAddress,
      registry: canonical.registry[0], adminConfig: canonical.admin[0], feeVault, treasury: admin.feeTreasury, execution, layout: state.layout,
      componentExternals: vectors.slice(0, producer.n), converterExternals: vectors.slice(producer.n), request });
  }
  if (!bytesEqual(rebuilt.data, ix.data) || rebuilt.accounts.some((m, i) => m.address !== ix.accounts[i]!.address ||
      m.isSigner !== ix.accounts[i]!.isSigner || m.isWritable !== ix.accounts[i]!.isWritable)) mismatch("authenticated producer bytes/metas");
  return { recipes, converterSourceCount: state.converterSourceCount };
}

/** Fused publish: the signed revision and ring heads are floors on the authenticated current state (sample-only stays exact). */
function publishFloors(previous: bigint, current: bigint, signedHeads: readonly bigint[], heads: readonly bigint[]) {
  if (previous > current || signedHeads.some((h, i) => h > heads[i]!)) mismatch("publish floor above current state");
  return { previousSnapshotRevision: previous, nextSnapshotRevision: previous + 1n };
}

function sampleFloors(previous: bigint, current: bigint, signedHeads: readonly bigint[], heads: readonly bigint[]) {
  return { previousSnapshotRevision: publishFloors(previous, current, signedHeads, heads).previousSnapshotRevision, nextSnapshotRevision: previous };
}

function assertStandaloneMetadata(claim: Readonly<{ recipes: readonly MimirFusedRecipe[]; converterSourceCount: number }>,
  trusted: Readonly<{ recipes: readonly MimirFusedRecipe[]; converterSourceCount: number }>) {
  const fields = ["minSlotGap", "externalWidth", "temporalKind", "mode", "requiresInstructionsSysvar", "adapterType", "adapterVersion", "bindingWidth", "accountsBindingVersion"] as const;
  if (claim.converterSourceCount !== trusted.converterSourceCount || claim.recipes.length !== trusted.recipes.length ||
      claim.recipes.some((r, i) => fields.some((field) => r[field] !== trusted.recipes[i]![field]))) mismatch("row metadata differs from authenticated execution");
}

/**
 * Devnet/mainnet tag-87/88/89/90 producers require a verified capability for this program and packet; localnet stays open unless
 * `releaseRecipeScope` asks for the pinned release recipe scope, which is checked first on every cluster.
 */
export function assertMimirAbi1Capable(args: Readonly<{ cluster: string; programId: Address; capability?: MimirAbi1Capability;
  recipes: readonly MimirFusedRecipe[]; releaseRecipeScope?: boolean } & MimirCapabilityPacketV1>): void {
  if (args.releaseRecipeScope) assertMimirAbi1ReleaseRecipeScope(args.capability, args.recipes);
  if (args.cluster === "localnet") return;
  if (!args.capability || args.capability.manifest.programId !== args.programId) mismatch("no verified capability manifest for this program");
  const cluster = args.cluster === "mainnet" ? "mainnet-beta" : args.cluster;
  if (args.capability!.manifest.clusterGenesisHash !== MIMIR_CANONICAL_GENESIS[cluster as keyof typeof MIMIR_CANONICAL_GENESIS]) {
    mismatch(`capability genesis is not the canonical ${cluster} genesis`);
  }
  assertMimirAbi1RecipesCapable(args.capability!, args.recipes, { action: args.action, executionKind: args.executionKind, converterSourceCount: args.converterSourceCount });
}

/** Strict exact-message simulation: `err === null` and `0 < unitsConsumed <= packet.config.computeUnitLimit`; anything else fails. */
export function assertMimirStrictSimulation(transaction: Readonly<{ packet: Readonly<{ config: Readonly<{ computeUnitLimit: number }> }> }>,
  sim: Readonly<{ err?: unknown; unitsConsumed?: bigint | number | null; logs?: unknown }>): bigint {
  if (sim.err !== null && sim.err !== undefined) throw new MimirBetaSimulationError(mimirBetaSimulationFailure(sim.err, sim.logs, ""));
  const u = sim.unitsConsumed;
  const units = typeof u === "bigint" ? u : typeof u === "number" && Number.isSafeInteger(u) ? BigInt(u) : -1n;
  if (sim.err !== null || units <= 0n || units > BigInt(transaction.packet.config.computeUnitLimit)) {
    betaError("SIMULATION_FAILED", "exact simulation failed or reported no valid compute units");
  }
  return units;
}

/** The detached manifest must name the SDK package the runtime actually bundles: its version and exact tarball SHA-256. */
export function assertMimirCapabilitySdkPackage(manifest: MimirCapabilityManifestV1, bundled: Readonly<{ version: string; tarballSha256: string }>): void {
  if (manifest.sdkVersion !== bundled.version || manifest.sdkTarballSha256 !== bundled.tarballSha256.toLowerCase()) mismatch("SDK package");
}

/**
 * D3 standalone publication: the refresh group's `updates + publish`, flattened, compiled and simulated once, as one transaction.
 * It never goes through the consumer planner. Devnet/mainnet require a verified capability; localnet stays open.
 */
export async function prepareMimirStandalonePublication(args: Readonly<{
  programId: Address; payer: Address; cluster: "localnet" | "devnet" | "mainnet-beta"; target: MimirRefreshTarget;
  buildRefreshGroup: (target: MimirRefreshTarget) => Promise<MimirRefreshGroup>;
  /** A value, or a provider called once after group building and trusted authentication, immediately before compilation. */
  recentBlockhash: StandaloneBlockhash | (() => Promise<StandaloneBlockhash>);
  capability?: MimirAbi1Capability; priorityFeeLamports?: bigint; releaseRecipeScope?: boolean;
  readAccount?: StandaloneReader;
  /** Coherent reader, preferred over `readAccount`: all requested accounts from one RPC context at or above `minContextSlot` (header-only venue ProgramData). */
  readAccounts?: StandaloneCohortReader;
  /** Authentication floor, for example the newest slot of the planning reuse; every authenticated byte comes from one context at or above it. */
  minContextSlot?: bigint;
  /** Exact fused recipes of the tag-87/88/89/90 rows being published (the canonical builder reports them on the group). */
  recipes?: readonly MimirFusedRecipe[]; converterSourceCount?: number;
  simulate?: (wireTransactionBase64: string) => Promise<Readonly<{ err: unknown; unitsConsumed?: bigint | number; logs?: unknown }>>;
}>): Promise<Readonly<{ transaction: MimirBetaUnsignedTransaction; check: MimirRefreshGroup["check"]; unitsConsumed: bigint | null;
  publication: NonNullable<MimirRefreshGroup["publication"]> | null; preparationDrift?: MimirRefreshGroup["preparationDrift"] }>> {
  const group = await args.buildRefreshGroup(args.target);
  const instructions = [...group.updates, group.publish].flatMap((u) => u.instructions);
  if (!group.publish.instructions.length || instructions.some((ix) => ix.programAddress !== args.programId)) {
    betaError("PROGRAM_ABI_MISMATCH", "standalone publication group is empty or targets another program");
  }
  const accounts = new Map<Address, Promise<StandaloneAccount | null>>();
  const copy = (a: StandaloneAccount | null | undefined) => a ? { ...a, data: Uint8Array.from(a.data) } : null;
  const trustedReader = !!(args.readAccounts || args.readAccount);
  let contextSlot: bigint | undefined;
  const readMany = async (addresses: readonly Address[]) => {
    const floor = contextSlot ?? args.minContextSlot;
    const result = await args.readAccounts!(addresses, floor);
    if (result.value.length !== addresses.length) betaError("RPC_CONTEXT_MISMATCH", "incomplete coherent read");
    if (floor !== undefined && result.slot < floor) betaError("RPC_CONTEXT_MISMATCH", "context regressed");
    return result;
  };
  const read: StandaloneReader = (address) => {
    if (!accounts.has(address)) accounts.set(address, args.readAccounts ? readMany([address]).then((r) => copy(r.value[0])) : args.readAccount!(address).then(copy));
    return accounts.get(address)!;
  };
  const served = new Set<Address>(); let seeded = false;
  const serve = (set: readonly Address[], cohort: Promise<readonly (StandaloneAccount | null)[]>) => {
    for (const [i, address] of set.entries()) {
      const account = cohort.then((value) => copy(value[i]));
      account.catch(() => undefined);
      accounts.set(address, account); served.add(address);
    }
  };
  const prefetch: StandalonePrefetch = (execution, addresses) => {
    if (!args.readAccounts) { for (const address of addresses) read(address).catch(() => undefined); return; }
    const set = [...new Set([execution, ...addresses])];
    const reseed = seeded; seeded = false;
    if (set.every((address) => served.has(address))) return;
    if (reseed) for (const address of served) if (!set.includes(address)) { accounts.delete(address); served.delete(address); }
    serve(set, Promise.all([read(execution), readMany(set)]).then(([validated, result]) => {
      const same = (a: StandaloneAccount | null, b: StandaloneAccount | null | undefined) => !a ? !b : !!b && a.owner === b.owner && a.executable === b.executable && bytesEqual(a.data, b.data);
      if (contextSlot !== undefined && result.slot !== contextSlot && !reseed || !same(validated, result.value[0])) betaError("RPC_CONTEXT_MISMATCH", COHORT_NOT_CONVERGED);
      contextSlot = result.slot;
      return result.value;
    }));
  };
  if (args.readAccounts) {
    const units = [...group.updates, group.publish];
    const sets = await Promise.all(units.flatMap((unit) => unit.instructions.map(async (ix) => {
      const producer = standaloneProducer(ix);
      const [execution] = await (producer.executionKind === "classic" ? deriveMimirClassicExecutionAddress(ix.programAddress, ix.data.slice(1, 33))
        : deriveMimirCompositeExecutionAddress(ix.programAddress, ix.data.slice(1, 33)));
      return [execution, ...await standaloneCohortAddresses(ix, unit.abi1?.recipes ?? (unit === group.publish ? group.abi1Recipes ?? args.recipes : undefined) ?? [])];
    }))).catch(() => null);
    if (sets) {
      const set = [...new Set(sets.flat())];
      serve(set, readMany(set).then((result) => { contextSlot = result.slot; return result.value; }));
      seeded = true;
    }
  }
  for (const unit of [...group.updates, group.publish]) {
    const claims = [unit.abi1, ...(unit === group.publish ? [
      args.recipes ? { recipes: args.recipes, converterSourceCount: args.converterSourceCount ?? group.abi1ConverterSourceCount ?? 0 } : undefined,
      group.abi1Recipes ? { recipes: group.abi1Recipes, converterSourceCount: group.abi1ConverterSourceCount ?? 0 } : undefined] : [])]
      .filter((claim) => claim !== undefined);
    for (const ix of unit.instructions) {
      const producer = standaloneProducer(ix);
      if (!trustedReader && (args.cluster !== "localnet" || args.releaseRecipeScope)) mismatch("standalone publication requires a trusted account reader");
      const trusted = trustedReader ? await authenticateStandaloneProducer(ix, args.payer, read, args.cluster === "mainnet-beta" ? "mainnet" : args.cluster, prefetch) : claims[0];
      for (const claim of claims) {
        if (claim.converterSourceCount !== producer.s || claim.recipes.length !== producer.n + producer.s) mismatch(`${producer.executionKind} wire N${producer.n}S${producer.s} differs from its row metadata`);
        if (trustedReader) assertStandaloneMetadata(claim, trusted!);
      }
      if (trustedReader && unit === group.publish && args.converterSourceCount !== undefined && args.converterSourceCount !== trusted!.converterSourceCount) mismatch("converter row metadata");
      assertMimirAbi1Capable({ cluster: args.cluster, programId: args.programId, ...(args.capability ? { capability: args.capability } : {}), recipes: trusted?.recipes ?? [],
        releaseRecipeScope: args.releaseRecipeScope, action: producer.action, executionKind: producer.executionKind, converterSourceCount: producer.s });
    }
  }
  const recentBlockhash = typeof args.recentBlockhash === "function" ? await args.recentBlockhash() : args.recentBlockhash;
  const transaction = await compileMimirBetaTransactionV1({ feePayer: args.payer, recentBlockhash: recentBlockhash.blockhash,
    lastValidBlockHeight: recentBlockhash.lastValidBlockHeight, instructions,
    ...(args.priorityFeeLamports !== undefined ? { priorityFeeLamports: args.priorityFeeLamports } : {}) });
  let unitsConsumed: bigint | null = null;
  if (args.cluster === "mainnet-beta" && !args.simulate) betaError("SIMULATION_FAILED", "mainnet standalone publication requires an exact-wire simulation");
  if (args.simulate) {
    const sim = await args.simulate(base64(transaction.serializedTransaction));
    if (sim.err !== null && sim.err !== undefined && group.preparationDrift) await group.preparationDrift(sim.err, sim.logs);
    if (args.cluster === "mainnet-beta") unitsConsumed = assertMimirStrictSimulation(transaction, sim);
    else {
      if (sim.err !== null && sim.err !== undefined) throw new MimirBetaSimulationError(mimirBetaSimulationFailure(sim.err, sim.logs, args.programId, instructions));
      unitsConsumed = sim.unitsConsumed === undefined ? null : BigInt(sim.unitsConsumed);
    }
  }
  return { transaction, check: group.check, unitsConsumed, publication: group.publication ?? null,
    ...(group.preparationDrift ? { preparationDrift: group.preparationDrift } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// A2 §8.2 real-builder authority: TxV1 compile admission from the actual key union, and creation preflight over a consuming
// program's hash-pinned budget contract. Case names are opaque consumer strings. Until the contract records a measured cell
// for every case, the creation fails closed.

export type MimirConsumerAdmissionRejectionV1 =
  | "TRANSPORT_KEYS" | "TRANSPORT_BYTES" | "TRANSPORT_INSTRUCTIONS" | "TRANSPORT_SIGNATURES" | "TRANSPORT_CU" | "UNKNOWN_CU" | "UNSUPPORTED_CELL"
  | "SETUP_VIEW_MISSING" | "WITNESS_MISSING";

export interface MimirPacketCensusV1 {
  readonly keys: number; readonly freeKeys: number; readonly bytes: number | null; readonly instructions: number; readonly signatures: number;
  readonly cu: number | null; readonly headroomTargetMet: boolean; readonly rejection: MimirConsumerAdmissionRejectionV1 | null;
}

/**
 * Exact-packet CU evidence: a successful simulation receipt over the exact compiled TxV1 message (payer, instructions, blockhash, config),
 * or a measured bank cell for this action whose instruction hash and census are this packet's. Anything else is `UNKNOWN_CU`.
 */
export type MimirCuEvidenceA2 = Readonly<{ cellId: string }> | Readonly<{ simulation: Readonly<{
  recentBlockhash: string; priorityFeeLamports?: bigint; serializedMessageBase64: string; unitsConsumed: number; err: null }> }>;

export async function verifyMimirCuEvidenceA2(args: Readonly<{ capability?: MimirAbi1Capability; action: MimirCapabilityActionV1; payer: Address;
  instructions: readonly MimirBetaInstruction[]; evidence?: MimirCuEvidenceA2 | null }>): Promise<number | null> {
  const e = args.evidence;
  if (!e) return null;
  if ("simulation" in e) {
    const sim = e.simulation;
    if (sim.err !== null || !Number.isSafeInteger(sim.unitsConsumed) || sim.unitsConsumed <= 0) return null;
    const compiled = await compileMimirBetaTransactionV1({ feePayer: args.payer, recentBlockhash: sim.recentBlockhash, lastValidBlockHeight: 0n,
      instructions: args.instructions, ...(sim.priorityFeeLamports !== undefined ? { priorityFeeLamports: sim.priorityFeeLamports } : {}) });
    return base64(compiled.serializedMessage) === sim.serializedMessageBase64 ? sim.unitsConsumed : null;
  }
  const cell = args.capability?.cells.get(e.cellId);
  if (cell?.status !== "measured" || cell.cuAfter === null || cell.action !== args.action ||
      cell.instructionsSha256 !== await mimirInstructionsSha256(args.instructions)) return null;
  const own = await census(args.payer, args.instructions, cell.cuAfter);
  return own.keys === cell.keys && own.bytes === cell.bytes && own.instructions === cell.instructions && own.signatures === cell.signers ? cell.cuAfter : null;
}
/** Canonical hash of an instruction list (program, ordered metas with privileges, data): what CU evidence is bound to. */
export const mimirInstructionsSha256 = (instructions: readonly MimirBetaInstruction[]) => mimirSortedJsonSha256(instructions.map((ix) => ({
  program: ix.programAddress, accounts: ix.accounts.map((m) => [m.address, m.isSigner, m.isWritable]), data: hex(ix.data) })));

async function census(payer: Address, instructions: readonly MimirBetaInstruction[], cu: number | null): Promise<MimirPacketCensusV1> {
  const keys = new Set<Address>([payer]); const signers = new Set<Address>([payer]);
  for (const ix of instructions) { keys.add(ix.programAddress); for (const m of ix.accounts) { keys.add(m.address); if (m.isSigner) signers.add(m.address); } }
  let bytes: number | null = null; let compiledKeys = keys.size; let failure: MimirConsumerAdmissionRejectionV1 | null = null;
  try {
    const tx = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n, instructions });
    bytes = tx.packet.serializedTransactionBytes; compiledKeys = tx.packet.accountCount;
  } catch (error) {
    if (!(error instanceof MimirBetaError) || error.code !== "TRANSACTION_TOO_LARGE") throw error;
    failure = /64 accounts/.test(error.message) ? "TRANSPORT_KEYS" : /instructions/.test(error.message) ? "TRANSPORT_INSTRUCTIONS"
      : /signatures/.test(error.message) ? "TRANSPORT_SIGNATURES" : "TRANSPORT_BYTES";
  }
  if (!failure && cu === null) failure = "UNKNOWN_CU";
  if (!failure && cu! > MIMIR_ABI1_LIMITS.cu) failure = "TRANSPORT_CU";
  return { keys: compiledKeys, freeKeys: MIMIR_ABI1_LIMITS.staticKeys - compiledKeys, bytes, instructions: instructions.length,
    signatures: signers.size, cu, headroomTargetMet: compiledKeys <= MIMIR_ABI1_LIMITS.targetMaxKeys, rejection: failure };
}

export interface MimirTxV1AdmissionV1 extends MimirPacketCensusV1 {
  readonly admitted: boolean;
  /** Owner target `keys <= 54`, reported separately from the hard 64-key limit. */
  readonly ownerTargetMet: boolean;
  /** Roles ranked by the distinct keys only they contribute to the union. */
  readonly limitingRoles: readonly Readonly<{ role: string; keys: number }>[];
  /** Largest leading source count whose key union fits 64 (`hard`) and 54 (`owner`); null when no sources were labelled. */
  readonly suggestedSourceCount: Readonly<{ hard: number; owner: number }> | null;
}

/**
 * Compile admission of one real packet from its actual key union (§8.2). Hard refusal: >64 keys, >4,096 bytes, >64 instructions,
 * >1.4M CU, unknown CU, or an unsupported cell. `roles` labels addresses for the limiting-role report (unlabelled keys are grouped
 * by instruction); `sources` are the ordered per-source external keys used to suggest a source count. No family/token rules.
 */
export async function admitMimirTxV1Packet(args: Readonly<{
  payer: Address; instructions: readonly MimirBetaInstruction[]; cu: number | null; unsupportedCell?: boolean;
  roles?: Readonly<Record<string, readonly Address[]>>; sources?: readonly (readonly Address[])[];
}>): Promise<MimirTxV1AdmissionV1> {
  const c = await census(args.payer, args.instructions, args.cu);
  const all = new Set<Address>([args.payer]);
  const owners = new Map<Address, Set<string>>();
  const own = (a: Address, role: string) => { all.add(a); (owners.get(a) ?? owners.set(a, new Set()).get(a)!).add(role); };
  const labelled = new Map<Address, string>();
  for (const [role, keys] of Object.entries(args.roles ?? {})) for (const a of keys) labelled.set(a, role);
  args.instructions.forEach((ix, i) => [ix.programAddress, ...ix.accounts.map((m) => m.address)].forEach((a) => own(a, labelled.get(a) ?? `ix${i}`)));
  const tally = new Map<string, number>();
  for (const roles of owners.values()) if (roles.size === 1) { const [r] = roles; tally.set(r!, (tally.get(r!) ?? 0) + 1); }
  const limitingRoles = [...tally].map(([role, keys]) => ({ role, keys })).sort((a, b) => b.keys - a.keys || a.role.localeCompare(b.role));
  let suggestedSourceCount: MimirTxV1AdmissionV1["suggestedSourceCount"] = null;
  if (args.sources?.length) {
    const sourceKeys = new Set(args.sources.flat());
    const fixed = [...all].filter((a) => !sourceKeys.has(a)).length;
    const fit = (limit: number) => {
      for (let n = args.sources!.length; n >= 0; n -= 1) if (fixed + new Set(args.sources!.slice(0, n).flat()).size <= limit) return n;
      return 0;
    };
    suggestedSourceCount = { hard: fit(MIMIR_ABI1_LIMITS.staticKeys), owner: fit(MIMIR_ABI1_LIMITS.targetMaxKeys) };
  }
  const rejection = args.unsupportedCell ? "UNSUPPORTED_CELL" : c.rejection;
  return { ...c, rejection, admitted: rejection === null, ownerTargetMet: c.keys <= MIMIR_ABI1_LIMITS.targetMaxKeys, limitingRoles, suggestedSourceCount };
}

/** One measured real-builder cell of a consumer budget contract: an opaque consumer case around a Mimir cell signature, compiled and banked. */
export interface MimirConsumerBudgetCellV1 {
  readonly case: string; readonly cell: string; readonly keys: number; readonly bytes: number; readonly instructions: number;
  readonly signers: number; readonly cu: number | null; readonly status: "measured" | "open" | "KEY_LIMIT";
}
export interface MimirConsumerBudgetPayloadV1 {
  readonly schema: "mimir-consumer-budget-a2-v1"; readonly consumer: string; readonly cluster_genesis_hash: string; readonly mimir_program_id: string;
  readonly consumer_program_ids: readonly string[];
  readonly limits: Readonly<{ keys: number; targetMaxKeys: number; bytes: number; instructions: number; cu: number }>;
  /** The consumer's opaque case names; every one needs a measured in-limit cell for a cell signature to be admitted. */
  readonly cases: readonly string[];
  readonly cells: readonly MimirConsumerBudgetCellV1[];
}
/** `contract_sha256` is SHA-256 of the sorted-key compact JSON of `payload`. Published by the consuming program. */
export interface MimirConsumerBudgetContractV1 { readonly contract_sha256: string; readonly payload: MimirConsumerBudgetPayloadV1 }

const CONSUMER_STATUS: readonly MimirConsumerBudgetCellV1["status"][] = ["measured", "open", "KEY_LIMIT"];
const inRange = (value: unknown, max: number) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
const consumerCellValid = (c: MimirConsumerBudgetCellV1) => typeof c.case === "string" && typeof c.cell === "string" &&
  inRange(c.keys, MIMIR_ABI1_LIMITS.staticKeys) && inRange(c.signers, c.keys) && inRange(c.bytes, MIMIR_ABI1_LIMITS.bytes) &&
  inRange(c.instructions, MIMIR_ABI1_LIMITS.outerInstructions) && CONSUMER_STATUS.includes(c.status) &&
  (c.status === "measured" ? inRange(c.cu, MIMIR_ABI1_LIMITS.cu) && c.cu! > 0 : c.cu === null);

/** Hash-pinned contract bound to the verified deployment: same genesis/program, and every cell in domain. */
export async function verifyMimirConsumerBudgetContractV1(contract: MimirConsumerBudgetContractV1, pinnedSha256: string,
  capability: MimirAbi1Capability | undefined): Promise<string> {
  const actual = await mimirSortedJsonSha256(contract.payload);
  const { cases, cells } = contract.payload;
  const m = capability?.manifest;
  if (!m || contract.payload.cluster_genesis_hash !== m.clusterGenesisHash || contract.payload.mimir_program_id !== m.programId ||
      contract.payload.schema !== "mimir-consumer-budget-a2-v1" || contract.contract_sha256 !== actual || actual !== pinnedSha256 ||
      !cases?.length || new Set(cases).size !== cases.length || !Array.isArray(cells) || cells.some((c) => !cases.includes(c.case) || !consumerCellValid(c)) ||
      new Set(cells.map((c) => JSON.stringify([c.case, c.cell]))).size !== cells.length ||
      mimirSortedJson(contract.payload.limits) !== mimirSortedJson({ bytes: 4_096, cu: 1_400_000, instructions: 64, keys: 64, targetMaxKeys: 54 })) {
    betaError("PROGRAM_ABI_MISMATCH", "consumer contract is not the hash-pinned mimir-consumer-budget-a2-v1 of this verified deployment");
  }
  return actual;
}

/** Canonical cell signature: classic `N/S` plus each row's adapter/version/mode/E, the key consumer contract cells are banked under. */
export function mimirClassicCellSignature(descriptors: readonly Pick<MimirFusedRecipe, "adapterType" | "adapterVersion" | "mode" | "externalWidth">[], n: number): string {
  const row = (d: (typeof descriptors)[number]) => `${d.adapterType}.${d.adapterVersion}.m${d.mode}.E${d.externalWidth}`;
  return `classic:N${n}S${descriptors.length - n}:${descriptors.slice(0, n).map(row).join(",")}|${descriptors.slice(n).map(row).join(",")}`;
}

/** Composite cell signature: the classic row grammar under a `composite:` prefix. */
export function mimirCompositeCellSignature(descriptors: Parameters<typeof mimirClassicCellSignature>[0], n: number): string {
  return `composite:${mimirClassicCellSignature(descriptors, n).slice("classic:".length)}`;
}

/** ABI-1 §3/§12.3 composite five-role witness: converter SourceConfig0 whenever a converter exists, else component SourceConfig0. */
export function mimirCompositeWitnessA2(components: readonly Readonly<{ sourceConfig: Address }>[],
  converter: readonly Readonly<{ sourceConfig: Address }>[]): Address {
  return (converter[0] ?? components[0] ?? betaError("INVALID_ARGUMENT", "composite has no component")).sourceConfig;
}

/** Consumer budget contract inputs for prepared creations; the SDK supplies the cell and initializer packet. */
export interface MimirConsumerAdmissionInputsV1 {
  readonly contract?: MimirConsumerBudgetContractV1; readonly contractSha256?: string;
  /** Exact-packet CU evidence for the initializer and fresh-creation setup views; absent or unverifiable is `UNKNOWN_CU`. */
  readonly initializerCu?: MimirCuEvidenceA2; readonly freshCreationCu?: MimirCuEvidenceA2;
}

export interface MimirConsumerCaseResultV1 extends MimirPacketCensusV1 { readonly case: string; readonly ownerTargetMet: boolean }
export interface MimirConsumerAdmissionV1 {
  readonly admitted: boolean; readonly rejection: MimirConsumerAdmissionRejectionV1 | null; readonly reasons: readonly MimirConsumerAdmissionRejectionV1[];
  readonly cases: readonly MimirConsumerCaseResultV1[]; readonly initializer: MimirTxV1AdmissionV1 | null;
  readonly freshCreation: MimirTxV1AdmissionV1 | null; readonly ownerTargetMet: boolean;
  /** Composite five-role witness: converter SourceConfig0 when a converter exists, else component SourceConfig0. Null for classic cells. */
  readonly witness: Address | null;
  readonly contractSha256: string | null; readonly cell: string;
  /** Heaviest consumer case (most keys; null without a verified contract) and the initializer's limiting roles. */
  readonly maxCase: string | null; readonly limitingRoles: MimirTxV1AdmissionV1["limitingRoles"];
}

/**
 * `preflightMimirConsumerAdmissionV1`: every consumer case for the cell must be a measured, in-limit cell of the hash-pinned consumer
 * budget contract, and the tag-90 initializer must compile within TxV1 limits. Without a contract, or for an unbanked/open cell, it refuses.
 */
export async function preflightMimirConsumerAdmissionV1(args: Readonly<{
  contract?: MimirConsumerBudgetContractV1; contractSha256?: string; cell: string;
  /** Verified capability of the active deployment; the contract must name its genesis and program. */
  capability?: MimirAbi1Capability;
  /** Applicable setup views: the execution initializer and the fresh-creation packet. Each one absent is a rejection. */
  initializer?: Readonly<{ payer: Address; instructions: readonly MimirBetaInstruction[]; cu: number | null }>;
  freshCreation?: Readonly<{ payer: Address; instructions: readonly MimirBetaInstruction[]; cu: number | null }>;
  witness?: Address;
}>): Promise<MimirConsumerAdmissionV1> {
  const contractSha256 = args.contract && args.contractSha256 ? await verifyMimirConsumerBudgetContractV1(args.contract, args.contractSha256, args.capability) : null;
  const L = MIMIR_ABI1_LIMITS;
  const cases = (contractSha256 ? args.contract!.payload.cases : []).map((name): MimirConsumerCaseResultV1 => {
    const cell = args.contract!.payload.cells.find((c) => c.case === name && c.cell === args.cell);
    if (!cell) {
      return { case: name, keys: 0, freeKeys: 0, bytes: null, instructions: 0, signatures: 0, cu: null, headroomTargetMet: false, ownerTargetMet: false, rejection: "UNKNOWN_CU" };
    }
    const rejection: MimirConsumerAdmissionRejectionV1 | null = cell.status === "KEY_LIMIT" || cell.keys > L.staticKeys ? "TRANSPORT_KEYS"
      : cell.bytes > L.bytes ? "TRANSPORT_BYTES" : cell.instructions > L.outerInstructions ? "TRANSPORT_INSTRUCTIONS"
      : cell.status !== "measured" || cell.cu === null ? "UNKNOWN_CU" : cell.cu > L.cu ? "TRANSPORT_CU" : null;
    return { case: name, keys: cell.keys, freeKeys: L.staticKeys - cell.keys, bytes: cell.bytes, instructions: cell.instructions, signatures: cell.signers,
      cu: cell.cu, headroomTargetMet: cell.keys <= L.targetMaxKeys, ownerTargetMet: cell.keys <= L.targetMaxKeys, rejection };
  });
  const initializer = args.initializer ? await admitMimirTxV1Packet(args.initializer) : null;
  const freshCreation = args.freshCreation ? await admitMimirTxV1Packet(args.freshCreation) : null;
  const composite = args.cell.startsWith("composite:");
  const reasons = [...new Set([!contractSha256 ? "UNKNOWN_CU" as const : null, ...cases.map((c) => c.rejection), initializer?.rejection ?? null,
    freshCreation?.rejection ?? null, !initializer || !freshCreation ? "SETUP_VIEW_MISSING" as const : null, composite && !args.witness ? "WITNESS_MISSING" as const : null]
    .filter((r): r is MimirConsumerAdmissionRejectionV1 => r !== null))];
  const maxCase = cases.length ? cases.reduce((a, b) => (b.keys > a.keys ? b : a)).case : null;
  return { admitted: reasons.length === 0, rejection: reasons[0] ?? null, reasons, cases, initializer, freshCreation,
    witness: composite ? args.witness ?? null : null, cell: args.cell, maxCase,
    limitingRoles: initializer?.limitingRoles ?? [],
    ownerTargetMet: cases.every((c) => c.ownerTargetMet) && (initializer?.ownerTargetMet ?? true) && (freshCreation?.ownerTargetMet ?? true), contractSha256 };
}
