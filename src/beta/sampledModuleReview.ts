import type { Address } from "@solana/kit";
import { betaError } from "./errors.js";
import { bytesAddress, bytesEqual, hex, utf8 } from "./bytes.js";
import { deriveMimirBetaPda } from "./abi.js";
import type { MimirBetaAccount } from "./types.js";
import type { MimirBetaSampledTransitionEvidence } from "./review.js";
import { FinalizedRpcReader } from "./rpc.js";
import { getMimirRentExemptLamports } from "./rent.js";
import type { MimirBetaPlanningRpc } from "./client.js";
import { decodeMimirSampledTemporalModule, MIMIR_SAMPLED_TEMPORAL_MODULE_V4,
  mimirSampledClosureFromRing, mimirSampledQualityLimits } from "../internal/sampledTemporalCore.js";
import { decodeMimirCurrentPointModule, MIMIR_CURRENT_POINT_MODULE, type MimirCurrentPointState } from "../internal/currentPointCore.js";

/** Typed point transitions: identical no-op, same-context advance (sequence+1, no clock regression) or authorized context reset (sequence 1). */
export function mimirCurrentPointTransitionValid(pre: MimirCurrentPointState, post: MimirCurrentPointState): boolean {
  if (!bytesEqual(pre.sourceConfig, post.sourceConfig) || post.record.slot < pre.record.slot) return false;
  if (!bytesEqual(pre.context, post.context)) return post.sequence === 1n;
  const identical = pre.record.slot === post.record.slot && pre.record.unixTs === post.record.unixTs &&
    pre.record.priceX64 === post.record.priceX64 && bytesEqual(pre.record.fingerprint, post.record.fingerprint);
  return identical ? post.sequence === pre.sequence : post.sequence === pre.sequence + 1n && post.record.unixTs >= pre.record.unixTs;
}

