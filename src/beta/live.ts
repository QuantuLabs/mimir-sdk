import { brand } from "../brand.js";
import { mimirCurrentPointAdmitted } from "../internal/currentPointCore.js";
import { address, type Address } from "@solana/kit";
import {
  buildMimirBetaClassicSourceArtifacts,
  deriveMimirBetaCanonicalPdas,
  deriveMimirBetaClassicFeedId,
  deriveMimirBetaFeedPdas,
  deriveMimirBetaPda,
  type MimirBetaCompactSourceArgs,
  type MimirBetaPhysicalAccountFact,
} from "./abi.js";
import { mimirSampledSourceAdapters } from "../internal/sampledTemporalCore.js";
import { meteoraDlmmFeeRatePpm, meteoraDlmmPointDepth, meteoraDlmmPointEconFloor, meteoraDlmmPointFloor } from "../internal/dlmmPointCore.js";
import { classifyToken2022Mint, classifyToken2022Vault } from "../token2022Clmm.js";
import { addressBytes, base64, bytesAddress, bytesEqual, canonicalJson, domainHash, fromBase64, hex, sha256, utf8 } from "./bytes.js";
import type { MimirBetaFacadeDeployment, MimirBetaPlanningRpc } from "./client.js";
import { decodeMimirBetaCaptureCandidate, deriveMimirBetaCaptureReadPlan, mimirBetaAllCaptureScanDescriptors, type MimirBetaCaptureReadPlan, type MimirBetaCaptureScanDescriptor, MIMIR_BETA_TOKEN_2022_PROGRAM_ID } from "./capture.js";
import { decodeMimirBetaRegistryContext } from "./context.js";
import { mimirBetaEligiblePoolConditions, type MimirBetaEligiblePool, type MimirBetaPoolDiscovery } from "./discovery.js";
import { MIMIR_COND, validateDegradedSnapshot } from "../liveness.js";
import { betaError, MimirBetaDlmmPointError, MimirBetaError, MimirBetaSimulationError, mimirBetaSimulationFailure, MimirBetaStalePreparationError } from "./errors.js";
import { buildMimirFusedClassicInstruction, buildMimirInitFusedClassicClosure, decodeMimirClassicExecutionAccount, decodeMimirFusedClassicData, deriveMimirClassicExecutionAddress,
  MIMIR_CLASSIC_ADMITTED_CONVERTER_RECIPES, mimirClassicExecutionLayout, mimirClassicRefreshMode, mimirClassicRow, mimirFusedClassicRequest, type MimirClassicExecution,
  type MimirClassicRefreshMode } from "./classicExecution.js";
import { assertMimirInitPayerIsFeedCreator, mimirFusedRecipeNeedsWarmup, mimirFusedRowExternals, type MimirFusedDescriptor } from "./compositeExecution.js";
import { assertMimirAbi1Capable, assertMimirStrictSimulation, mimirClassicCellSignature, preflightMimirConsumerAdmissionV1, verifyMimirCuEvidenceA2, type MimirAbi1Capability,
  type MimirConsumerAdmissionInputsV1 } from "./abi1Release.js";
import { decodeMimirBetaLiveFeed, decodeMimirBetaLivePlan,
  decodeMimirBetaLiveRing, decodeMimirBetaLiveSource } from "./liveAbi.js";
import { isMimirBetaLifecycleUninitialized } from "./pairFeeds.js";
import { decodeMimirBetaCaptureRpcAccount, decodeMimirBetaRpcAccount, FinalizedRpcReader, readMimirBetaAccountCohort, MIMIR_BETA_HEADER_ONLY_PROGRAM_DATA } from "./rpc.js";
import { getCompiledTransactionMessageDecoder } from "@solana/transaction-messages";
import { compileMimirBetaTransactionV1 } from "./transactionV1.js";
import { sourceAdapterSupportsVersion, type MimirBetaAccount, type MimirBetaAdapterVersion, type MimirBetaInstruction } from "./types.js";
import type { MimirBetaSimulationFacts, MimirBetaUnsignedTransaction } from "./review.js";
import { decodeFeedConfigHeader, decodeFeedSnapshotHeader, MIMIR_NATIVE_CLOCK_ADDRESS,
  readU128, selectMimirDammTemporalVersion, MIMIR_METEORA_DAMM_V2_ADAPTER_TYPE, extractMeteoraDlmmNativeTwapSample, classifyMeteoraDlmmDualReadiness, extractRaydiumClmmNativeTwapObservationSample,
  readRaydiumClmmPoolCurrentTick, MimirNativeTwapUnavailableError, MimirNativeObservationUnavailableError, mimirExecutableGenerationPins, type MimirGenerationCluster,
  mimirOrcaMarkerQuietInterval, mimirOrcaWhirlpoolsConfigAddress, mimirVenueDeploymentUnix, verifyCpmmExecutableGeneration, verifyDammExecutableGeneration,
  verifyOrcaExecutableGeneration, verifyDlmmExecutableGeneration, decodeMimirBrowserCpmmQuietTemporalModuleV2, decodeMimirBrowserSourceRingV1, METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS,
  METEORA_DLMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS, type MimirNativeTwapUnavailableReason } from "../internal/nativeMonoRefreshCore.js";