export async function sampledModuleSpecs(args: Readonly<{ specified: readonly Address[]; addresses: readonly Address[];
  writableAddresses: readonly Address[]; before: readonly (MimirBetaAccount | null)[]; after: readonly (MimirBetaAccount | null)[];
  payer: Address; programId: Address; rpc: MimirBetaPlanningRpc }>): Promise<readonly Readonly<{ kind: "account"; address: Address; transition: "create" | "write";
  ownerAfter: Address; dataLengthAfter: number; description: string; codec: "sampled-temporal-v4";
  sampledTransition: MimirBetaSampledTransitionEvidence }>[]> {
  const o = MIMIR_SAMPLED_TEMPORAL_MODULE_V4;
  const specified = new Set(args.specified);
  const rings = args.addresses.flatMap((address, index) => {
    const ring = args.after[index];
    return ring && ring.owner === args.programId && ring.data.length === 544 &&
      bytesEqual(ring.data.subarray(0, 8), utf8("MIMIRRNG")) ? [ring] : [];
  });
  const specs: { kind: "account"; address: Address; transition: "create" | "write"; ownerAfter: Address; dataLengthAfter: number; description: string;
    codec: "sampled-temporal-v4"; sampledTransition: MimirBetaSampledTransitionEvidence }[] = [];
  const account = async (address: Address): Promise<MimirBetaAccount | null> => {
    const index = args.addresses.indexOf(address);
    return index >= 0 ? args.after[index] ?? null : (await new FinalizedRpcReader(args.rpc).account(address)).value;
  };
  for (const address of args.writableAddresses) {
    if (specified.has(address)) continue;
    let ring: MimirBetaAccount | undefined;
    for (const candidate of rings) {
      const [module] = await deriveMimirBetaPda({ programId: args.programId, seed: "source_temporal",
        values: [candidate.data.subarray(16, 48), candidate.data.subarray(48, 49), Uint8Array.of(4, 0)] });
      if (module === address) { ring = candidate; break; }
    }
    if (!ring) continue;
    const index = args.addresses.indexOf(address);
    const pre = args.before[index] ?? null; const post = args.after[index] ?? null;
    if (!post || post.owner !== args.programId || post.executable || post.data.length !== o.length) {
      betaError("PROGRAM_ABI_MISMATCH", "MTP4 module post-state differs from current ABI", address);
    }
    if (pre === null) {
      if (await getMimirRentExemptLamports(args.rpc, o.length) !== post.lamports) betaError("SIMULATION_FAILED", "MTP4 module create lamports differ from rent", address);
    } else if (pre.owner !== args.programId || pre.executable || pre.data.length !== o.length || pre.lamports !== post.lamports) {
      betaError("PROGRAM_ABI_MISMATCH", "MTP4 module transition is not data-only", address);
    }
    const [feedAddress] = await deriveMimirBetaPda({ programId: args.programId, seed: "feed_config", values: [ring.data.subarray(16, 48)] });
    const feed = await account(feedAddress);
    if (!feed || feed.owner !== args.programId || feed.data.length !== 357) betaError("PROGRAM_ABI_MISMATCH", "MTP4 feed config is unavailable", feedAddress);
    let plan: MimirBetaAccount | null = null;
    for (const offset of [168, 200]) {
      const candidate = await account(bytesAddress(feed.data.subarray(offset, offset + 32)));
      if (candidate && candidate.owner === args.programId && candidate.data.length === 320 &&
        bytesEqual(candidate.data.subarray(196, 228), ring.data.subarray(280, 312))) { plan = candidate; break; }
    }
    if (!plan) betaError("PROGRAM_ABI_MISMATCH", "MTP4 sourcing plan is unavailable", address);
    const u16 = (data: Uint8Array, at: number) => data[at]! | (data[at + 1]! << 8);
    const limits = mimirSampledQualityLimits({ maxConfidenceBps: u16(feed.data, 126), maxDispersionBps: u16(feed.data, 128) },
      { maxDispersionBps: u16(plan.data, 58) });
    const point = post.data[16] === MIMIR_CURRENT_POINT_MODULE.kind;
    try {
      if (point) {
        const state = decodeMimirCurrentPointModule(post.data);
        const ringView = new DataView(ring.data.buffer, ring.data.byteOffset, ring.data.byteLength);
        if (ringView.getBigUint64(64, true) !== state.record.slot ||
          (ringView.getBigUint64(88, true) | (ringView.getBigUint64(96, true) << 64n)) !== state.record.priceX64 ||
          !bytesEqual(ring.data.subarray(184, 216), state.record.fingerprint) || (pre !== null && pre.data[16] === MIMIR_CURRENT_POINT_MODULE.kind &&
            !mimirCurrentPointTransitionValid(decodeMimirCurrentPointModule(pre.data), state))) throw new Error("InvalidPointTransition");
      } else decodeMimirSampledTemporalModule(post.data, mimirSampledClosureFromRing(post.data, ring.data), limits);
    } catch {
      betaError("SIMULATION_FAILED", "MTP4 module post-state fails codec validation", address);
    }
    const preRing = args.before[args.addresses.indexOf(ring.address)] ?? null;
    const payerIndex = args.addresses.indexOf(args.payer);
    if (pre === null && (args.before[payerIndex]?.lamports ?? 0n) - (args.after[payerIndex]?.lamports ?? 0n) < post.lamports) {
      betaError("SIMULATION_FAILED", "MTP4 module rent not paid by the transaction payer", address);
    }
    specs.push({ kind: "account", address, transition: pre === null ? "create" : "write", ownerAfter: args.programId, dataLengthAfter: o.length,
      description: `${pre === null ? "create" : "advance"} MTP4 ${point ? "current-point" : "sampled temporal"} module`, codec: "sampled-temporal-v4",
      sampledTransition: { ring: ring.address, preModuleHex: pre === null ? null : hex(pre.data),
        preRingHex: preRing === null ? null : hex(preRing.data), ...limits, ...(point ? { temporalMode: "current-point" as const } : {}) } });
  }
  return specs;
}