const METEORA_DLMM_PROGRAM = address("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
const METEORA_DLMM_PROGRAMDATA = address("HZcJwcJ2njPDxZtpPoKnF8v2w9QAx2rS7TdJPSRkbEhu");
const METEORA_DAMM_V2_PROGRAM = address("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const METEORA_DAMM_V2_PROGRAMDATA = address("AUh8bm2XsMfex3KjYGcM3G4uBqUNSDw6HEhWaWMYnyPH");
const ORCA_WHIRLPOOL_PROGRAM = address("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const ORCA_WHIRLPOOL_PROGRAMDATA = address("CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD");

export function mimirAuthenticClockUnix(clock: MimirBetaAccount | null | undefined, slot: bigint, message: string): bigint {
  const view = clock && clock.data.length === 40 ? new DataView(clock.data.buffer, clock.data.byteOffset, 40) : null;
  if (!clock || !view || clock.owner !== "Sysvar1111111111111111111111111111111111111" || clock.executable ||
      view.getBigUint64(0, true) !== slot || view.getBigInt64(32, true) < 0n) betaError("RPC_CONTEXT_MISMATCH", message);
  return view.getBigInt64(32, true);
}

export interface PrepareMimirBetaClassicRefreshArgs {
  readonly payer: Address;
  /** Exact ordered primary pool set used to create the simple feed. */
  readonly pools: readonly MimirBetaEligiblePool[];
  /** A2 §4.3: `sample` keeps `new=previous`; `publish` is `new=previous+1`. */
  readonly mode: MimirClassicRefreshMode;
  readonly declaredMaxSnapshotAge: number;
  readonly feedId?: Address;
  /** Exact ordered SOL/USDC pool set of the embedded converter feed; required iff the execution has `S>0`. */
  readonly converterPools?: readonly MimirBetaEligiblePool[];
  /** Verified ABI-1 capability; required off localnet. */
  readonly capability?: MimirAbi1Capability;
  /** `sample` signs the exact CAS instead of the default ensure floors. */
  readonly exactSample?: boolean;
  /** `publish` reuse window in slots; default `MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS`, capped on-chain at the max snapshot age. */
  readonly maxReuseAgeSlots?: number;
}

export interface MimirBetaPreparedClassicRefresh {
  readonly schema: "mimir-beta-prepared-classic-refresh";
  readonly version: 1;
  readonly mode: MimirClassicRefreshMode;
  readonly execution: Address;
  readonly contextSlot: bigint;
  readonly evidenceHash: string;
  readonly transaction: MimirBetaUnsignedTransaction;
  readonly simulation: MimirBetaSimulationFacts;
  /** `publish` only: the snapshot the simulated refresh writes; null for `sample`. */
  readonly publication: MimirBetaClassicPublicationOutcome | null;
}

/** Post-state of a simulated classic publish: Fresh, or Degraded with the program's condition word (e.g. `DEPTH_BELOW_FLOOR`). */
export type MimirBetaClassicPublicationOutcome =
  | Readonly<{ status: "fresh" }>
  | Readonly<{ status: "degraded"; conditionFlags: number; priceState: "with-price" | "no-price"; conditionedSources: number;
      belowFloorSources: readonly number[] }>;

/** The signed tag-89 publish and planning/simulation slots a simulated classic snapshot post-state must match. */
export interface MimirClassicPublicationBinding {
  readonly feedId: Uint8Array; readonly feedConfig: Address; readonly configRevision: bigint; readonly planHash: Uint8Array;
  /** The signed `previousSnapshotRevision`: a same-slot re-observation returns Ok without writing. */
  readonly minRevision: bigint;
  /** Planning read slot (the simulation's minContextSlot) and the simulation's actual context slot. */
  readonly floorSlot: bigint; readonly contextSlot: bigint;
}

/**
 * Fresh classic snapshot, or the program's Degraded one, bound to the request; its publication clock (Fresh 116, Degraded
 * liveness 156) lies in [floor, context]; Fresh must also be unexpired at the context. Retained-price clocks are not aged.
 */
export function mimirClassicPublicationOutcome(post: Uint8Array, belowFloorSources: readonly number[], b: MimirClassicPublicationBinding): MimirBetaClassicPublicationOutcome {
  const need = (ok: boolean, why: string) => { if (!ok) throw new Error(`InvalidClassicPublication: ${why}`); };
  need(post.length === 512, "length");
  const v = new DataView(post.buffer, post.byteOffset, post.byteLength), u64 = (o: number) => v.getBigUint64(o, true);
  need(bytesEqual(post.subarray(16, 48), b.feedId) && bytesEqual(post.subarray(48, 80), addressBytes(b.feedConfig)) && u64(88) === b.configRevision &&
    bytesEqual(post.subarray(262, 294), b.planHash), "binding");
  need(u64(96) >= b.minRevision, "revision");
  if (post[104] === 0) {
    try { decodeFeedSnapshotHeader(post); } catch { need(false, "shape"); }
    const p = u64(116);
    need(b.floorSlot <= p && p <= b.contextSlot && b.contextSlot <= u64(124) && v.getBigInt64(132, true) > 0n, "fresh publication time");
    return { status: "fresh" };
  }
  let degraded: ReturnType<typeof validateDegradedSnapshot> | null = null;
  try { degraded = validateDegradedSnapshot(post); } catch { need(false, "shape"); }
  const { publicationSlot, conditionFlags, priceState, conditionedSources } = degraded!.liveness;
  need(b.floorSlot <= publicationSlot && publicationSlot <= b.contextSlot, "degraded publication time");
  return { status: "degraded", conditionFlags, priceState: priceState === 1 ? "with-price" : "no-price", conditionedSources, belowFloorSources };
}

export interface MimirBetaLiveDependencies {
  readonly deployment: MimirBetaFacadeDeployment;
  readonly rpc: MimirBetaPlanningRpc;
  readonly discovery: MimirBetaPoolDiscovery;
}

export interface MimirBetaMonoSimulationCohort {
  readonly blockhash: Promise<Readonly<{ blockhash: string; lastValidBlockHeight: bigint }>>;
  simulate(args: Readonly<{
    instructions: readonly MimirBetaInstruction[];
    minContextSlot: bigint;
    expectedProgram: Address;
    addresses: readonly Address[];
    revise?(failure: MimirBetaSimulationError): Promise<readonly MimirBetaInstruction[] | null>;
  }>): Promise<{ simulation: MimirBetaSimulationFacts; accounts: readonly MimirBetaAccount[]; outsideSimulation: ReadonlySet<Address>; transaction: Awaited<ReturnType<typeof compileMimirBetaTransactionV1>> }>;
}

function parseBlockhash(value: unknown): Readonly<{ blockhash: string; lastValidBlockHeight: bigint }> {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const candidate = record?.value && typeof record.value === "object" ? record.value as Record<string, unknown> : record;
  const height = candidate?.lastValidBlockHeight;
  if (!candidate || typeof candidate.blockhash !== "string" ||
      !((typeof height === "bigint" && height >= 0n) || (typeof height === "number" && Number.isSafeInteger(height) && height >= 0))) {
    betaError("RPC_CONTEXT_MISMATCH", "latest blockhash response malformed");
  }
  return { blockhash: candidate.blockhash, lastValidBlockHeight: typeof height === "bigint" ? height : BigInt(height) };
}

async function simulateExact(rpc: MimirBetaPlanningRpc, wire: Uint8Array, minContextSlot: bigint,
  expectedProgram: Address, commitment: "confirmed" | "finalized"): Promise<MimirBetaSimulationFacts> {
  const response = await rpc.simulateTransaction(base64(wire), {
    commitment, encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, minContextSlot,
  }).send();
  if (!response || typeof response !== "object") betaError("SIMULATION_FAILED", "live-refresh simulation response malformed");
  const record = response as Record<string, unknown>; const context = record.context as Record<string, unknown> | undefined;
  const value = record.value as Record<string, unknown> | undefined; const rawSlot = context?.slot;
  const contextSlot = typeof rawSlot === "bigint" ? rawSlot : typeof rawSlot === "number" && Number.isSafeInteger(rawSlot) ? BigInt(rawSlot) : -1n;
  if (value && contextSlot >= minContextSlot && value.err !== null && value.err !== undefined) {
    throw new MimirBetaSimulationError(mimirBetaSimulationFailure(value.err, value.logs, expectedProgram));
  }
  if (!value || contextSlot < minContextSlot || value.err !== null) betaError("SIMULATION_FAILED", "exact live-refresh simulation failed");
  const logs = Array.isArray(value.logs) && value.logs.every((entry) => typeof entry === "string") ? value.logs as string[] : [];
  let returnDataHash: string | null = null;
  if (value.returnData !== null && value.returnData !== undefined) {
    const returned = value.returnData as Record<string, unknown>; const data = returned.data;
    if (returned.programId !== expectedProgram || !Array.isArray(data) || data.length !== 2 || data[1] !== "base64" || typeof data[0] !== "string") {
      betaError("SIMULATION_FAILED", "live-refresh simulation return data malformed");
    }
    returnDataHash = hex(await sha256(fromBase64(data[0])));
  }
  const units = value.unitsConsumed;
  const unitsConsumed = units === undefined || units === null ? null : typeof units === "bigint" ? units :
    typeof units === "number" && Number.isSafeInteger(units) && units >= 0 ? BigInt(units) :
      betaError("SIMULATION_FAILED", "live-refresh simulation units malformed");
  return { status: "succeeded", contextSlot, unitsConsumed,
    logsHash: hex(await sha256(utf8(canonicalJson(logs as never)))), returnDataHash, error: null };
}

export async function proveMimirBetaPreparationDrift(rpc: MimirBetaPlanningRpc, rows: ReadonlyMap<Address, MimirBetaAccount>,
  observedSlot: bigint, mimirProgram: Address, commitment: "confirmed" | "finalized", failure: unknown,
  instructions: readonly MimirBetaInstruction[], plannedPools: readonly MimirBetaEligiblePool[] = [],
  diagnosticCohort?: ReadonlyMap<Address, MimirBetaAccount | null | undefined>): Promise<never> {
  if (!(failure instanceof MimirBetaSimulationError) || failure.programId !== mimirProgram ||
      (failure.customCode !== 3 && failure.customCode !== 46 && failure.customCode !== 54 && failure.customCode !== 56)) throw failure;
  const relevant = new Set(instructions.filter((instruction) => instruction.programAddress === mimirProgram)
    .flatMap((instruction) => instruction.accounts.map((meta) => meta.address)));
  if (failure.customCode === 3) {
    // Custom 3 is structural unless this exact instruction supplied an authenticated, now obsolete DLMM vector.
    const failed = failure.instructionIndex === null ? undefined : instructions[failure.instructionIndex];
    const origin = failure.logs.map((line) => /^Program (\S+) failed: custom program error: (0x[0-9a-f]+|\d+)$/i.exec(line)).find(Boolean);
    if (!failed || failed.programAddress !== mimirProgram || origin?.[1] !== mimirProgram || Number(origin[2]) !== 3) throw failure;
    const supplied = failed.accounts.map((meta) => meta.address);
    const pools = plannedPools.filter((pool) => pool.creation.adapterType === 3 && supplied.includes(pool.pool));
    if (!pools.length) throw failure;
    const cohort = diagnosticCohort ?? rows;
    const keys = [...cohort.keys()].filter((key) => supplied.includes(key));
    // Undefined means a supplied role was not captured; it cannot authorize recovery.
    if (keys.some((key) => cohort.get(key) === undefined)) throw failure;
    const current = await readMimirBetaAccountCohort(rpc, keys, commitment, observedSlot, !!diagnosticCohort).catch(() => { throw failure; });
    if (keys.some((key, i) => {
      const before = cohort.get(key), after = current.value[i];
      // A supplied role prepared as absent has no authenticated envelope; it must remain absent.
      if (!before) return after !== null;
      return !after || after.owner !== before.owner || after.executable !== before.executable || after.data.length !== before.data.length;
    })) throw failure;
    const now = new Map(keys.map((key, i) => [key, current.value[i]]));
    let moved: Address | undefined;
    try {
      for (const pool of pools) {
        const before = rows.get(pool.pool), after = now.get(pool.pool);
        const descriptor = mimirBetaAllCaptureScanDescriptors().find((d) => d.descriptorId === pool.descriptorId && d.descriptorHash === pool.descriptorHash);
        if (!before || !after || !descriptor || pool.programId !== METEORA_DLMM_PROGRAM) throw failure;
        const plan = (primary: MimirBetaAccount) => deriveMimirBetaCaptureReadPlan({ descriptor, primary,
          pair: { baseMint: pool.baseMint, quoteMint: pool.quoteMint }, context: pool.readPlan.context, existingFeed: true });
        const [oracleKey] = await deriveMimirBetaPda({ programId: pool.programId, seed: "oracle", values: [addressBytes(pool.pool)] });
        if (supplied.includes(oracleKey)) {
          for (const image of [rows, now]) {
            const primary = image.get(pool.pool), oracle = image.get(oracleKey);
            const program = image.get(METEORA_DLMM_PROGRAM), programData = image.get(METEORA_DLMM_PROGRAMDATA);
            if (!primary || !oracle || oracle.owner !== pool.programId || oracle.executable || oracle.data.length < 32 ||
                !bytesEqual(primary.data.subarray(552, 584), addressBytes(oracleKey)) ||
                !bytesEqual(oracle.data.subarray(0, 8), Uint8Array.of(139, 194, 131, 179, 140, 179, 229, 244)) ||
                !program || !programData || !verifyDlmmExecutableGeneration(program, programData)) throw failure;
          }
        }
        const oldPlan = plan(before), newPlan = plan(after);
        const statics = (p: MimirBetaCaptureReadPlan) => canonicalJson(p.auxiliary.filter((n) => n.role !== "depth-bin-array") as never);
        if (statics(oldPlan) !== statics(pool.readPlan) || statics(oldPlan) !== statics(newPlan) || !bytesEqual(before.data.subarray(80, 88), after.data.subarray(80, 88))) throw failure;
        const active = (a: MimirBetaAccount) => Math.floor(new DataView(a.data.buffer, a.data.byteOffset).getInt32(76, true) / 70);
        const oldIndex = active(before), newIndex = active(after);
        const indices = (index: number) => pool.creation.bindingVariant === "direct" ? [index] : [index - 1, index, index + 1];
        const oldKeys = await Promise.all(indices(oldIndex).map((index) => mimirDlmmBinArrayAddress(pool, index)));
        const newKeys = await Promise.all(indices(newIndex).map((index) => mimirDlmmBinArrayAddress(pool, index)));
        const vector = [...pool.creation.staticAccounts.map((a) => a.address), ...oldKeys];
        if (!supplied.some((_, i) => vector.every((key, j) => supplied[i + j] === key))) throw failure;
        for (const binding of pool.creation.staticAccounts) {
          const old = rows.get(binding.address), fresh = now.get(binding.address);
          if (!old || !fresh || old.executable || fresh.executable || fresh.owner !== old.owner || fresh.data.length !== old.data.length) throw failure;
          if (binding.role === "pool") {
            if (old.owner !== pool.programId) throw failure;
          } else if (binding.role === "token2022-mint") {
            if (old.owner !== pool.creation.tokenProgramId || !bytesEqual(old.data, fresh.data)) throw failure;
          } else {
            const mint = binding.address === pool.baseVault ? pool.baseMint : pool.quoteMint;
            if (old.owner !== rows.get(mint)?.owner || old.data.length < 165 ||
                (old.owner !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID && old.data.length !== 165) ||
                bytesAddress(old.data.subarray(0, 32)) !== mint || bytesAddress(old.data.subarray(32, 64)) !== pool.creation.vaultAuthority ||
                !bytesEqual(old.data.subarray(0, 64), fresh.data.subarray(0, 64))) throw failure;
            if (old.owner === MIMIR_BETA_TOKEN_2022_PROGRAM_ID) {
              const mintAccount = rows.get(mint)!;
              const { policy } = classifyToken2022Mint({ account: mintAccount, expectedMint: mint,
                expectedDecimals: mintAccount.data[44]!, nowUnix: pool.readPlan.context.observedUnixTimestamp });
              for (const account of [old, fresh]) classifyToken2022Vault({ account, expectedVault: binding.address,
                expectedMint: mint, expectedAuthority: pool.creation.vaultAuthority, mintPolicy: policy });
            }
          }
        }
        const authentic = (a: MimirBetaAccount | null | undefined, key: Address, index: number) => {
          if (!a || a.address !== key || a.owner !== pool.programId || a.executable || a.data.length !== 10_136) throw failure;
          const v = new DataView(a.data.buffer, a.data.byteOffset);
          if (!bytesEqual(a.data.subarray(0, 8), Uint8Array.of(92, 142, 92, 220, 5, 148, 70, 181)) ||
              v.getBigInt64(8, true) !== BigInt(index) || a.data[16]! < 1 || a.data[16]! > 3 ||
              a.data.subarray(17, 24).some((b) => b !== 0) || bytesAddress(a.data.subarray(24, 56)) !== pool.pool) throw failure;
        };
        oldKeys.forEach((key, i) => {
          authentic(rows.get(key), key, indices(oldIndex)[i]!);
          authentic(now.get(key), key, indices(oldIndex)[i]!);
        });
        if (oldIndex === newIndex || oldKeys.every((key, i) => key === newKeys[i])) continue;
        const closure = await readMimirBetaAccountCohort(rpc, [pool.pool, ...newKeys], commitment, current.slot);
        const latest = closure.value[0];
        if (!latest || active(latest) !== newIndex || statics(plan(latest)) !== statics(newPlan) ||
            !bytesEqual(after.data.subarray(80, 88), latest.data.subarray(80, 88))) throw failure;
        newKeys.forEach((key, i) => authentic(closure.value[i + 1], key, indices(newIndex)[i]!));
        moved = pool.pool;
      }
    } catch { throw failure; }
    if (!moved) throw failure;
    throw new MimirBetaStalePreparationError({ reason: "source-drift", address: moved, observedSlot, currentSlot: current.slot,
      observedUnixTimestamp: null, currentUnixTimestamp: null });
  }
  if (failure.customCode === 46) {
    const clmm = new Set(mimirBetaAllCaptureScanDescriptors().filter((d) => d.family === "raydium-clmm").map((d) => d.programId as string));
    const pools = [...rows.keys()].filter((entry) => relevant.has(entry) && clmm.has(rows.get(entry)!.owner) && rows.get(entry)!.data.length === 1544);
    if (!pools.length) throw failure;
    const now = await readMimirBetaAccountCohort(rpc, pools, commitment, observedSlot);
    const start = (data: Uint8Array) => { const v = new DataView(data.buffer, data.byteOffset, data.length); return Math.floor(v.getInt32(269, true) / (v.getUint16(235, true) * 60)); };
    const moved = pools.findIndex((entry, index) => { const before = rows.get(entry)!, after = now.value[index];
      return !!after && after.owner === before.owner && after.data.length === 1544 && start(after.data) !== start(before.data); });
    if (moved < 0) throw failure;
    throw new MimirBetaStalePreparationError({ reason: "source-drift", address: pools[moved]!, observedSlot, currentSlot: now.slot,
      observedUnixTimestamp: null, currentUnixTimestamp: null });
  }
  const addresses = [...rows.keys()].filter((entry) => entry !== MIMIR_NATIVE_CLOCK_ADDRESS && relevant.has(entry) &&
    (rows.get(entry)!.owner === mimirProgram) === (failure.customCode === 56));
  const current = await readMimirBetaAccountCohort(rpc, [...addresses, MIMIR_NATIVE_CLOCK_ADDRESS], commitment, observedSlot);
  const clock = current.value.at(-1);
  const clockView = clock && clock.data.length === 40 ? new DataView(clock.data.buffer, clock.data.byteOffset, 40) : null;
  if (!clock || !clockView || clock.owner !== "Sysvar1111111111111111111111111111111111111" || clock.executable ||
      clockView.getBigUint64(0, true) !== current.slot || clockView.getBigInt64(32, true) < 0n) {
    betaError("RPC_CONTEXT_MISMATCH", "drift reread Clock is not authentic");
  }
  if (current.slot <= observedSlot) throw failure;
  const unixTimestamp = (account: MimirBetaAccount | null | undefined) => account && account.data.length === 40
    ? new DataView(account.data.buffer, account.data.byteOffset, 40).getBigInt64(32, true) : null;
  const changed = addresses.findIndex((entry, index) => !bytesEqual(current.value[index]?.data ?? rows.get(entry)!.data, rows.get(entry)!.data));
  if (changed < 0 || addresses.some((entry, index) => {
    const before = rows.get(entry)!, after = current.value[index];
    return !after || after.owner !== before.owner || after.executable !== before.executable || after.data.length !== before.data.length;
  })) throw failure;
  throw new MimirBetaStalePreparationError({ reason: failure.customCode === 56 ? "context-drift" : "source-drift",
    address: addresses[changed]!, observedSlot, currentSlot: current.slot,
    observedUnixTimestamp: unixTimestamp(rows.get(MIMIR_NATIVE_CLOCK_ADDRESS)), currentUnixTimestamp: clockView.getBigInt64(32, true) });
}

export async function simulateExactPostAccounts(rpc: MimirBetaPlanningRpc, wire: Uint8Array, minContextSlot: bigint,
  expectedProgram: Address, addresses: readonly Address[], commitment: "confirmed" | "finalized"):
  Promise<{ simulation: MimirBetaSimulationFacts; accounts: readonly MimirBetaAccount[]; outsideSimulation: ReadonlySet<Address> }> {
  const staticAccounts = getCompiledTransactionMessageDecoder().decode(wire).staticAccounts;
  const messageKeys = new Set<Address>([...staticAccounts, MIMIR_NATIVE_CLOCK_ADDRESS]);
  const unique = [...new Set(addresses)].filter((entry) => !MIMIR_BETA_HEADER_ONLY_PROGRAM_DATA.has(entry));
  const required = unique.filter((entry) => messageKeys.has(entry));
  if (required.length > staticAccounts.length) {
    betaError("SIMULATION_FAILED", "simulation post-account request exceeds message account-key count");
  }
  const optional = unique.filter((entry) => !messageKeys.has(entry));
  const simulatedAddresses = [...required, ...optional.slice(0, staticAccounts.length - required.length)];
  const readAddresses = [...optional.slice(staticAccounts.length - required.length),
    ...new Set(addresses.filter((entry) => MIMIR_BETA_HEADER_ONLY_PROGRAM_DATA.has(entry)))];
  const response = await rpc.simulateTransaction(base64(wire), { commitment, encoding: "base64", sigVerify: false,
    replaceRecentBlockhash: false, minContextSlot, accounts: { addresses: simulatedAddresses, encoding: "base64" } }).send();
  if (!response || typeof response !== "object") betaError("SIMULATION_FAILED", "mono simulation response malformed");
  const record = response as Record<string, unknown>; const context = record.context as Record<string, unknown> | undefined;
  const value = record.value as Record<string, unknown> | undefined; const rawSlot = context?.slot;
  const contextSlot = typeof rawSlot === "bigint" ? rawSlot : typeof rawSlot === "number" && Number.isSafeInteger(rawSlot) ? BigInt(rawSlot) : -1n;
  if (value && contextSlot >= minContextSlot && value.err !== null && value.err !== undefined) {
    throw new MimirBetaSimulationError(mimirBetaSimulationFailure(value.err, value.logs, expectedProgram));
  }
  if (!value || contextSlot < minContextSlot || value.err !== null || !Array.isArray(value.accounts) || value.accounts.length !== simulatedAddresses.length) {
    betaError("SIMULATION_FAILED", "exact mono simulation or post-accounts failed");
  }
  const byAddress = new Map<Address, MimirBetaAccount | null>(simulatedAddresses.map((entry, index) =>
    [entry, decodeMimirBetaRpcAccount(entry, (value.accounts as unknown[])[index])]));
  if (readAddresses.length) {
    const read = await readMimirBetaAccountCohort(rpc, readAddresses, commitment, contextSlot);
    readAddresses.forEach((entry, index) => byAddress.set(entry, read.value[index]!));
  }
  const accounts = addresses.map((entry) => byAddress.get(entry) ??
    betaError("SIMULATION_FAILED", "mono simulation omitted a post-account", entry));
  const logs = Array.isArray(value.logs) && value.logs.every((entry) => typeof entry === "string") ? value.logs as string[] : [];
  let returnDataHash: string | null = null;
  if (value.returnData !== null && value.returnData !== undefined) {
    const returned = value.returnData as Record<string, unknown>; const data = returned.data;
    if (returned.programId !== expectedProgram || !Array.isArray(data) || data.length !== 2 || data[1] !== "base64" || typeof data[0] !== "string") {
      betaError("SIMULATION_FAILED", "mono simulation return data malformed");
    }
    returnDataHash = hex(await sha256(fromBase64(data[0])));
  }
  const units = value.unitsConsumed;
  const unitsConsumed = units === undefined || units === null ? null : typeof units === "bigint" && units >= 0n ? units :
    typeof units === "number" && Number.isSafeInteger(units) && units >= 0 ? BigInt(units) :
      betaError("SIMULATION_FAILED", "mono simulation units malformed");
  return { simulation: { status: "succeeded", contextSlot, unitsConsumed,
    logsHash: hex(await sha256(utf8(canonicalJson(logs as never)))), returnDataHash, error: null }, accounts,
    outsideSimulation: new Set(readAddresses) };
}

function exactProgramAccount(account: MimirBetaAccount | null | undefined,
  expectedOwner: Address, expectedLength: number | readonly number[], label: string) {
  const lengthMatches = account && (typeof expectedLength === "number"
    ? account.data.length === expectedLength : expectedLength.includes(account.data.length));
  if (!account || account.owner !== expectedOwner || account.executable || !lengthMatches) {
    betaError("ACCOUNT_MALFORMED", `${label} account envelope mismatch`, account?.address);
  }
  return account;
}

/** Rebinds a frozen capture plan to a current Clock cohort; the authenticated closure must be unchanged. */
/** An Orca pool rediscovered for an existing feed: its plan carries no CREATE-only adaptive Oracle witness. */
const mimirExistingFeedPlan = (pool: MimirBetaEligiblePool) => pool.creation.adapterType === 0 &&
  !pool.readPlan.auxiliary.some((node) => node.role === "orca-oracle");

function currentCaptureReadPlan(pool: MimirBetaEligiblePool, descriptor: MimirBetaCaptureScanDescriptor,
  primary: MimirBetaAccount | null | undefined, context: MimirBetaCaptureReadPlan["context"]): MimirBetaCaptureReadPlan {
  if (!primary) betaError("PLAN_STALE", "live-refresh pool is missing", pool.pool);
  const readPlan = deriveMimirBetaCaptureReadPlan({ descriptor, primary,
    pair: { baseMint: pool.baseMint, quoteMint: pool.quoteMint }, context, existingFeed: mimirExistingFeedPlan(pool) });
  const closure = (plan: typeof readPlan) => canonicalJson({ all: [...plan.allAddresses],
    auxiliary: plan.auxiliary.map((node) => [node.address, node.role, node.index]) } as never);
  if (closure(readPlan) !== closure(pool.readPlan)) {
    if (context.observedSlot <= pool.readPlan.context.observedSlot || readPlan.primaryDataSha256 === pool.readPlan.primaryDataSha256) betaError("PLAN_STALE", "live-refresh capture closure changed", pool.pool);
    throw new MimirBetaStalePreparationError({ reason: "source-drift", address: pool.pool,
      observedSlot: pool.readPlan.context.observedSlot, currentSlot: context.observedSlot,
      observedUnixTimestamp: pool.readPlan.context.observedUnixTimestamp, currentUnixTimestamp: context.observedUnixTimestamp });
  }
  return readPlan;
}

/** @internal Authenticates the current capture-plan closure and returns its ordered refresh-only accounts. */
export async function freshDynamicAccounts(pool: MimirBetaEligiblePool, rows: ReadonlyMap<Address, MimirBetaAccount | null>,
  captureAlreadyRevalidated = false, context?: MimirBetaCaptureReadPlan["context"]): Promise<readonly Address[]> {
  if (pool.creation.adapterType !== 0 && pool.creation.adapterType !== 1 && pool.creation.adapterType !== 3) return [];
  const directPrimary = pool.creation.adapterType === 3 && pool.creation.bindingVariant === "direct" ? rows.get(pool.pool) : null;
  const directActiveIndex = directPrimary && directPrimary.data.length >= 80
    ? Math.floor(new DataView(directPrimary.data.buffer, directPrimary.data.byteOffset).getInt32(76, true) / 70).toString() : null;
  const sparse = (node: MimirBetaCaptureReadPlan["auxiliary"][number]) => pool.creation.adapterType === 3
    ? directActiveIndex !== null && node.role === "depth-bin-array" && node.index !== directActiveIndex
    : node.role.startsWith("tick-array-");
  const captureRows = pool.readPlan.allAddresses.map((entry) => {
    const account = rows.get(entry);
    if (account === undefined || (account === null && !pool.readPlan.auxiliary.some((node) => node.address === entry && sparse(node)))) {
      betaError("PLAN_STALE", "dynamic account missing", entry);
    }
    return account;
  });
  if (!captureAlreadyRevalidated || captureRows.some((account) => account === null)) {
    const descriptors = mimirBetaAllCaptureScanDescriptors().filter((entry) =>
      entry.descriptorId === pool.descriptorId && entry.descriptorHash === pool.descriptorHash);
    if (descriptors.length !== 1) betaError("PLAN_STALE", "live-refresh capture descriptor is no longer exact", pool.pool);
    const plan = context ? currentCaptureReadPlan(pool, descriptors[0]!, rows.get(pool.pool), context) : pool.readPlan;
    await decodeMimirBetaCaptureCandidate({ descriptor: descriptors[0]!, pair: { baseMint: pool.baseMint, quoteMint: pool.quoteMint },
      context: plan.context, expectedPlan: plan, existingFeed: mimirExistingFeedPlan(pool),
      accounts: captureRows.map((account, index) => account ?? decodeMimirBetaCaptureRpcAccount(pool.readPlan.allAddresses[index]!, null)) });
  }
  const role = (name: string, index?: string): Address => {
    const matches = pool.readPlan.auxiliary.filter((entry) => entry.role === name && (index === undefined || entry.index === index));
    if (matches.length !== 1) betaError("PLAN_STALE", "dynamic account role is not exact", pool.pool);
    return matches[0]!.address;
  };
  const dynamic = pool.creation.adapterType === 0 || pool.creation.adapterType === 1
    ? [role("tick-array-lower"), role("tick-array-active"), role("tick-array-upper")]
    : (() => {
      const primary = rows.get(pool.pool) ?? betaError("PLAN_STALE", "current DLMM pool is missing", pool.pool);
      const activeIndex = Math.floor(new DataView(primary.data.buffer, primary.data.byteOffset).getInt32(76, true) / 70);
      return pool.creation.bindingVariant === "direct" ? [role("depth-bin-array", activeIndex.toString())] :
        Promise.all([-1, 0, 1].map(async (offset) => {
          const index = activeIndex + offset;
          if (pool.readPlan.auxiliary.some((entry) => entry.role === "depth-bin-array" && entry.index === index.toString())) return role("depth-bin-array", index.toString());
          const edge = await mimirDlmmBinArrayAddress(pool, index);
          const account = rows.get(edge);
          if (!account || account.owner !== pool.programId || account.executable) betaError("PLAN_STALE", "routeable DLMM neighbor bin array is missing", edge);
          return edge;
        }));
    })();
  const resolved = await dynamic;
  const accounts = [...pool.creation.staticAccounts.map((entry) => entry.address), ...resolved];
  if (new Set(accounts).size !== accounts.length) betaError("PLAN_STALE", "dynamic adapter account closure contains duplicates", pool.pool);
  return resolved;
}

const mimirDlmmBinArrayAddress = async (pool: MimirBetaEligiblePool, index: number) => {
  const le = new Uint8Array(8); new DataView(le.buffer).setBigInt64(0, BigInt(index), true);
  return (await deriveMimirBetaPda({ programId: pool.programId, seed: "bin_array", values: [addressBytes(pool.pool), le] }))[0];
};

/**
 * @internal DLMM compact-point preflight before payment (program `observe_meteora_dlmm(…, Point)`): enabled and activated pair,
 * two-sided active bin, exact point window depth, per-bin 50 bps guard, vault state, and `F_point` carrying a non-zero econ floor.
 * A sealed floor (`sealedFloor`) must lie in `[ceil(10^6/fee), D50_point]`.
 */
export async function mimirDlmmPointPreflight(pool: MimirBetaEligiblePool, rows: ReadonlyMap<Address, MimirBetaAccount | null>,
  slot: bigint, nowUnix: bigint, sealedFloor?: bigint, depthFloorBps = 900): Promise<bigint> {
  const refuse = (reason: MimirBetaDlmmPointError["reason"], message: string): never => { throw new MimirBetaDlmmPointError(reason, message, pool.pool); };
  const pair = exactProgramAccount(rows.get(pool.pool), METEORA_DLMM_PROGRAM, 904, "DLMM pool").data; const v = new DataView(pair.buffer, pair.byteOffset, 904);
  if (pair[82] !== 0) refuse("disabled", "DLMM pair is disabled");
  if (pair[86]! > 1 || v.getBigUint64(816, true) > (pair[86] === 0 ? slot : nowUnix)) refuse("not-activated", "DLMM pair is not activated");
  const active = v.getInt32(76, true); const binStep = v.getUint16(80, true);
  const arrayAddress = await mimirDlmmBinArrayAddress(pool, Math.floor(active / 70));
  const array = exactProgramAccount(rows.get(arrayAddress) ?? betaError("PLAN_STALE", "DLMM active bin array moved; refresh the selection", arrayAddress),
    pool.programId, 10_136, "DLMM bin array");
  const vault = (a: Address) => rows.get(a) ?? betaError("CREATION_CONTEXT_REQUIRED", "DLMM vault missing", a);
  const [base, quote] = [vault(pool.baseVault), vault(pool.quoteVault)];
  if (base.data[108] === 2 || quote.data[108] === 2) refuse("vault-frozen", "DLMM vault is frozen");
  const decimals = (mint: Address) => (rows.get(mint) ?? betaError("CREATION_CONTEXT_REQUIRED", "mint missing", mint)).data[44]!;
  const t22 = pool.token2022Mint;
  const tokenXIsBase = bytesAddress(pair.subarray(88, 120)) === pool.baseMint;
  const amount = (a: MimirBetaAccount) => new DataView(a.data.buffer, a.data.byteOffset).getBigUint64(64, true);
  const r = meteoraDlmmPointDepth({ activeArray: array.data, active, binStep, tokenXIsBase, baseDecimals: decimals(pool.baseMint), quoteDecimals: decimals(pool.quoteMint),
    token2022: t22 ? { selectedBase: t22 === pool.baseMint, multiplierQ64: classifyToken2022Mint({ account: rows.get(t22)!, expectedMint: t22,
      expectedDecimals: decimals(t22), nowUnix }).multiplierQ64 ?? 1n << 64n } : null, baseReserve: amount(base), quoteReserve: amount(quote) });
  if (!r.twoSided) refuse("one-sided", "DLMM active bin is not two-sided");
  if (r.depth === 0n || r.liquidity === 0n) refuse("zero-depth", "DLMM point window has no depth");
  if (!r.guardOk) refuse("window-guard", "DLMM rounded prices cross 50 bps inside the point window");
  const [reserveX, reserveY] = tokenXIsBase ? [amount(base), amount(quote)] : [amount(quote), amount(base)];
  if (reserveX < r.sumX || reserveY < r.sumY) refuse("vault-shortfall", "DLMM vaults do not cover the point window");
  const fee = meteoraDlmmFeeRatePpm(pair);
  if (sealedFloor !== undefined && (sealedFloor < meteoraDlmmPointEconFloor(fee) || sealedFloor > r.depth)) {
    refuse("econ-floor", "the feed's sealed depth floor does not fit the DLMM point window");
  }
  return sealedFloor ?? meteoraDlmmPointFloor(r.depth, fee, depthFloorBps) ?? refuse("econ-floor", "DLMM point depth cannot carry a non-zero fee floor");
}

/**
 * DLMM bin arrays just outside the capture plan's depth window, so a routeable `active ± 1` vector is always in the coherent read.
 * With `activeId`, exactly the canonical arrays `floor(activeId/70) + offset` for the requested `offsets` (direct on-demand neighbours).
 */
export async function mimirDlmmRouteableEdgeArrays(pool: MimirBetaEligiblePool, activeId?: number,
  offsets: readonly (-1 | 1)[] = [-1, 1]): Promise<readonly Address[]> {
  if (pool.creation.adapterType !== 3) return [];
  if (activeId !== undefined) return Promise.all(offsets.map((offset) => mimirDlmmBinArrayAddress(pool, Math.floor(activeId / 70) + offset)));
  const indices = pool.readPlan.auxiliary.filter((entry) => entry.role === "depth-bin-array").map((entry) => Number(entry.index));
  if (indices.length === 0) return [];
  return Promise.all([Math.min(...indices) - 1, Math.max(...indices) + 1].map((index) => mimirDlmmBinArrayAddress(pool, index)));
}

/** Never-swapped Raydium CPMM Observation: `initialized = 0`, index 0, empty history (the pool id is checked by the caller). */
const mimirCpmmObservationCanonicalEmpty = (d: Uint8Array) => d[8] === 0 && d[9] === 0 && d[10] === 0 && !d.subarray(43).some(Boolean);

/** @internal Exact authenticated adapter tail shared by creation and ordinary live refresh. */
export async function freshAdapterAccounts(pool: MimirBetaEligiblePool,
  rows: ReadonlyMap<Address, MimirBetaAccount | null>, captureAlreadyRevalidated = false, context?: MimirBetaCaptureReadPlan["context"]): Promise<readonly Address[]> {
  const dynamic = await freshDynamicAccounts(pool, rows, captureAlreadyRevalidated, context);
  if (pool.creation.adapterType === 2) {
    const observationAddress = pool.creation.observationState ??
      betaError("PROGRAM_ABI_MISMATCH", "CPMM observation binding is missing", pool.pool);
    const observation = exactProgramAccount(rows.get(observationAddress), pool.programId, 4_075, "CPMM observation");
    const [expectedObservation] = await deriveMimirBetaPda({ programId: pool.programId, seed: "observation",
      values: [addressBytes(pool.pool)] });
    if (observationAddress !== expectedObservation ||
        !bytesEqual(observation.data.subarray(0, 8), Uint8Array.of(122, 174, 197, 53, 129, 9, 165, 132)) ||
        (observation.data[8] === 0 && !mimirCpmmObservationCanonicalEmpty(observation.data)) || new DataView(observation.data.buffer, observation.data.byteOffset).getUint16(9, true) >= 100 ||
        !bytesEqual(observation.data.subarray(11, 43), addressBytes(pool.pool))) {
      betaError("PLAN_STALE", "CPMM observation identity changed", observationAddress);
    }
    return [...pool.creation.staticAccounts.map((entry) => entry.address), observationAddress];
  }
  return [...pool.creation.staticAccounts.map((entry) => entry.address), ...dynamic];
}

/** @internal Authenticated, coherent existing-feed closure shared by refresh and creation. */
export async function loadMimirBetaExistingLiveFeed(dependencies: MimirBetaLiveDependencies,
  inputPools: readonly MimirBetaEligiblePool[], monoSourceIndex?: number, includeSnapshot = false,
  commitment: "confirmed" | "finalized" = "finalized",
  proofRequirement?: "damm-onlyb-interval-v1" | "cpmm-quiet-interval-v2" | "mixed-bounded-v1", nativeSourceMode: boolean | Promise<boolean> = false,
  explicitFeedId?: Address, strongOnlyB = false, extraAddresses: readonly Address[] = [], capturedSlot?: bigint) {
  if (!Array.isArray(inputPools) || inputPools.length < 1 || inputPools.length > 5 ||
      monoSourceIndex !== undefined && (!Number.isSafeInteger(monoSourceIndex) || monoSourceIndex < 0 || monoSourceIndex >= inputPools.length)) {
    betaError("INVALID_ARGUMENT", "existing live-feed pool bounds are invalid");
  }
  const minimum = inputPools.reduce((slot, pool) => pool.observedSlot > slot ? pool.observedSlot : slot, 0n);
  const revalidated: Readonly<{ slot: bigint; freshPools: readonly MimirBetaEligiblePool[] }> = capturedSlot !== undefined && capturedSlot >= minimum
    ? { slot: capturedSlot, freshPools: inputPools } : await dependencies.discovery.revalidateSelectedPools({ pools: inputPools, minContextSlot: minimum });
  const nativeSourceSet = await nativeSourceMode;
  let pools = revalidated.freshPools;
  const capturedConditions = pools.map(mimirBetaEligiblePoolConditions);
  const belowFloor = new Set<number>();
  if (pools.length !== inputPools.length) betaError("PLAN_STALE", "revalidated pool count changed");
  const first = pools[0]!;
  const feedId = explicitFeedId ?? await deriveMimirBetaClassicFeedId(first.baseMint, first.quoteMint);
  const pdas = await deriveMimirBetaFeedPdas({ programId: dependencies.deployment.mimirProgramId, feedId });
  const canonical = await deriveMimirBetaCanonicalPdas(dependencies.deployment.mimirProgramId);
  const sourcePdas = await Promise.all(pools.map(async (_, index) => ({
    sourceConfig: await deriveMimirBetaPda({ programId: dependencies.deployment.mimirProgramId,
      seed: "source_config", values: [addressBytes(feedId), Uint8Array.of(index)] }),
    sourceRing: await deriveMimirBetaPda({ programId: dependencies.deployment.mimirProgramId,
      seed: "source_ring", values: [addressBytes(feedId), Uint8Array.of(index), Uint8Array.of(1, 0)] }),
  })));
  const generationCluster: MimirGenerationCluster = dependencies.deployment.cluster === "mainnet-beta" ? "mainnet" : dependencies.deployment.cluster;
  const [RAYDIUM_CPMM_PROGRAM, RAYDIUM_CPMM_PROGRAMDATA] = mimirExecutableGenerationPins(generationCluster).cpmm;
  const onlyBTemporalRequested = monoSourceIndex !== undefined &&
    pools[monoSourceIndex]!.creation.adapterType === MIMIR_METEORA_DAMM_V2_ADAPTER_TYPE;
  const cpmmQuietTemporalRequested = proofRequirement === "cpmm-quiet-interval-v2" && monoSourceIndex !== undefined &&
    pools[monoSourceIndex]!.creation.adapterType === 2;
  if (proofRequirement === "damm-onlyb-interval-v1" && !onlyBTemporalRequested ||
      proofRequirement === "cpmm-quiet-interval-v2" && !cpmmQuietTemporalRequested) {
    betaError("INVALID_ARGUMENT", "temporal proof requirement does not match the selected adapter");
  }
  const temporalModulePda = onlyBTemporalRequested || cpmmQuietTemporalRequested
    ? await deriveMimirBetaPda({ programId: dependencies.deployment.mimirProgramId, seed: "source_temporal",
      values: [addressBytes(feedId), Uint8Array.of(monoSourceIndex!), Uint8Array.of(cpmmQuietTemporalRequested ? 2 : 1, 0)] })
    : undefined;
  const mixedTemporalCandidates = proofRequirement === "mixed-bounded-v1" ? await Promise.all(pools.map(async (pool, index) => {
    if (pool.creation.adapterType === 7 && pool.creation.adapterVersion !== 0)
      betaError("PROGRAM_ABI_MISMATCH", "DAMM temporal proof requires classic SPL adapterV0", pool.pool);
    if ((pool.creation.adapterType === 4 || pool.creation.adapterType === 6) && (pool.creation.adapterVersion === 0 || pool.creation.adapterType === 6)) {
      const sampled = mimirSampledSourceAdapters(generationCluster)[pool.creation.adapterType];
      return { module: await deriveMimirBetaPda({ programId: dependencies.deployment.mimirProgramId, seed: "source_temporal",
        values: [addressBytes(feedId), Uint8Array.of(index), Uint8Array.of(4, 0)] }), reserveModule: undefined, version: 4,
        sourceProgram: sampled.program as Address, sourceProgramData: sampled.programData as Address };
    }
    if (pool.creation.adapterVersion !== 0 || (pool.creation.adapterType !== 2 && pool.creation.adapterType !== 7)) return undefined;
    const cpmm = pool.creation.adapterType === 2;
    const module = await deriveMimirBetaPda({ programId: dependencies.deployment.mimirProgramId, seed: "source_temporal",
      values: [addressBytes(feedId), Uint8Array.of(index), Uint8Array.of(cpmm ? 2 : 1, 0)] });
    const reserveModule = cpmm ? undefined : await deriveMimirBetaPda({ programId: dependencies.deployment.mimirProgramId,
      seed: "source_temporal", values: [addressBytes(feedId), Uint8Array.of(index), Uint8Array.of(3, 0)] });
    return { module, reserveModule, version: cpmm ? 2 : 1, sourceProgram: cpmm ? RAYDIUM_CPMM_PROGRAM : METEORA_DAMM_V2_PROGRAM,
      sourceProgramData: cpmm ? RAYDIUM_CPMM_PROGRAMDATA : METEORA_DAMM_V2_PROGRAMDATA };
  })) : pools.map(() => undefined);
  // Kind-7 marker tail roles; optional so an absent generation leaves the source UNKNOWN.
  const mixedMarker = pools.map(pool => proofRequirement === "mixed-bounded-v1" && pool.creation.adapterType === 0 &&
    pool.creation.adapterVersion === 0 ? { sourceProgram: ORCA_WHIRLPOOL_PROGRAM, sourceProgramData: ORCA_WHIRLPOOL_PROGRAMDATA } : undefined);
  const mixedMarkerAddresses = mixedMarker.some(Boolean) ? [ORCA_WHIRLPOOL_PROGRAM, ORCA_WHIRLPOOL_PROGRAMDATA] : [];
  const mixedDlmmAddresses = proofRequirement === "mixed-bounded-v1" && pools.some(pool => pool.creation.adapterType === 3)
    ? [METEORA_DLMM_PROGRAM, METEORA_DLMM_PROGRAMDATA] : [];
  const mixedTemporalAddresses = mixedTemporalCandidates.flatMap(entry => entry ? [entry.module[0], ...(entry.reserveModule ? [entry.reserveModule[0]] : []), entry.sourceProgram, entry.sourceProgramData] : []);
  const staticAddresses = pools.flatMap((pool) => pool.creation.staticAccounts.map((entry) => entry.address));
  const physicalAddresses = [...new Set([...staticAddresses, first.baseMint, first.quoteMint])];
  const observations = await Promise.all(pools.map(async (pool, index) => pool.creation.adapterType === 2
    ? pool.creation.observationState ?? betaError("PROGRAM_ABI_MISMATCH", "CPMM observation binding is missing", pool.pool)
    : (nativeSourceSet || monoSourceIndex === index) && pool.creation.adapterType === 3
      ? (await deriveMimirBetaPda({ programId: METEORA_DLMM_PROGRAM, seed: "oracle", values: [addressBytes(pool.pool)] }))[0]
      : (nativeSourceSet || monoSourceIndex === index) && pool.creation.adapterType === 1
        ? pool.readPlan.auxiliary.find((entry) => entry.role === "clmm-observation")?.address ??
          betaError("PROGRAM_ABI_MISMATCH", "CLMM observation binding is missing", pool.pool)
      : null));
  const dynamicAddresses = pools.flatMap((pool) => pool.creation.adapterType === 0 || pool.creation.adapterType === 1 || pool.creation.adapterType === 3
    ? pool.readPlan.allAddresses : []);
  const requiredAddresses = new Set<Address>([canonical.registry[0], pdas.feed[0], pdas.sourcingPlan[0],
    ...(includeSnapshot || monoSourceIndex !== undefined ? [pdas.snapshot[0]] : []),
    ...sourcePdas.map((entry) => entry.sourceConfig[0]), ...physicalAddresses,
    ...observations.filter((entry): entry is Address => entry !== null),
    ...(onlyBTemporalRequested ? [METEORA_DAMM_V2_PROGRAM, METEORA_DAMM_V2_PROGRAMDATA] : []),
    ...(cpmmQuietTemporalRequested ? [RAYDIUM_CPMM_PROGRAM, RAYDIUM_CPMM_PROGRAMDATA] : []),
    ...mixedTemporalCandidates.flatMap(entry => entry ? [entry.sourceProgram, entry.sourceProgramData] : []), ...mixedDlmmAddresses,
    ...(proofRequirement === "mixed-bounded-v1" || dynamicAddresses.length > 0 ? [MIMIR_NATIVE_CLOCK_ADDRESS] : []), ...extraAddresses]);
  const dynamicAddressSet = new Set(dynamicAddresses);
  const routeableEdges = (await Promise.all(pools.map((pool) => mimirDlmmRouteableEdgeArrays(pool)))).flat().filter((entry) => !dynamicAddressSet.has(entry));
  const witnessPda = strongOnlyB && onlyBTemporalRequested
    ? await deriveMimirBetaPda({ programId: dependencies.deployment.mimirProgramId, seed: "onlyb_witness", values: [addressBytes(feedId)] })
    : undefined;
  const optionalAddressSet = new Set([...(temporalModulePda === undefined ? [] : [temporalModulePda[0]]), ...mixedMarkerAddresses, ...routeableEdges,
    ...(witnessPda === undefined ? [] : [witnessPda[0]]), ...sourcePdas.map((entry) => entry.sourceRing[0])]);
  mixedTemporalCandidates.forEach(entry => { if (entry) { optionalAddressSet.add(entry.module[0]);
    if (entry.reserveModule) optionalAddressSet.add(entry.reserveModule[0]); } });
  const addresses = [...new Set<Address>([canonical.registry[0], pdas.feed[0], pdas.sourcingPlan[0],
    ...(includeSnapshot || monoSourceIndex !== undefined ? [pdas.snapshot[0]] : []),
    ...sourcePdas.flatMap((entry) => [entry.sourceConfig[0], entry.sourceRing[0]]), ...physicalAddresses,
    ...observations.filter((entry): entry is Address => entry !== null), ...dynamicAddresses,
    ...(temporalModulePda === undefined ? [] : [temporalModulePda[0],
      ...(cpmmQuietTemporalRequested ? [RAYDIUM_CPMM_PROGRAM, RAYDIUM_CPMM_PROGRAMDATA] :
        [METEORA_DAMM_V2_PROGRAM, METEORA_DAMM_V2_PROGRAMDATA])]), ...(witnessPda === undefined ? [] : [witnessPda[0]]),
    ...mixedTemporalAddresses, ...mixedMarkerAddresses, ...mixedDlmmAddresses, ...routeableEdges,
    ...(proofRequirement === "mixed-bounded-v1" || dynamicAddresses.length > 0 || witnessPda !== undefined ? [MIMIR_NATIVE_CLOCK_ADDRESS] : []), ...extraAddresses])];
  const coherent = await readMimirBetaAccountCohort(dependencies.rpc, addresses, commitment, revalidated.slot);
  for (const [index, pool] of pools.entries()) {
    const oracle = observations[index];
    if (pool.creation.adapterType === 3 && oracle && !coherent.value[addresses.indexOf(oracle)]) {
      throw new MimirNativeObservationUnavailableError(addressBytes(feedId), index, "meteora-dlmm", "missing-oracle",
        { latestUnixTs: null, olderUnixTs: null, currentUnixTs: null });
    }
  }
  const rows = new Map<Address, MimirBetaAccount>();
  const captureRows = new Map<Address, MimirBetaAccount | null>();
  coherent.value.forEach((account, index) => {
    const accountAddress = addresses[index]!;
    captureRows.set(accountAddress, account);
    if (!account) {
      if (accountAddress === MIMIR_NATIVE_CLOCK_ADDRESS) {
        betaError("RPC_CONTEXT_MISMATCH", "live-refresh cohort Clock is missing", accountAddress);
      }
      if ((!dynamicAddressSet.has(accountAddress) && !optionalAddressSet.has(accountAddress)) || requiredAddresses.has(accountAddress)) {
        betaError("PLAN_STALE", "live-refresh account is missing", accountAddress);
      }
      return;
    }
    rows.set(accountAddress, account);
  });
  if (dynamicAddresses.length > 0 || witnessPda !== undefined) {
    const context = { observedSlot: coherent.slot,
      observedUnixTimestamp: mimirAuthenticClockUnix(rows.get(MIMIR_NATIVE_CLOCK_ADDRESS), coherent.slot, "live-refresh cohort Clock is not authentic") };
    pools = pools.map((pool) => {
      if (pool.creation.adapterType !== 0 && pool.creation.adapterType !== 1 && pool.creation.adapterType !== 3) return pool;
      const descriptors = mimirBetaAllCaptureScanDescriptors().filter((entry) =>
        entry.descriptorId === pool.descriptorId && entry.descriptorHash === pool.descriptorHash);
      if (descriptors.length !== 1) betaError("PLAN_STALE", "live-refresh capture descriptor is no longer exact", pool.pool);
      return { ...pool, readPlan: currentCaptureReadPlan(pool, descriptors[0]!, rows.get(pool.pool), context) };
    });
  }
  if (monoSourceIndex !== undefined && pools[monoSourceIndex]!.creation.adapterType === 3) {
    const selected = pools[monoSourceIndex]!; const observation = observations[monoSourceIndex]!;
    const pool = exactProgramAccount(rows.get(selected.pool), METEORA_DLMM_PROGRAM, 904, "DLMM pool");
    const oracle = rows.get(observation);
    if (!oracle || oracle.owner !== METEORA_DLMM_PROGRAM || oracle.executable || oracle.data.length < 32 ||
        !bytesEqual(pool.data.subarray(0, 8), Uint8Array.of(33, 11, 49, 98, 181, 101, 177, 13)) ||
        !bytesEqual(pool.data.subarray(552, 584), addressBytes(observation)) ||
        !bytesEqual(oracle.data.subarray(0, 8), Uint8Array.of(139, 194, 131, 179, 140, 179, 229, 244))) {
      betaError("PLAN_STALE", "DLMM pool/oracle identity changed", observation);
    }
  }
  if (monoSourceIndex !== undefined && pools[monoSourceIndex]!.creation.adapterType === 1) {
    const selected = pools[monoSourceIndex]!; const observation = observations[monoSourceIndex]!;
    const pool = exactProgramAccount(rows.get(selected.pool), selected.programId, 1_544, "CLMM pool");
    const oracle = rows.get(observation);
    if (!oracle || oracle.owner !== selected.programId || oracle.executable || oracle.data.length !== 4_483 ||
        !bytesEqual(pool.data.subarray(0, 8), Uint8Array.of(247, 237, 227, 245, 215, 195, 222, 70)) ||
        !bytesEqual(pool.data.subarray(201, 233), addressBytes(observation)) ||
        !bytesEqual(oracle.data.subarray(0, 8), Uint8Array.of(122, 174, 197, 53, 129, 9, 165, 132)) ||
        !bytesEqual(oracle.data.subarray(19, 51), addressBytes(selected.pool))) {
      betaError("PLAN_STALE", "CLMM pool/oracle identity changed", observation);
    }
  }
  const program = dependencies.deployment.mimirProgramId;
  const registryAccount = exactProgramAccount(rows.get(canonical.registry[0]), program, 128, "registry");
  const registry = await decodeMimirBetaRegistryContext(canonical.registry[0], registryAccount.data);
  if (registry.bump !== canonical.registry[1] || registry.status !== 0 || registry.registryEpoch === 0n ||
      registry.emergencyAuthority !== null || registry.supportedAdapterMask === 0n ||
      (registry.supportedAdapterMask & ~0xdfn) !== 0n || registry.minFeedConfigVersion > 1 ||
      registry.supportedAdapterVersionMasks.some((versions, adapter) => {
        const enabled = (registry.supportedAdapterMask & (1n << BigInt(adapter))) !== 0n;
        return !enabled ? versions !== 0 : versions !== 0 && versions !== 1 &&
          !(sourceAdapterSupportsVersion(adapter, 1) && versions === 3);
      })) {
    betaError("PLAN_STALE", "registry is not canonical and active");
  }
  const feedAccount = exactProgramAccount(rows.get(pdas.feed[0]), program, 357, "feed config");
  const planAccount = exactProgramAccount(rows.get(pdas.sourcingPlan[0]), program, 320, "sourcing plan");
  let feed; let plan;
  try { feed = decodeMimirBetaLiveFeed(feedAccount.data); plan = await decodeMimirBetaLivePlan(planAccount.data); }
  catch { return betaError("PLAN_STALE", "live-refresh feed/plan codec rejected state"); }
  if (feed.lifecycleState !== 3 || feed.bump !== pdas.feed[1] || plan.bump !== pdas.sourcingPlan[1] || !bytesEqual(feed.feedId, addressBytes(feedId)) ||
      !bytesEqual(plan.feedId, addressBytes(feedId)) || !bytesEqual(feed.baseMint, addressBytes(first.baseMint)) ||
      !bytesEqual(feed.quoteMint, addressBytes(first.quoteMint)) || !bytesEqual(feed.defaultSourcingPlan, addressBytes(pdas.sourcingPlan[0])) ||
      !bytesEqual(plan.baseMint, addressBytes(first.baseMint)) || !bytesEqual(plan.quoteMint, addressBytes(first.quoteMint)) ||
      (nativeSourceSet ? plan.minSources > pools.length : plan.minSources !== pools.length) || registry.registryEpoch < feed.registryEpoch ||
      (registry.supportedAdapterMask & plan.adapterMask) !== plan.adapterMask) betaError("PLAN_STALE", "live-refresh feed/plan identity mismatch");
  const physicalAccounts: MimirBetaPhysicalAccountFact[] = physicalAddresses.map((addressValue) => {
    const account = rows.get(addressValue) ?? betaError("PLAN_STALE", "static account missing", addressValue);
    return { address: addressValue, owner: account.owner, executable: account.executable };
  });
  const sourceHeaders = sourcePdas.map((entry, index) => {
    const account = exactProgramAccount(rows.get(entry.sourceConfig[0]), program, 384, `source config ${index}`);
    try { return decodeMimirBetaLiveSource(account.data); }
    catch { return betaError("PLAN_STALE", `source ${index} codec rejected state`); }
  });
  const authoritativeSources = sourceHeaders.map((source) => ({ ...source,
    adapterType: source.adapterType as MimirBetaCompactSourceArgs["adapterType"], direction: source.direction as MimirBetaCompactSourceArgs["direction"],
    adapterVersion: source.adapterVersion as MimirBetaAdapterVersion, feedId, programId: bytesAddress(source.programId), poolOrMarket: bytesAddress(source.poolOrMarket),
    baseVault: bytesAddress(source.baseVault), quoteVault: bytesAddress(source.quoteVault), tokenProgram: bytesAddress(source.tokenProgram),
    vaultAuthority: bytesAddress(source.vaultAuthority) }));
  const dlmmIndices = pools.flatMap((pool, index) => pool.creation.adapterType === 3 ? [index] : []);
  const matches: { pools: MimirBetaEligiblePool[]; artifacts: Awaited<ReturnType<typeof buildMimirBetaClassicSourceArtifacts>> }[] = [];
  for (let combo = 0; combo < 1 << dlmmIndices.length; combo++) {
    const candidatePools = pools.map((pool, index) => {
      const bit = dlmmIndices.indexOf(index);
      return bit < 0 ? pool : { ...pool, creation: { ...pool.creation,
        bindingVariant: (combo >> bit) & 1 ? "routeable" as const : "direct" as const } };
    });
    const artifactPools = candidatePools.map((pool, index) => {
      const source = sourceHeaders[index]!;
      if ((capturedConditions[index]! & MIMIR_COND.DEPTH_BELOW_FLOOR) !== 0 ||
          pool.minLiquidityNative < source.minLiquidityNative || pool.minDepthTo50BpsNative < source.minDepthTo50BpsNative) belowFloor.add(index);
      return { ...pool, minLiquidityNative: source.minLiquidityNative, minDepthTo50BpsNative: source.minDepthTo50BpsNative };
    });
    const candidate = await buildMimirBetaClassicSourceArtifacts({ programId: program, feedId, baseMint: first.baseMint,
      quoteMint: first.quoteMint, pools: artifactPools, physicalAccounts, authoritativeSources });
    if (bytesEqual(candidate.sourceSetRoot, plan.sourceSetHash) && bytesEqual(candidate.staticAccountsRoot, plan.accountsHash) &&
        candidate.adapterMask === plan.adapterMask && bytesEqual(feed.sourceSetHash, plan.sourceSetHash)) {
      matches.push({ pools: candidatePools, artifacts: candidate });
    }
  }
  if (matches.length !== 1) betaError("PLAN_STALE", "live-refresh Merkle roots or adapter mask changed");
  pools = matches[0]!.pools; const artifacts = matches[0]!.artifacts;
  const adapterAccounts = await Promise.all(pools.map(async (pool, index) => [
    ...await freshAdapterAccounts(pool, captureRows),
    ...((nativeSourceSet || monoSourceIndex === index) && (pool.creation.adapterType === 1 || pool.creation.adapterType === 3)
      ? [observations[index]!, ...(pool.creation.adapterType === 3 ? [METEORA_DLMM_PROGRAM, METEORA_DLMM_PROGRAMDATA] : [])]
      : []),
  ]));
  const sourceStates = sourcePdas.map((entry, index) => {
    const ringRow = rows.get(entry.sourceRing[0]);
    const ringAccount = ringRow && !isMimirBetaLifecycleUninitialized(ringRow) ? exactProgramAccount(ringRow, program, 544, `source ring ${index}`) : null;
    const source = sourceHeaders[index]!; let ring: ReturnType<typeof decodeMimirBetaLiveRing> | null = null;
    try { if (ringAccount) ring = decodeMimirBetaLiveRing(ringAccount.data); }
    catch { return betaError("PLAN_STALE", `source ${index} codec rejected state`); }
    const pool = pools[index]!; const artifact = artifacts.artifacts[index]!;
    const rawVersionMask = registry.supportedAdapterVersionMasks[source.adapterType] ?? 0;
    const effectiveVersionMask = rawVersionMask === 0 ? 1 : rawVersionMask;
    if (source.status !== 0 || source.bump !== entry.sourceConfig[1] || source.sourceIndex !== index ||
        !sourceAdapterSupportsVersion(source.adapterType, source.adapterVersion) || source.adapterVersion !== pool.creation.adapterVersion || source.sourceConfigRevision <= 0n || source.sourceSetRevision <= 0n ||
        (registry.supportedAdapterMask & (1n << BigInt(source.adapterType))) === 0n ||
        (effectiveVersionMask & (1 << source.adapterVersion)) === 0 ||
        (ring && ((ring.status !== 0 && ring.status !== 2) || ring.bump !== entry.sourceRing[1] || ring.sourceIndex !== index ||
          ring.ringVersion !== plan.ringVersion || ring.adapterType !== source.adapterType || ring.sourceConfigRevision !== source.sourceConfigRevision ||
          ring.sourceSetRevision !== source.sourceSetRevision || !bytesEqual(ring.feedId, addressBytes(feedId)) ||
          !bytesEqual(ring.sourceConfig, addressBytes(entry.sourceConfig[0])) ||
          !bytesEqual(ring.poolOrMarket, addressBytes(pool.pool)) || !bytesEqual(ring.selectedPlanHash, plan.planHash))) ||
        !bytesEqual(source.feedId, addressBytes(feedId)) ||
        source.adapterType !== pool.creation.adapterType || source.direction !== artifact.source.direction ||
        source.venueGroup !== artifact.source.venueGroup || source.operatorGroup !== artifact.source.operatorGroup ||
        source.liquidityOwnerGroup !== artifact.source.liquidityOwnerGroup || source.routeCorrelationGroup !== artifact.source.routeCorrelationGroup ||
        source.quoteAssetGroup !== artifact.source.quoteAssetGroup || source.bridgeOrWrapperGroup !== artifact.source.bridgeOrWrapperGroup ||
        source.oracleSourceClass !== artifact.source.oracleSourceClass || source.upgradeAuthorityGroup !== artifact.source.upgradeAuthorityGroup ||
        source.maxSourceWeightBps !== artifact.source.maxSourceWeightBps || source.minLiquidityNative !== artifact.source.minLiquidityNative ||
        source.minDepthTo50BpsNative !== artifact.source.minDepthTo50BpsNative ||
        !bytesEqual(source.programId, addressBytes(pool.programId)) || !bytesEqual(source.poolOrMarket, addressBytes(pool.pool)) ||
        !bytesEqual(source.baseVault, addressBytes(pool.baseVault)) || !bytesEqual(source.quoteVault, addressBytes(pool.quoteVault)) ||
        !bytesEqual(source.baseMint, addressBytes(pool.baseMint)) || !bytesEqual(source.quoteMint, addressBytes(pool.quoteMint)) ||
        !bytesEqual(source.tokenProgram, addressBytes(pool.creation.tokenProgramId)) ||
        !bytesEqual(source.vaultAuthority, addressBytes(pool.creation.vaultAuthority))) betaError("PLAN_STALE", `source ${index} identity/revision changed`);
    return { source, ring };
  });
  // Both optional versions were fetched once; only authenticated pool bytes choose the instruction PDA.
  const mixedTemporal = mixedTemporalCandidates.map((entry, index) => {
    if (!entry || !entry.reserveModule) return entry;
    const pool = pools[index]!, source = sourceHeaders[index]!;
    const account = exactProgramAccount(rows.get(pool.pool), METEORA_DAMM_V2_PROGRAM, 1112, "DAMM pool");
    const baseIsA = bytesEqual(account.data.subarray(168, 200), addressBytes(pool.baseMint));
    if (source.adapterVersion !== 0 || bytesAddress(source.tokenProgram) !== "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
        !bytesEqual(account.data.subarray(168, 200), addressBytes(baseIsA ? pool.baseMint : pool.quoteMint)) ||
        !bytesEqual(account.data.subarray(200, 232), addressBytes(baseIsA ? pool.quoteMint : pool.baseMint)) ||
        !bytesEqual(account.data.subarray(232, 264), addressBytes(baseIsA ? pool.baseVault : pool.quoteVault)) ||
        !bytesEqual(account.data.subarray(264, 296), addressBytes(baseIsA ? pool.quoteVault : pool.baseVault)))
      betaError("PLAN_STALE", "DAMM pool/token roles changed", pool.pool);
    const version = selectMimirDammTemporalVersion(account.data);
    return { ...entry, version, module: version === 3 ? entry.reserveModule : entry.module };
  });
  return { feedId, pdas, canonical, registry, feed, plan, coherentSlot: coherent.slot, rows, sourcePdas, artifacts, sourceStates, witnessPda,
    pools, adapterAccounts, temporalModulePda, mixedTemporal, mixedMarker, generationCluster,
    belowFloorSources: [...belowFloor].sort((a, b) => a - b) as readonly number[],
    cpmmPins: [RAYDIUM_CPMM_PROGRAM, RAYDIUM_CPMM_PROGRAMDATA] as const };
}

type LoadedLiveFeed = Awaited<ReturnType<typeof loadMimirBetaExistingLiveFeed>>;

/** @internal */
export const nativeTailed = (d: MimirFusedDescriptor) => d.mode === 2 && (d.adapterType === 1 || d.adapterType === 3);

/** @internal Recurring tag-89 external vectors rebuilt from the sealed descriptors. */
export function classicRowExternals(descriptors: readonly MimirFusedDescriptor[], loaded: Pick<LoadedLiveFeed, "adapterAccounts" | "cpmmPins" | "generationCluster">): Address[][] {
  const dlmmPins = mimirExecutableGenerationPins(loaded.generationCluster).dlmm;
  return descriptors.map((d, index) => {
    const accounts = loaded.adapterAccounts[index]!;
    const temporal = d.temporalKind === 1 ? { version: 2, sourceProgram: loaded.cpmmPins[0], sourceProgramData: loaded.cpmmPins[1] }
      : d.temporalKind === 2 || d.temporalKind === 3 ? { version: d.temporalKind === 2 ? 1 : 3, sourceProgram: METEORA_DAMM_V2_PROGRAM,
        sourceProgramData: METEORA_DAMM_V2_PROGRAMDATA }
      : d.adapterType === 3 && d.mode === 5 ? { version: 4, sourceProgram: dlmmPins[0], sourceProgramData: dlmmPins[1] } : undefined;
    const marker = d.adapterType === 0 && d.mode === 3 ? mimirExecutableGenerationPins(loaded.generationCluster).orca : null;
    return [...mimirFusedRowExternals({ adapterType: d.adapterType, adapterAccounts: marker ? [...accounts.slice(0, 7), marker[0], marker[1]]
      : d.temporalKind === 6 && d.adapterType === 2 ? [...accounts.slice(0, 5), ...loaded.cpmmPins]
      : !temporal && d.temporalKind === 0 ? accounts.slice(0, d.externalWidth) : accounts,
      ...(temporal ? { temporal } : {}), cluster: loaded.generationCluster }).externals];
  });
}

/** Tag-89 sample-only or publish refresh of an existing classic feed (A2 §4), reloading the private converter rows when `S>0`. */
export async function prepareMimirBetaClassicRefresh(dependencies: MimirBetaLiveDependencies & Readonly<{ abi1Capability?: MimirAbi1Capability; abi1ReleaseRecipeScope?: boolean }>, args: PrepareMimirBetaClassicRefreshArgs,
  commitment: "confirmed" | "finalized" = "confirmed"): Promise<MimirBetaPreparedClassicRefresh> {
  let payer: Address;
  try { payer = address(args.payer); } catch { return betaError("INVALID_ARGUMENT", "classic refresh payer is invalid"); }
  if (args.mode !== "sample" && args.mode !== "publish") betaError("INVALID_ARGUMENT", "classic refresh mode is invalid");
  const program = dependencies.deployment.mimirProgramId;
  if (!Array.isArray(args.pools) || !args.pools[0]) betaError("INVALID_ARGUMENT", "existing live-feed pool bounds are invalid");
  const feedId = args.feedId ?? await deriveMimirBetaClassicFeedId(args.pools[0].baseMint, args.pools[0].quoteMint);
  const [execution] = await deriveMimirClassicExecutionAddress(program, addressBytes(feedId));
  const floor = args.pools.reduce((slot, pool) => pool.observedSlot > slot ? pool.observedSlot : slot, 0n);
  const probe = readMimirBetaAccountCohort(dependencies.rpc, [execution], commitment, floor).then(async (read) => {
    const account = exactProgramAccount(read.value[0], program, read.value[0]?.data.length ?? 0, "classic execution");
    const state = await decodeMimirClassicExecutionAccount({ programId: program, address: execution, owner: account.owner, data: account.data,
      requireActive: true });
    if (state.componentCount !== args.pools.length) betaError("PLAN_STALE", "classic execution row count differs from the pool set");
    const s = state.converterSourceCount;
    if ((args.converterPools?.length ?? 0) !== s) betaError("INVALID_ARGUMENT", "classic refresh converter pools must match the execution converter rows");
    const capability = args.capability ?? dependencies.abi1Capability;
    assertMimirAbi1Capable({ cluster: dependencies.deployment.cluster, programId: program, ...(capability ? { capability } : {}),
      releaseRecipeScope: dependencies.abi1ReleaseRecipeScope, recipes: state.layout.descriptors, action: args.mode, executionKind: "classic", converterSourceCount: s });
    return { account, state };
  });
  const converterLoad = probe.then(({ state }) => state.converterSourceCount === 0 ? null : loadMimirBetaExistingLiveFeed(dependencies, args.converterPools!,
    undefined, false, commitment, undefined, true, bytesAddress(decodeFeedConfigHeader(state.converter!.feedConfigImage).feedId)));
  const native = probe.then(({ state }) => state.layout.descriptors.slice(0, state.componentCount).some(nativeTailed));
  native.catch(() => undefined);
  const settled = await Promise.allSettled([loadMimirBetaExistingLiveFeed(dependencies, args.pools, undefined, true, commitment, undefined,
    native, feedId, false, [execution]), probe, converterLoad]);
  const [loaded, { account: executionAccount, state }, converter] = settled.map((entry) => {
    if (entry.status === "rejected") throw entry.reason;
    return entry.value;
  }) as [LoadedLiveFeed, Awaited<typeof probe>, LoadedLiveFeed | null];
  if (loaded.feedId !== feedId) betaError("PLAN_STALE", "classic refresh feed identity changed", execution);
  if (converter?.belowFloorSources.length) {
    betaError("SOURCE_BELOW_FLOOR_UNPUBLISHABLE", `converter source ${converter.belowFloorSources[0]} is below its configured floor`, execution);
  }
  const current = exactProgramAccount(loaded.rows.get(execution), program, executionAccount.data.length, "classic execution");
  if (current.owner !== executionAccount.owner || !bytesEqual(current.data, executionAccount.data)) betaError("PLAN_STALE", "classic execution changed during native reload", execution);
  const snapshotAccount = exactProgramAccount(loaded.rows.get(loaded.pdas.snapshot[0]), program, 512, "feed snapshot");
  state.layout.descriptors.forEach((d, row) => {
    if (d.adapterType !== 7 || (d.temporalKind !== 2 && d.temporalKind !== 3)) return;
    const source = row < state.componentCount ? loaded : converter!; const pool = source.pools[row < state.componentCount ? row : row - state.componentCount]!.pool;
    assertMimirClassicDammRecipePolicy({ row, version: d.temporalKind === 2 ? 1 : 3, pool, poolAccount: source.rows.get(pool) });
  });
  const contextSlot = converter && converter.coherentSlot > loaded.coherentSlot ? converter.coherentSlot : loaded.coherentSlot;
  const instruction = buildMimirFusedClassicInstruction({ programId: program, snapshot: loaded.pdas.snapshot[0], registry: loaded.canonical.registry[0],
    execution, layout: state.layout, primaryExternals: classicRowExternals(state.layout.descriptors.slice(0, state.componentCount), loaded),
    converterExternals: converter ? classicRowExternals(state.layout.descriptors.slice(state.componentCount), converter) : [],
    request: mimirFusedClassicRequest({ state, snapshotRevision: new DataView(snapshotAccount.data.buffer, snapshotAccount.data.byteOffset).getBigUint64(96, true), mode: args.mode,
      declaredMaxSnapshotAge: args.declaredMaxSnapshotAge, ensure: args.exactSample !== true,
      ...(args.maxReuseAgeSlots !== undefined ? { maxReuseAgeSlots: args.maxReuseAgeSlots } : {}) }) });
  const blockhash = parseBlockhash(await dependencies.rpc.getLatestBlockhash({ commitment }).send());
  const transaction = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: blockhash.blockhash,
    lastValidBlockHeight: blockhash.lastValidBlockHeight, instructions: [instruction] });
  const rows = converter ? new Map([...loaded.rows, ...converter.rows]) : loaded.rows;
  let publication: MimirBetaClassicPublicationOutcome | null = null;
  const simulated = args.mode === "publish"
    ? simulateExactPostAccounts(dependencies.rpc, transaction.serializedTransaction, contextSlot, program, [loaded.pdas.snapshot[0]], commitment)
      .then(({ simulation, accounts }) => {
        const data = exactProgramAccount(accounts[0], program, 512, "published feed snapshot").data;
        const request = decodeMimirFusedClassicData(instruction.data);
        try {
          publication = mimirClassicPublicationOutcome(data, loaded.belowFloorSources, { feedId: addressBytes(feedId), feedConfig: loaded.pdas.feed[0],
            configRevision: request.feedConfigRevision, planHash: request.planHash, minRevision: request.previousSnapshotRevision,
            floorSlot: contextSlot, contextSlot: simulation.contextSlot });
        } catch (error) {
          betaError("CLASSIC_PUBLICATION_NOT_FRESH", `classic refresh simulation would not publish a Fresh or valid Degraded snapshot: ${(error as Error).message}`, loaded.pdas.snapshot[0]);
        }
        return simulation;
      })
    : simulateExact(dependencies.rpc, transaction.serializedTransaction, contextSlot, program, commitment);
  const simulation = await simulated
    .catch((error: unknown) => proveMimirBetaPreparationDrift(dependencies.rpc, rows, contextSlot, program, commitment, error, [instruction]));
  if (dependencies.deployment.cluster === "mainnet-beta") assertMimirStrictSimulation(transaction, { err: null, unitsConsumed: simulation.unitsConsumed });
  const evidenceHash = await domainHash("MIMIR_BETA_CLASSIC_REFRESH_V1\0", canonicalJson({ contextSlot,
    poolEvidence: [...loaded.pools, ...converter?.pools ?? []].map((pool) => pool.evidenceHash), mode: args.mode, planHash: hex(loaded.plan.planHash),
    messageHash: transaction.messageHash } as never));
  return Object.freeze({ schema: "mimir-beta-prepared-classic-refresh", version: 1, mode: args.mode, execution, contextSlot,
    evidenceHash, transaction, simulation, publication });
}

/** CPMM quiet-v2 anchor A of one temporal row; `anchorSlot`/`anchorUnix` are null while the module is blank. */
export interface MimirClassicQuietAnchor {
  readonly row: number; readonly anchorSlot: bigint | null; readonly anchorUnix: bigint | null; readonly invalidated: boolean;
}

/** Anchor A of every CPMM quiet-v2 (temporalKind 1) row of a decoded ClassicExecution. */
export function mimirClassicQuietAnchors(state: MimirClassicExecution, data: Uint8Array): readonly MimirClassicQuietAnchor[] {
  const anchors: MimirClassicQuietAnchor[] = [];
  mimirClassicRefreshMode(state, (row, module, ring) => {
    if (state.layout.descriptors[row]!.temporalKind !== 1) return true;
    if (!module.some(Boolean)) { anchors.push({ row, anchorSlot: null, anchorUnix: null, invalidated: false }); return true; }
    let decoded: ReturnType<typeof decodeMimirBrowserCpmmQuietTemporalModuleV2>;
    try { decoded = decodeMimirBrowserCpmmQuietTemporalModuleV2(module, decodeMimirBrowserSourceRingV1(ring)); }
    catch { return betaError("ACCOUNT_MALFORMED", `row ${row} CPMM quiet module is malformed`); }
    anchors.push({ row, anchorSlot: decoded.anchorA.slot, anchorUnix: decoded.anchorA.unixTs, invalidated: decoded.invalidated });
    return true;
  }, data);
  return anchors;
}

export const MIMIR_CPMM_QUIET_INTERVAL_SECS = 120n;

/** `anchored`: a new A is committed; `not-anchored`: the confirmed sample left A unchanged or blank; `conditioned`: the module is invalidated. */
export type MimirClassicQuietPrimeState = "anchored" | "not-anchored" | "conditioned";

export interface MimirClassicQuietPrimeOutcome {
  readonly state: MimirClassicQuietPrimeState;
  readonly anchors: readonly MimirClassicQuietAnchor[];
  /** Chain Clock time when the second observation may mature the window (A + 120 s); null unless `anchored`. */
  readonly readyAtUnix: bigint | null;
  readonly waitSecs: bigint | null;
  readonly nowUnix: bigint;
  readonly explanation: string;
}

/** Prime state machine: compares the quiet anchors read before the standalone sample with the confirmed post-sample anchors. */
export function mimirClassicQuietPrimeOutcome(before: readonly MimirClassicQuietAnchor[], after: readonly MimirClassicQuietAnchor[],
  nowUnix: bigint): MimirClassicQuietPrimeOutcome {
  if (after.length === 0 || after.length !== before.length) betaError("PLAN_STALE", "CPMM quiet rows changed across the prime");
  const base = { anchors: after, nowUnix };
  const conditioned = after.find((a) => a.invalidated);
  if (conditioned) return { ...base, state: "conditioned", readyAtUnix: null, waitSecs: null,
    explanation: `row ${conditioned.row} quiet window is invalidated by a pool change; it restarts from a new sample once the pool settles` };
  const stuck = after.find((a, i) => a.anchorSlot === null || a.anchorUnix! > nowUnix || a.anchorSlot === before[i]!.anchorSlot);
  if (stuck) return { ...base, state: "not-anchored", readyAtUnix: null, waitSecs: null,
    explanation: `row ${stuck.row} sample confirmed without starting a new quiet window; nothing more was sent` };
  const readyAtUnix = after.reduce((max, a) => a.anchorUnix! + MIMIR_CPMM_QUIET_INTERVAL_SECS > max ? a.anchorUnix! + MIMIR_CPMM_QUIET_INTERVAL_SECS : max, 0n);
  const waitSecs = readyAtUnix > nowUnix ? readyAtUnix - nowUnix : 0n;
  return { ...base, state: "anchored", readyAtUnix, waitSecs,
    explanation: `quiet window started; the price can publish ${waitSecs}s from now if the pool stays unchanged` };
}

export interface MimirBetaPreparedClassicQuietPrime {
  readonly refresh: MimirBetaPreparedClassicRefresh;
  readonly before: readonly MimirClassicQuietAnchor[];
}

async function readMimirClassicQuietAnchors(dependencies: MimirBetaLiveDependencies, execution: Address, minContextSlot: bigint,
  commitment: "confirmed" | "finalized") {
  const program = dependencies.deployment.mimirProgramId;
  const read = await readMimirBetaAccountCohort(dependencies.rpc, [execution, MIMIR_NATIVE_CLOCK_ADDRESS], commitment, minContextSlot);
  const account = exactProgramAccount(read.value[0], program, read.value[0]?.data.length ?? 0, "classic execution");
  const state = await decodeMimirClassicExecutionAccount({ programId: program, address: execution, owner: account.owner, data: account.data, requireActive: true });
  return { anchors: mimirClassicQuietAnchors(state, account.data), nowUnix: mimirAuthenticClockUnix(read.value[1], read.slot, "quiet prime Clock is not authentic") };
}

/**
 * Standalone quiet prime: an exact sample-only tag 89 (`exactSample`) whose confirmation must commit anchor A outside any consumer
 * transaction. Refuses a feed without a CPMM quiet row. Confirm, then `verifyMimirBetaClassicQuietPrime` before planning refresh+publish.
 */
export async function prepareMimirBetaClassicQuietPrime(dependencies: Parameters<typeof prepareMimirBetaClassicRefresh>[0],
  args: Omit<PrepareMimirBetaClassicRefreshArgs, "mode" | "exactSample" | "maxReuseAgeSlots">): Promise<MimirBetaPreparedClassicQuietPrime> {
  if (!Array.isArray(args.pools) || !args.pools[0]) betaError("INVALID_ARGUMENT", "existing live-feed pool bounds are invalid");
  const feedId = args.feedId ?? await deriveMimirBetaClassicFeedId(args.pools[0].baseMint, args.pools[0].quoteMint);
  const [execution] = await deriveMimirClassicExecutionAddress(dependencies.deployment.mimirProgramId, addressBytes(feedId));
  const floor = args.pools.reduce((slot, pool) => pool.observedSlot > slot ? pool.observedSlot : slot, 0n);
  const { anchors } = await readMimirClassicQuietAnchors(dependencies, execution, floor, "confirmed");
  if (anchors.length === 0) betaError("CLASSIC_RECIPE_UNSUPPORTED", "feed has no CPMM quiet row to prime", execution);
  const refresh = await prepareMimirBetaClassicRefresh(dependencies, { ...args, feedId, mode: "sample", exactSample: true });
  if (refresh.execution !== execution) betaError("PLAN_STALE", "quiet prime execution changed", refresh.execution);
  return Object.freeze({ refresh, before: anchors });
}

/** Re-reads the module after the prime confirmed at `minContextSlot` and returns the proven state and justified wait. */
export async function verifyMimirBetaClassicQuietPrime(dependencies: MimirBetaLiveDependencies, prime: MimirBetaPreparedClassicQuietPrime,
  minContextSlot: bigint, commitment: "confirmed" | "finalized" = "confirmed"): Promise<MimirClassicQuietPrimeOutcome> {
  const { anchors, nowUnix } = await readMimirClassicQuietAnchors(dependencies, prime.refresh.execution, minContextSlot, commitment);
  return mimirClassicQuietPrimeOutcome(prime.before, anchors, nowUnix);
}

/** Explicit mode-3 arms: CPMM quiet-v2 `2/0/3/1/7`, Orca marker-quiet `0/0/3/0/9`, DAMM OnlyB-v1 `7/0/3/2/5`, DAMM reserve-v3 `7/0/3/3/5`. */
export type MimirClassicIntervalRecipe = "cpmm-quiet-interval-v2" | "orca-marker-quiet" | "damm-onlyb-interval-v1" | "damm-reserve-interval-v3";
/**
 * `"dual-native-point"`: CPMM-v0 `DUAL_NATIVE_POINT_V1` (N = Q = 1 classic primary): native when qualified, else current point.
 * `"current-point"`: explicit DLMM direct compact point (`3.0.m5.k5.E6` / `3.1.m5.k5.E7`); never a default, never a converter.
 */
export type MimirClassicRowRecipe = "spot" | "native-bounded" | "dual-native-point" | "current-point" | MimirClassicIntervalRecipe;
export type MimirClassicCpmmRecipe = MimirClassicRowRecipe;

const INTERVAL_FAMILY: Readonly<Record<MimirClassicIntervalRecipe, number>> = {
  "cpmm-quiet-interval-v2": 2, "orca-marker-quiet": 0, "damm-onlyb-interval-v1": 7, "damm-reserve-interval-v3": 7 };

export const isMimirClassicIntervalRecipe = (recipe: unknown): recipe is MimirClassicIntervalRecipe =>
  typeof recipe === "string" && Object.hasOwn(INTERVAL_FAMILY, recipe);

/** Mode-3 row vector from the base adapter vector (CPMM `B,Q,P,C,Observation`): CPMM/DAMM embed their temporal module, Orca appends Program/ProgramData. */
export function mimirClassicIntervalRow(a: Readonly<{ adapterType: number; adapterVersion: number; adapterAccounts: readonly Address[];
  recipe: MimirClassicIntervalRecipe; cluster: MimirGenerationCluster; pool?: Address }>): Readonly<{ adapterAccounts: readonly Address[];
  temporal?: Readonly<{ version: number; sourceProgram: Address; sourceProgramData: Address }> }> {
  if (INTERVAL_FAMILY[a.recipe] !== a.adapterType || a.adapterVersion !== 0) {
    return betaError("CLASSIC_RECIPE_UNSUPPORTED", `${a.recipe} is not admitted for adapter ${a.adapterType} v${a.adapterVersion}`, a.pool);
  }
  const pins = mimirExecutableGenerationPins(a.cluster);
  if (a.recipe === "orca-marker-quiet") return { adapterAccounts: [...a.adapterAccounts.slice(0, 7), pins.orca[0], pins.orca[1]] };
  const [sourceProgram, sourceProgramData] = a.adapterType === 2 ? pins.cpmm : pins.damm;
  return { adapterAccounts: a.adapterAccounts.slice(0, a.adapterType === 2 ? 5 : 3), temporal: { sourceProgram, sourceProgramData,
    version: a.recipe === "cpmm-quiet-interval-v2" ? 2 : a.recipe === "damm-onlyb-interval-v1" ? 1 : 3 } };
}

/** Program/ProgramData generation pins a mode-3 row reads. */
export function mimirClassicIntervalPins(recipe: MimirClassicIntervalRecipe, cluster: MimirGenerationCluster): readonly [Address, Address] {
  const pins = mimirExecutableGenerationPins(cluster);
  const [program, programData] = recipe === "orca-marker-quiet" ? pins.orca : recipe === "cpmm-quiet-interval-v2" ? pins.cpmm : pins.damm;
  return [program, programData];
}

/** Authenticates the executable generation of a mode-3 row's venue from one coherent read. */
export function assertMimirClassicIntervalGeneration(recipe: MimirClassicIntervalRecipe, rows: ReadonlyMap<Address, MimirBetaAccount | null>,
  cluster: MimirGenerationCluster): void {
  const [p, d] = mimirClassicIntervalPins(recipe, cluster);
  const program = rows.get(p); const programData = rows.get(d);
  const verify = recipe === "orca-marker-quiet" ? verifyOrcaExecutableGeneration : recipe === "cpmm-quiet-interval-v2" ? verifyCpmmExecutableGeneration
    : verifyDammExecutableGeneration;
  if (!program || !programData || !verify(program, programData, cluster)) betaError("PLAN_STALE", `${recipe} venue executable generation changed`, p);
}

/** A DAMM interval recipe (OnlyB `1`, reserve `3`) must equal the temporal version selected by the authenticated pool bytes. */
export function assertMimirClassicDammRecipePolicy(a: Readonly<{ row: number; version: number; pool: Address; poolAccount: MimirBetaAccount | null | undefined }>): void {
  const data = exactProgramAccount(a.poolAccount, METEORA_DAMM_V2_PROGRAM, 1112, "DAMM pool").data;
  let actual: string;
  try { actual = `v${selectMimirDammTemporalVersion(data)}`; } catch { actual = "unsupported"; }
  if (actual !== `v${a.version}`) betaError("CLASSIC_RECIPE_UNSUPPORTED",
    `row ${a.row} DAMM temporal recipe v${a.version} does not match pool policy ${actual}`, a.pool);
  const locked = readU128(data, 552);
  if (locked === 0n || locked > readU128(data, 360)) betaError("CLASSIC_RECIPE_UNSUPPORTED",
    `row ${a.row} DAMM interval requires permanent locked liquidity greater than zero and no greater than pool liquidity`, a.pool);
}

/** Orca marker-quiet readiness at chain `nowUnix`: the marker interval must have matured before a publish. */
export function mimirClassicOrcaMarkerReadiness(a: Readonly<{ row: number; pool: Address; poolAccount: MimirBetaAccount | null | undefined;
  nowUnix: bigint; cluster: MimirGenerationCluster }>): MimirClassicNativeReadiness {
  const data = a.poolAccount?.data ?? betaError("CREATION_CONTEXT_REQUIRED", "Orca pool account missing", a.pool);
  let interval;
  try { interval = mimirOrcaMarkerQuietInterval(data, addressBytes(mimirOrcaWhirlpoolsConfigAddress(a.cluster)), a.nowUnix, mimirVenueDeploymentUnix(a.cluster).orca); }
  catch { return betaError("PLAN_STALE", "Orca marker state is unsound", a.pool); }
  const span = a.nowUnix - interval.startUnixTs;
  return { row: a.row, observation: a.pool, ready: interval.ready, ...(interval.markerUnixTs <= a.nowUnix ? { readyAtUnixTs: interval.readyAtUnixTs } : {}), lastUpdate: interval.markerUnixTs, ageSecs: a.nowUnix - interval.markerUnixTs,
    maxEligibleSpanSecs: interval.ready ? span : null, oldestSpanSecs: span < 0n ? 0n : span };
}

/** Venues admitting the explicit DUAL recipe: CPMM v0 and DLMM (classic primary or composite component). */
export const mimirDualVenue = (pool: MimirBetaEligiblePool) => pool.creation.adapterType === 2 && pool.creation.adapterVersion === 0 || pool.creation.adapterType === 3;
/** Explicit DLMM compact point (`m5.k5`): direct binding only; tail is the pinned DLMM program and ProgramData (MTP4 module v4). */
export const mimirDlmmPointAdmitted = (pool: MimirBetaEligiblePool) => pool.creation.adapterType === 3 && pool.creation.bindingVariant !== "routeable" &&
  mimirCurrentPointAdmitted(3, pool.creation.adapterVersion);
export const mimirDlmmPointTemporal = (cluster: MimirGenerationCluster) => {
  const [sourceProgram, sourceProgramData] = mimirExecutableGenerationPins(cluster).dlmm;
  return { version: 4, sourceProgram: sourceProgram as Address, sourceProgramData: sourceProgramData as Address };
};

/** `DUAL_NATIVE_POINT_V1` shape: exactly one CPMM v0 or DLMM pool (N = Q = 1 classic primary). */
export function mimirClassicDualAdmitted(pools: readonly MimirBetaEligiblePool[], row: number): boolean {
  return pools.length === 1 && row === 0 && mimirDualVenue(pools[0]!);
}

/** Families with an admitted classic native-bounded arm: CLMM (1), CPMM (2), DLMM (3). */
export const mimirClassicNativeAdmitted = (adapterType: number) => adapterType === 1 || adapterType === 2 || adapterType === 3;

/** @internal Native-bounded external tail after the spot vector: CPMM none (its observation is the fifth role), CLMM observation, DLMM oracle + program pins. */
export async function mimirClassicNativeTail(pool: MimirBetaEligiblePool): Promise<readonly Address[]> {
  if (pool.creation.adapterType === 2) return [];
  if (pool.creation.adapterType === 3) {
    return [(await deriveMimirBetaPda({ programId: METEORA_DLMM_PROGRAM, seed: "oracle", values: [addressBytes(pool.pool)] }))[0],
      METEORA_DLMM_PROGRAM, METEORA_DLMM_PROGRAMDATA];
  }
  if (pool.creation.adapterType === 1) {
    return [pool.readPlan.auxiliary.find((entry) => entry.role === "clmm-observation")?.address ??
      betaError("PROGRAM_ABI_MISMATCH", "CLMM observation binding is missing", pool.pool)];
  }
  return betaError("INVALID_ARGUMENT", "native-bounded is not admitted for this family", pool.pool);
}

/** Native-history readiness of one native-bounded row from its pool, native observation and chain `nowUnix` (program-parity preflight). */
export function mimirClassicNativeRowReadiness(a: Readonly<{ row: number; pool: MimirBetaEligiblePool; poolAccount: MimirBetaAccount | null | undefined;
  observation: Address; observationAccount: MimirBetaAccount | null | undefined; nowUnix: bigint; cluster: MimirGenerationCluster; dual?: boolean }>): MimirClassicNativeReadiness {
  const { pool, nowUnix } = a; const base = { row: a.row, observation: a.observation };
  if (pool.creation.adapterType === 2) {
    const account = exactProgramAccount(a.observationAccount, pool.programId, 4_075, "CPMM observation");
    if (!bytesEqual(account.data.subarray(11, 43), addressBytes(pool.pool))) betaError("PLAN_STALE", "CPMM observation identity changed", a.observation);
    return { ...base, ...mimirClassicCpmmNativeReadiness(account.data, nowUnix, a.dual) };
  }
  const dlmm = pool.creation.adapterType === 3;
  const poolAccount = a.poolAccount ?? betaError("CREATION_CONTEXT_REQUIRED", "native pool account missing", pool.pool);
  const account = a.observationAccount;
  if (!account) {
    if (dlmm && a.dual) betaError("PLAN_STALE", "DLMM oracle is missing", a.observation);
    return { ...base, ready: false, lastUpdate: 0n, ageSecs: nowUnix, maxEligibleSpanSecs: null, oldestSpanSecs: 0n };
  }
  if (account.owner !== (dlmm ? METEORA_DLMM_PROGRAM : pool.programId) || account.executable ||
      (dlmm && !bytesEqual(poolAccount.data.subarray(552, 584), addressBytes(a.observation)))) {
    betaError("PLAN_STALE", "native observation identity changed", a.observation);
  }
  const dual = dlmm && a.dual ? classifyMeteoraDlmmDualReadiness(account.data, nowUnix, a.cluster) : "ready";
  if (dual === "INVALID") betaError("PLAN_STALE", "native observation history is unsound", a.observation);
  if (dual !== "ready") {
    return { ...base, ready: false, lastUpdate: 0n, ageSecs: nowUnix, maxEligibleSpanSecs: null, oldestSpanSecs: 0n,
      reason: dual === "STALE" ? "stale-oracle" : dual === "GAP" ? "interval-too-sparse" : "history-too-short" };
  }
  try {
    const s = dlmm ? extractMeteoraDlmmNativeTwapSample({ oracleData: account.data, currentTimestamp: nowUnix, cluster: a.cluster,
        activeId: new DataView(poolAccount.data.buffer, poolAccount.data.byteOffset, poolAccount.data.byteLength).getInt32(76, true) })
      : extractRaydiumClmmNativeTwapObservationSample({ observationState: account.data, expectedPoolState: addressBytes(pool.pool),
        currentTick: readRaydiumClmmPoolCurrentTick(poolAccount.data), nowTimestamp: nowUnix });
    const last = "newTimestamp" in s ? s.newTimestamp : s.latestTimestamp;
    return { ...base, ready: true, lastUpdate: last, ageSecs: nowUnix - last, maxEligibleSpanSecs: last - s.oldTimestamp, oldestSpanSecs: last - s.oldTimestamp };
  } catch (error) {
    if (!(error instanceof MimirNativeTwapUnavailableError)) betaError("PLAN_STALE", "native observation history is unsound", a.observation);
    const { latestUnixTs, olderUnixTs, connectedUnixTs } = (error as MimirNativeTwapUnavailableError).timestamps;
    const last = latestUnixTs ?? 0n;
    // DLMM with a fresh endpoint: ready once the connected history spans 240 s, assuming trading continues; none when stale.
    const estimate = dlmm && connectedUnixTs !== undefined ? connectedUnixTs + BigInt(METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS) : undefined;
    const readyAt = estimate !== undefined && nowUnix - last <= 60n && estimate < last + 61n ? last + 61n : estimate;
    return { ...base, ready: false, ...(readyAt === undefined ? {} : { readyAtUnixTs: readyAt }), lastUpdate: last, ageSecs: nowUnix - last, maxEligibleSpanSecs: null,
      oldestSpanSecs: olderUnixTs === null ? 0n : last - olderUnixTs, reason: (error as MimirNativeTwapUnavailableError).reason };
  }
}

/** Bounded per-pool DEX activity reads (finalized); absent methods mean no activity evidence. */
export interface MimirBetaDexActivityRpc {
  getSignaturesForAddress?(address: Address, config: Readonly<{ commitment: "finalized"; limit: number }>): Readonly<{ send(): Promise<unknown> }>;
  getTransaction?(signature: string, config: Readonly<{ commitment: "finalized"; encoding: "json"; maxSupportedTransactionVersion: 1 }>):
    Readonly<{ send(): Promise<unknown> }>;
}

export type MimirBetaConverterLegRefusal = "recipe-unsupported" | "native-not-ready" | "activity-unproven" | "activity-stale";

export interface MimirBetaConverterLegEligibility {
  readonly row: number;
  readonly pool: Address;
  readonly family: string;
  readonly eligible: boolean;
  readonly reason: MimirBetaConverterLegRefusal | null;
  readonly nativeAgeSecs: bigint | null;
  /** Slot of a recent pool trade: the newest verified successful DEX transaction writing this pool (its authenticated slot). */
  readonly lastActivitySlot: bigint | null;
  readonly activityAgeSlots: bigint | null;
}

export interface MimirBetaConverterEligibility {
  readonly feedId: Address;
  readonly sourceConfig: Address;
  readonly slot: bigint;
  readonly maxActivityAgeSlots: bigint;
  readonly eligible: boolean;
  readonly legs: readonly MimirBetaConverterLegEligibility[];
  /** Weakest-leg `maxActivityAgeSlots - activityAgeSlots`; null when any leg is refused. */
  readonly headroomSlots: bigint | null;
}

const DEX_ACTIVITY_SIGNATURES = 25;
const DEX_ACTIVITY_VERIFICATIONS = 3;

type DexActivityEvidence = Readonly<{ slot: bigint | null }> | null;

function dexActivityEvidence(response: unknown, pool: MimirBetaEligiblePool): DexActivityEvidence {
  type Ix = { programIdIndex?: unknown; accounts?: unknown };
  const t = response as { slot?: unknown; meta?: { err?: unknown; logMessages?: unknown; innerInstructions?: unknown;
    loadedAddresses?: { writable?: unknown; readonly?: unknown } };
    transaction?: { message?: { accountKeys?: unknown; header?: Record<string, unknown>; instructions?: unknown } } } | null;
  const message = t?.transaction?.message; const keys = message?.accountKeys; const header = message?.header;
  const loadedWritable = t?.meta?.loadedAddresses?.writable ?? [], loadedReadonly = t?.meta?.loadedAddresses?.readonly ?? [];
  if (!t?.meta || !Array.isArray(keys) || !header || !Array.isArray(message?.instructions) || !Array.isArray(t.meta.innerInstructions) ||
      !Array.isArray(loadedWritable) || !Array.isArray(loadedReadonly)) return null;
  const all = [...keys, ...loadedWritable, ...loadedReadonly];
  const index = all.indexOf(pool.pool);
  const signed = Number(header.numRequiredSignatures), readonlySigned = Number(header.numReadonlySignedAccounts),
    readonlyUnsigned = Number(header.numReadonlyUnsignedAccounts);
  const writable = index >= 0 && (index < keys.length ? index < signed - readonlySigned || index >= signed && index < keys.length - readonlyUnsigned
    : index < keys.length + loadedWritable.length);
  const inner = new Map<number, Ix[]>();
  for (const entry of t.meta.innerInstructions as { index?: unknown; instructions?: unknown }[]) {
    if (typeof entry?.index !== "number" || !Array.isArray(entry.instructions)) return null;
    inner.set(entry.index, entry.instructions as Ix[]);
  }
  const invocations = (message.instructions as Ix[]).flatMap((ix, i) => [ix, ...(inner.get(i) ?? [])]);
  const touches = invocations.map((ix) => all[Number(ix?.programIdIndex)] === pool.programId && Array.isArray(ix.accounts) && ix.accounts.includes(index));
  if (index < 0 || !touches.includes(true)) return null;
  const slot = typeof t.slot === "bigint" ? t.slot : typeof t.slot === "number" && Number.isSafeInteger(t.slot) ? BigInt(t.slot) : null;
  if (t.meta.err !== null || slot === null || !writable || !Array.isArray(t.meta.logMessages)) return { slot: null };
  const stack: number[] = []; const succeeded: boolean[] = []; let next = 0;
  for (const log of t.meta.logMessages) {
    const m = typeof log === "string" ? /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (invoke \[\d+\]$|success$|failed)/.exec(log) : null;
    if (!m) continue;
    if (m[2]!.startsWith("invoke")) {
      if (next >= invocations.length || all[Number(invocations[next]!.programIdIndex)] !== m[1]) return { slot: null };
      stack.push(next++);
    } else {
      const open = stack.pop();
      if (open === undefined || all[Number(invocations[open]!.programIdIndex)] !== m[1]) return { slot: null };
      succeeded[open] = m[2] === "success";
    }
  }
  if (next !== invocations.length || stack.length) return { slot: null };
  return { slot: touches.some((hit, i) => hit && succeeded[i] === true) ? slot : null };
}

async function provenDexActivitySlot(rpc: MimirBetaDexActivityRpc, pool: MimirBetaEligiblePool): Promise<bigint | null> {
  if (!rpc.getSignaturesForAddress || !rpc.getTransaction) return null;
  const list = await rpc.getSignaturesForAddress(pool.pool, { commitment: "finalized", limit: DEX_ACTIVITY_SIGNATURES }).send().catch(() => null);
  if (!Array.isArray(list)) return null;
  let candidates = 0;
  for (const entry of list.slice(0, DEX_ACTIVITY_SIGNATURES) as { signature?: unknown; err?: unknown }[]) {
    if (!entry || entry.err !== null || typeof entry.signature !== "string") continue;
    const response = await rpc.getTransaction(entry.signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 1 })
      .send().catch(() => null);
    const evidence = dexActivityEvidence(response, pool);
    if (evidence === null) continue;
    if (evidence.slot !== null) return evidence.slot;
    if (++candidates >= DEX_ACTIVITY_VERIFICATIONS) break;
  }
  return null;
}

/**
 * Every-leg eligibility of an embedded SOL/USDC converter: admitted native recipe, ready native history at chain time, and a recent pool
 * trade within `maxActivityAgeSlots` of the evaluation slot, proven by a verified successful DEX transaction writing the pool. Whole Clock
 * seconds do not bound slots (a second may span any number of slots), so a native observation age never stands in for the trade slot.
 * Readiness is not a reservation.
 */
export async function evaluateMimirBetaConverterLegs(a: Readonly<{ rpc: MimirBetaPlanningRpc & MimirBetaDexActivityRpc; cluster: MimirGenerationCluster;
  feedId: Address; sourceConfig: Address; pools: readonly MimirBetaEligiblePool[]; maxActivityAgeSlots: number; minContextSlot: bigint }>): Promise<MimirBetaConverterEligibility> {
  const admitted = (pool: MimirBetaEligiblePool) => MIMIR_CLASSIC_ADMITTED_CONVERTER_RECIPES.some((recipe) =>
    recipe.adapterType === pool.creation.adapterType && recipe.adapterVersion === pool.creation.adapterVersion);
  const observations = await Promise.all(a.pools.map(async (pool) => admitted(pool) ? (await mimirClassicNativeTail(pool))[0]! : null));
  const reads = [...new Set([MIMIR_NATIVE_CLOCK_ADDRESS, ...a.pools.map(({ pool }) => pool),
    ...observations.filter((value): value is Address => value !== null)])];
  const limit = BigInt(a.maxActivityAgeSlots);
  const judge = (cohort: Awaited<ReturnType<FinalizedRpcReader["accounts"]>>, activity: readonly (bigint | null)[]): MimirBetaConverterEligibility => {
    const rows = new Map(reads.map((entry, i) => [entry, cohort.value[i] ?? null] as const));
    const nowUnix = mimirAuthenticClockUnix(rows.get(MIMIR_NATIVE_CLOCK_ADDRESS), cohort.slot, "converter eligibility Clock is not authentic");
    const legs = a.pools.map((pool, row): MimirBetaConverterLegEligibility => {
      const base = { row, pool: pool.pool, family: pool.family };
      if (!admitted(pool)) return { ...base, eligible: false, reason: "recipe-unsupported", nativeAgeSecs: null, lastActivitySlot: null, activityAgeSlots: null };
      let readiness: MimirClassicNativeReadiness | null = null;
      try {
        readiness = mimirClassicNativeRowReadiness({ row, pool, poolAccount: rows.get(pool.pool), observation: observations[row]!,
          observationAccount: rows.get(observations[row]!), nowUnix, cluster: a.cluster });
      } catch (error) { if (!(error instanceof MimirBetaError)) throw error; }
      const last = activity[row] ?? null;
      const age = last === null ? null : cohort.slot - last;
      const reason = !readiness?.ready || readiness.ageSecs < 0n ? "native-not-ready" as const : last === null ? "activity-unproven" as const
        : age! < 0n || age! > limit ? "activity-stale" as const : null;
      return { ...base, eligible: reason === null, reason, nativeAgeSecs: readiness?.ageSecs ?? null, lastActivitySlot: last, activityAgeSlots: age };
    });
    const eligible = legs.length > 0 && legs.every((leg) => leg.eligible);
    return { feedId: a.feedId, sourceConfig: a.sourceConfig, slot: cohort.slot, maxActivityAgeSlots: limit, eligible, legs,
      headroomSlots: eligible ? legs.reduce((min, leg) => limit - leg.activityAgeSlots! < min ? limit - leg.activityAgeSlots! : min, limit) : null };
  };
  let cohort = await new FinalizedRpcReader(a.rpc).accounts(reads, a.minContextSlot);
  const native = judge(cohort, []);
  if (!native.legs.some((leg) => leg.reason === "activity-unproven")) return native;
  const activity = await Promise.all(a.pools.map((pool, row) => native.legs[row]!.eligible || native.legs[row]!.reason === "activity-unproven"
    ? provenDexActivitySlot(a.rpc, pool) : null));
  const floor = activity.reduce<bigint>((slot, value) => value !== null && value > slot ? value : slot, a.minContextSlot);
  if (floor > cohort.slot) cohort = await new FinalizedRpcReader(a.rpc).accounts(reads, floor);
  return judge(cohort, activity);
}

/** Converter choice order: eligible first, single-source first, then weakest-leg activity headroom, then feed identity. */
export function rankMimirBetaConverterEligibility(candidates: readonly MimirBetaConverterEligibility[]): readonly MimirBetaConverterEligibility[] {
  return [...candidates].sort((x, y) => Number(y.eligible) - Number(x.eligible) || Number(x.legs.length !== 1) - Number(y.legs.length !== 1) ||
    ((y.headroomSlots ?? -1n) > (x.headroomSlots ?? -1n) ? 1 : (y.headroomSlots ?? -1n) < (x.headroomSlots ?? -1n) ? -1 : 0) ||
    (x.feedId < y.feedId ? -1 : x.feedId > y.feedId ? 1 : 0));
}

export interface PrepareMimirClassicExecutionAttachArgs {
  readonly payer: Address;
  readonly feedId: Address;
  /** Exact ordered primary pool set of the existing live classic feed. */
  readonly pools: readonly MimirBetaEligiblePool[];
  /** Explicit recipe per primary row: required for a CPMM row, `null` for every other family (existing derivation). */
  readonly recipes: readonly (MimirClassicCpmmRecipe | null)[];
  readonly declaredMaxSnapshotAge: number;
  /** Verified ABI-1 capability; required off localnet. */
  readonly capability?: MimirAbi1Capability;
  readonly consumerAdmission?: MimirConsumerAdmissionInputsV1;
}

export interface MimirClassicNativeReadiness {
  readonly row: number; readonly observation: Address; readonly ready: boolean;
  readonly readyAtUnixTs?: bigint;
  readonly lastUpdate: bigint; readonly ageSecs: bigint; readonly maxEligibleSpanSecs: bigint | null; readonly oldestSpanSecs: bigint;
  /** CLMM/DLMM parser refusal when not ready. */
  readonly reason?: MimirNativeTwapUnavailableReason;
}

/** `ready`; `history-rebuilding`: fresh DEX updates but the native window is still short; `waiting-for-activity`: the DEX oracle is stale. */
export type MimirClassicNativeRebuildState = "ready" | "history-rebuilding" | "waiting-for-activity";

/**
 * Display state of a native row. DLMM `aboutSecs` is the remaining connected span to 240 s assuming uninterrupted <=120 s records; a new
 * gap restarts it. Other families carry no estimate. Not a readiness promise.
 */
export function mimirClassicNativeRebuild(adapterType: number, readiness: MimirClassicNativeReadiness):
  Readonly<{ state: MimirClassicNativeRebuildState; aboutSecs: bigint | null }> {
  if (readiness.ready && readiness.ageSecs >= 0n) return { state: "ready", aboutSecs: 0n };
  if (readiness.readyAtUnixTs !== undefined) return { state: "history-rebuilding", aboutSecs: readiness.readyAtUnixTs - readiness.lastUpdate - readiness.ageSecs };
  if (readiness.reason === "stale-oracle" || readiness.reason === "missing-oracle" ||
      readiness.ageSecs > (adapterType === 3 ? 120n : BigInt(METEORA_DLMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS))) return { state: "waiting-for-activity", aboutSecs: null };
  if (adapterType !== 3) return { state: "history-rebuilding", aboutSecs: null };
  const span = readiness.reason === "history-too-short" ? readiness.oldestSpanSecs : 0n;
  const window = BigInt(METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS);
  return { state: "history-rebuilding", aboutSecs: span >= window ? null : window - span };
}

/**
 * Program-parity CPMM native-history readiness (e9e904e `native_cpmm_history_ready`): an entry with span in [134, 1800] s before the end,
 * where the end is the last update, or now once the last update is > 60 s old. `readyAtUnixTs`: the oldest entry under 134 s + 134, when no
 * entry is eligible yet; none when no entry is within 1800 s.
 */
export function mimirClassicCpmmNativeReadiness(data: Uint8Array, nowUnix: bigint, dual = false): Omit<MimirClassicNativeReadiness, "row" | "observation"> {
  if (data.length !== 4_075) return betaError("ACCOUNT_MALFORMED", "CPMM observation length");
  if (dual && mimirCpmmObservationCanonicalEmpty(data)) {
    return { ready: false, lastUpdate: 0n, ageSecs: nowUnix, maxEligibleSpanSecs: null, oldestSpanSecs: 0n };
  }
  const v = new DataView(data.buffer, data.byteOffset, data.length);
  const latest = v.getUint16(9, true); const ts = (i: number) => v.getBigUint64(43 + 40 * i, true);
  const lastUpdate = v.getBigUint64(43 + 4_000, true); const created = latest < 100 ? ts(latest) : 0n;
  if (latest >= 100 || created === 0n || created > lastUpdate || lastUpdate > nowUnix || lastUpdate - created >= 15n) {
    return betaError("PLAN_STALE", "CPMM observation history is unsound");
  }
  const end = nowUnix - lastUpdate > 60n ? nowUnix : lastUpdate;
  let previous = 0n; let oldest = 0n; let maxEligible: bigint | null = null; let recent: bigint | null = null;
  for (let step = 1; step <= 100; step += 1) {
    const i = (latest + step) % 100; const t = ts(i);
    if (t === 0n) {
      if (previous !== 0n || data.subarray(43 + 40 * i, 83 + 40 * i).some(Boolean)) betaError("PLAN_STALE", "CPMM observation history is unsound");
      continue;
    }
    if (t <= previous || t > lastUpdate) betaError("PLAN_STALE", "CPMM observation history is unsound");
    if (oldest === 0n) oldest = t;
    const span = end - t;
    if (span >= 134n && span <= 1_800n && (maxEligible === null || span > maxEligible)) maxEligible = span;
    if (span < 134n && recent === null) recent = t;
    previous = t;
  }
  const readyAt = recent === null ? null : end === lastUpdate && recent + 134n < lastUpdate + 61n ? lastUpdate + 61n : recent + 134n;
  return { ready: maxEligible !== null, ...(maxEligible === null && readyAt !== null ? { readyAtUnixTs: readyAt } : {}),
    lastUpdate, ageSecs: nowUnix - lastUpdate, maxEligibleSpanSecs: maxEligible, oldestSpanSecs: end - oldest };
}

/**
 * Attach a ClassicExecutionV1 to an existing live classic feed in one transaction: `[90 BEGIN, (90 GROW), 90 SEAL, 89]`, with tag 89
 * publishing `r -> r+1` from the current public snapshot revision (sample-only `r -> r` when a row needs warm-up). Refuses an existing
 * execution account and a not-ready CPMM native history; never substitutes another recipe.
 */
export async function prepareMimirClassicExecutionAttach(dependencies: MimirBetaLiveDependencies & Readonly<{
  abi1Capability?: MimirAbi1Capability; abi1ReleaseRecipeScope?: boolean; consumerAdmission?: MimirConsumerAdmissionInputsV1 }>, args: PrepareMimirClassicExecutionAttachArgs,
  commitment: "confirmed" | "finalized" = "confirmed") {
  let payer: Address;
  try { payer = address(args.payer); } catch { return betaError("INVALID_ARGUMENT", "classic attach payer is invalid"); }
  if (!Array.isArray(args.recipes) || args.recipes.length !== args.pools?.length) betaError("INVALID_ARGUMENT", "classic attach needs one recipe per primary pool");
  const loaded = await loadMimirBetaExistingLiveFeed(dependencies, args.pools, undefined, true, commitment, undefined, false, args.feedId);
  const program = dependencies.deployment.mimirProgramId;
  const [execution] = await deriveMimirClassicExecutionAddress(program, addressBytes(loaded.feedId));
  const read = await readMimirBetaAccountCohort(dependencies.rpc, [execution, loaded.pdas.snapshot[0], MIMIR_NATIVE_CLOCK_ADDRESS,
    ...mimirClassicAttachObservations(loaded, args.recipes).map((o) => o.observation), ...mimirClassicAttachIntervalReads(loaded, args.recipes),
    loaded.pdas.collateralLock[0]], commitment, loaded.coherentSlot);
  const built = await mimirClassicExecutionAttachFromState({ loaded, read, lock: read.value.at(-1) ?? null, program, payer, recipes: args.recipes,
    declaredMaxSnapshotAge: args.declaredMaxSnapshotAge });
  const capability = args.capability ?? dependencies.abi1Capability;
  assertMimirAbi1Capable({ cluster: dependencies.deployment.cluster, programId: program, ...(capability ? { capability } : {}),
    releaseRecipeScope: dependencies.abi1ReleaseRecipeScope, recipes: built.recipes, action: "init", executionKind: "classic", converterSourceCount: 0 });
  const admissionInputs = args.consumerAdmission ?? dependencies.consumerAdmission ?? {};
  const cu = await verifyMimirCuEvidenceA2({ ...(capability ? { capability } : {}), action: "init", payer, instructions: built.instructions,
    evidence: admissionInputs.initializerCu ?? null });
  const view = { payer, instructions: built.instructions, cu };
  const consumerAdmission = await preflightMimirConsumerAdmissionV1({ ...admissionInputs, ...(capability ? { capability } : {}),
    cell: mimirClassicCellSignature(built.descriptors, built.descriptors.length), initializer: view, freshCreation: view });
  const blockhash = parseBlockhash(await dependencies.rpc.getLatestBlockhash({ commitment }).send());
  const transaction = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: blockhash.blockhash,
    lastValidBlockHeight: blockhash.lastValidBlockHeight, instructions: built.instructions });
  const simulation = await simulateExact(dependencies.rpc, transaction.serializedTransaction, read.slot, program, commitment);
  if (dependencies.deployment.cluster === "mainnet-beta") assertMimirStrictSimulation(transaction, { err: null, unitsConsumed: simulation.unitsConsumed });
  const { recipes: _recipes, ...rest } = built;
  return Object.freeze({ schema: "mimir-beta-prepared-classic-attach" as const, version: 1 as const, ...rest, transaction, simulation, consumerAdmission });
}

const mimirClassicAttachObservations = (loaded: Pick<LoadedLiveFeed, "adapterAccounts">, recipes: readonly (MimirClassicCpmmRecipe | null)[]) =>
  recipes.flatMap((r, i) => r === "native-bounded" ? [{ row: i, observation: loaded.adapterAccounts[i]![4]! }] : []);

const mimirClassicAttachIntervalReads = (loaded: Pick<LoadedLiveFeed, "pools" | "generationCluster">, recipes: readonly (MimirClassicCpmmRecipe | null)[]) =>
  [...new Set(recipes.flatMap((r, i) => isMimirClassicIntervalRecipe(r)
    ? [...mimirClassicIntervalPins(r, loaded.generationCluster), ...(r !== "cpmm-quiet-interval-v2" ? [loaded.pools[i]!.pool] : [])] : []))];

/** @internal Pure attach build from an authenticated existing-feed closure and one coherent `[execution, snapshot, Clock, ...observations]` read. */
export async function mimirClassicExecutionAttachFromState(a: Readonly<{
  loaded: Pick<LoadedLiveFeed, "feedId" | "pdas" | "canonical" | "plan" | "feed" | "pools" | "adapterAccounts" | "sourceStates" | "artifacts" |
    "generationCluster">;
  read: Readonly<{ slot: bigint; value: readonly (MimirBetaAccount | null)[] }>; lock: MimirBetaAccount | null; program: Address; payer: Address;
  recipes: readonly (MimirClassicCpmmRecipe | null)[]; declaredMaxSnapshotAge: number;
}>) {
  const { loaded, read, program, payer } = a;
  assertMimirInitPayerIsFeedCreator(a.lock?.owner === program ? a.lock.data : null, payer, loaded.pdas.collateralLock[0]);
  if (a.recipes.length !== loaded.pools.length) betaError("INVALID_ARGUMENT", "classic attach needs one recipe per primary pool");
  loaded.pools.forEach((pool, i) => {
    const r = a.recipes[i];
    if (isMimirClassicIntervalRecipe(r) ? INTERVAL_FAMILY[r] !== pool.creation.adapterType || pool.creation.adapterVersion !== 0
      : pool.creation.adapterType === 2 ? !["spot", "native-bounded"].includes(r as string) : r !== null) {
      betaError("INVALID_ARGUMENT", `classic attach recipe ${String(r)} is not admitted for row ${i}`, pool.pool);
    }
  });
  if (loaded.plan.minSources > loaded.pools.length) betaError("PLAN_STALE", "classic attach plan quorum exceeds the pool set");
  const [execution] = await deriveMimirClassicExecutionAddress(program, addressBytes(loaded.feedId));
  const observations = mimirClassicAttachObservations(loaded, a.recipes);
  const envelope = read.value[0];
  if (envelope?.owner === program) betaError("CLASSIC_EXECUTION_EXISTS", "classic execution already exists; a sealed execution is never resealed", execution);
  if (envelope && (envelope.owner !== "11111111111111111111111111111111" || envelope.executable || envelope.data.length !== 0)) {
    betaError("ACCOUNT_MALFORMED", "classic execution envelope is not an empty system account", execution);
  }
  const snapshot = exactProgramAccount(read.value[1], program, 512, "feed snapshot");
  const clock = read.value[2];
  if (!clock || clock.owner !== "Sysvar1111111111111111111111111111111111111" || clock.data.length !== 40 ||
      new DataView(clock.data.buffer, clock.data.byteOffset).getBigUint64(0, true) !== read.slot) {
    betaError("RPC_CONTEXT_MISMATCH", "classic attach Clock is not authentic");
  }
  const nowUnix = new DataView(clock!.data.buffer, clock!.data.byteOffset).getBigInt64(32, true);
  const readiness: MimirClassicNativeReadiness[] = observations.map((o, j) => {
    const pool = loaded.pools[o.row]!;
    const account = exactProgramAccount(read.value[3 + j], pool.programId, 4_075, "CPMM observation");
    if (!bytesEqual(account.data.subarray(11, 43), addressBytes(pool.pool))) betaError("PLAN_STALE", "CPMM observation identity changed", o.observation);
    return { ...o, ...mimirClassicCpmmNativeReadiness(account.data, nowUnix) };
  });
  const notReady = readiness.find((r) => !r.ready);
  if (notReady) {
    throw new MimirClassicNativeNotReadyError(notReady);
  }
  const intervalRows = new Map(mimirClassicAttachIntervalReads(loaded, a.recipes).map((address, j) => [address, read.value[3 + observations.length + j] ?? null] as const));
  a.recipes.forEach((r, row) => { if (r === "damm-onlyb-interval-v1" || r === "damm-reserve-interval-v3") assertMimirClassicDammRecipePolicy({ row,
    version: r === "damm-onlyb-interval-v1" ? 1 : 3, pool: loaded.pools[row]!.pool, poolAccount: intervalRows.get(loaded.pools[row]!.pool) }); });
  a.recipes.forEach((r) => { if (isMimirClassicIntervalRecipe(r)) assertMimirClassicIntervalGeneration(r, intervalRows, loaded.generationCluster); });
  const rows = loaded.pools.map((pool, i) => {
    const state = loaded.sourceStates[i]!; const artifact = loaded.artifacts.artifacts[i]!;
    const point = state.source.temporalMode === "current-point"; const recipe = a.recipes[i];
    const accounts = loaded.adapterAccounts[i]!;
    const interval = isMimirClassicIntervalRecipe(recipe) ? mimirClassicIntervalRow({ adapterType: pool.creation.adapterType,
      adapterVersion: pool.creation.adapterVersion, adapterAccounts: accounts, recipe, cluster: loaded.generationCluster, pool: pool.pool }) : null;
    return mimirClassicRow({ role: "primary", adapterType: pool.creation.adapterType, adapterVersion: pool.creation.adapterVersion, currentPoint: point,
      cluster: loaded.generationCluster, accountsBindingVersion: loaded.plan.accountsBindingVersion, sourceConfig: artifact.sourceConfig,
      feedConfig: loaded.pdas.feed[0], sourcingPlan: loaded.pdas.sourcingPlan[0], ...interval?.temporal ? { temporal: interval.temporal } : {},
      adapterAccounts: interval ? interval.adapterAccounts : recipe === "native-bounded" ? accounts.slice(0, 5) : recipe ? accounts.slice(0, 4) : accounts,
      witness: { feedId: addressBytes(loaded.feedId), sourceIndex: i, ringVersion: loaded.plan.ringVersion, minSlotGap: point ? 0 : 1,
        expectedSourceConfigRevision: state.source.sourceConfigRevision, expectedSourceSetRevision: state.source.sourceSetRevision,
        expectedPlanHash: loaded.plan.planHash, sourceSetSiblings: artifact.sourceRootProof, accountsSiblings: artifact.accountRootProof } });
  });
  const layout = mimirClassicExecutionLayout(rows.map(({ recipe }) => recipe), []);
  const warm = layout.descriptors.some((d, r) => mimirFusedRecipeNeedsWarmup(d) &&
    (d.moduleLength !== 0 || (loaded.plan.minSources < layout.componentCount && r < layout.componentCount)));
  if (!warm) a.recipes.forEach((r, row) => {
    if (r !== "orca-marker-quiet") return;
    const marker = mimirClassicOrcaMarkerReadiness({ row, pool: loaded.pools[row]!.pool, poolAccount: intervalRows.get(loaded.pools[row]!.pool),
      nowUnix, cluster: loaded.generationCluster });
    if (!marker.ready) throw new MimirClassicNativeNotReadyError(marker);
  });
  const previous = new DataView(snapshot.data.buffer, snapshot.data.byteOffset).getBigUint64(96, true);
  const next = warm ? previous : previous + 1n;
  const closure = buildMimirInitFusedClassicClosure({ programId: program, payer, execution, collateralLock: loaded.pdas.collateralLock[0], snapshot: loaded.pdas.snapshot[0],
    feedConfig: loaded.pdas.feed[0], sourcingPlan: loaded.pdas.sourcingPlan[0], registry: loaded.canonical.registry[0],
    feedId: addressBytes(loaded.feedId), layout, witnesses: rows.map(({ witness }) => witness), primary: rows });
  const publish = buildMimirFusedClassicInstruction({ programId: program, snapshot: loaded.pdas.snapshot[0], registry: loaded.canonical.registry[0],
    execution, layout, primaryExternals: rows.map(({ externals }) => externals), converterExternals: [],
    request: { feedId: addressBytes(loaded.feedId), declaredMaxSnapshotAge: a.declaredMaxSnapshotAge, previousSnapshotRevision: previous,
      nextSnapshotRevision: next, componentCount: rows.length, sourceSetRevision: loaded.sourceStates[0]!.source.sourceSetRevision,
      planHash: loaded.plan.planHash, converterSourceCount: 0, feedConfigRevision: loaded.feed.feedConfigRevision, ringNewestSlots: rows.map(() => 0n) } });
  return { feedId: loaded.feedId, execution, snapshot: loaded.pdas.snapshot[0], contextSlot: read.slot, clockUnix: nowUnix,
    mode: warm ? "sample" as const : "publish" as const, previousSnapshotRevision: previous, nextSnapshotRevision: next,
    recipes: rows.map(({ recipe }) => recipe), descriptors: layout.descriptors, exactLength: layout.exactLength, readiness,
    instructions: [...closure, publish] };
}

export class MimirClassicNativeNotReadyError extends MimirBetaError {
  constructor(readonly readiness: MimirClassicNativeReadiness, readonly activated = false) {
    super("CLASSIC_NATIVE_NOT_READY", `${activated ? "activation done; waiting for a fresh swap to publish: " : ""}row ${readiness.row} native history not ready (age ${readiness.ageSecs}s, ` +
      `eligible span ${readiness.maxEligibleSpanSecs ?? "none"}, oldest span ${readiness.oldestSpanSecs}s)`, readiness.observation);
    this.name = "MimirClassicNativeNotReadyError";
  }
}
brand("@quantulabs/mimir-sdk/beta:MimirClassicNativeNotReadyError", MimirClassicNativeNotReadyError);

/** @internal Gather ordered mono/multi preparations into one exact post-account simulation. */
export async function runMimirBetaRefreshEvidenceCohort<T>(
  dependencies: MimirBetaLiveDependencies, payer: Address,
  preparations: readonly ((cohort: MimirBetaMonoSimulationCohort) => Promise<T>)[],
  commitment: "confirmed" | "finalized" = "confirmed",
): Promise<readonly T[]> {
  if (preparations.length < 1 || preparations.length > 3) betaError("INVALID_ARGUMENT", "refresh cohort must contain 1..3 feeds");
  const blockhash = Promise.resolve().then(() => dependencies.rpc.getLatestBlockhash({ commitment }).send()).then(parseBlockhash);
  void blockhash.catch(() => {});
  type Request = Parameters<MimirBetaMonoSimulationCohort["simulate"]>[0];
  const requests: Request[] = new Array(preparations.length);
  const waiters: Array<{
    resolve(value: { simulation: MimirBetaSimulationFacts; accounts: readonly MimirBetaAccount[]; outsideSimulation: ReadonlySet<Address>; transaction: Awaited<ReturnType<typeof compileMimirBetaTransactionV1>> }): void;
    reject(error: unknown): void;
  }> = new Array(preparations.length);
  let running = false;
  let failure: unknown = null;
  let owner: number | null = null;
  const revised = new Set<number>();
  const run = async (): Promise<void> => {
    if (running || requests.filter(Boolean).length !== preparations.length) return;
    running = true;
    try {
      if (new Set(requests.map((request) => request.expectedProgram)).size !== 1) {
        betaError("INVALID_ARGUMENT", "mono refresh cohort must share one Mimir program");
      }
      const lifetime = await blockhash;
      const transaction = await compileMimirBetaTransactionV1({ feePayer: payer,
        recentBlockhash: lifetime.blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight,
        instructions: requests.flatMap((request) => [...request.instructions]) });
      if (transaction.requiredSigners.length !== 1 || transaction.requiredSigners[0] !== payer) {
        betaError("PROGRAM_ABI_MISMATCH", "refresh cohort must have exactly one payer signer");
      }
      const addresses = [...new Set(requests.flatMap((request) => [...request.addresses]))];
      const minContextSlot = requests.reduce((slot, request) => request.minContextSlot > slot ? request.minContextSlot : slot, 0n);
      const simulated = await simulateExactPostAccounts(dependencies.rpc, transaction.serializedTransaction,
        minContextSlot, requests[0]!.expectedProgram, addresses, commitment);
      if (dependencies.deployment.cluster === "mainnet-beta") assertMimirStrictSimulation(transaction, { err: null, unitsConsumed: simulated.simulation.unitsConsumed });
      const byAddress = new Map(addresses.map((entry, index) => [entry, simulated.accounts[index]!]));
      requests.forEach((request, index) => waiters[index]!.resolve({ simulation: simulated.simulation,
        transaction, accounts: request.addresses.map((entry) => byAddress.get(entry)!),
        outsideSimulation: new Set(request.addresses.filter((entry) => simulated.outsideSimulation.has(entry))) }));
    } catch (error) {
      let reason = error;
      if (error instanceof MimirBetaSimulationError && error.instructionIndex !== null) {
        let end = 0;
        owner = requests.findIndex((request) => error.instructionIndex! < (end += request.instructions.length));
        if (owner < 0) owner = null;
        const request = owner === null ? undefined : requests[owner];
        if (request?.revise && !revised.has(owner!)) {
          revised.add(owner!);
          try {
            const instructions = await request.revise(new MimirBetaSimulationError({ ...error,
              instructionIndex: error.instructionIndex - (end - request.instructions.length) }));
            if (instructions !== null) {
              requests[owner!] = { ...request, instructions };
              owner = null;
              running = false;
              return run();
            }
          } catch (cause) { reason = cause; }
        }
      }
      failure = reason;
      waiters.forEach((waiter) => waiter.reject(reason));
    }
  };
  const forIndex = (index: number): MimirBetaMonoSimulationCohort => ({
    blockhash,
    simulate(request) {
      if (failure !== null) return Promise.reject(failure);
      requests[index] = request;
      const promise = new Promise<{ simulation: MimirBetaSimulationFacts; accounts: readonly MimirBetaAccount[]; outsideSimulation: ReadonlySet<Address>; transaction: Awaited<ReturnType<typeof compileMimirBetaTransactionV1>> }>((resolve, reject) => {
        waiters[index] = { resolve, reject };
      });
      void run();
      return promise;
    },
  });
  const settled = await Promise.allSettled(preparations.map((prepare, index) => Promise.resolve().then(() => prepare(forIndex(index)))
    .catch(error => {
      if (failure === null) failure = error;
      waiters.forEach(waiter => waiter?.reject(error));
      throw error;
    })));
  const owned = owner === null ? undefined : settled[owner];
  if (owned?.status === "rejected") throw owned.reason;
  const rejected = settled.find((result) => result.status === "rejected");
  if (rejected) throw rejected.reason;
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}
