import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Connection } from "@solana/web3.js";
import type { Address } from "@solana/kit";
import { mimirCompositeBelowFloorPublication } from "../src/refreshGroup.js";
import { encodeMimirFusedRefreshData } from "../src/beta/compositeExecution.js";
import { bytesAddress } from "../src/beta/bytes.js";
import { MimirBetaError } from "../src/beta/errors.js";

// Boundary probes: the simulated CSP post-state must be current at the simulation context and bound to the signed request.
const ages = { maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 150 };
let requested: { minContextSlot?: number } = {};
const connection = (data: Uint8Array, slot: bigint, account: object) => ({
  getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
  _rpcRequest: async (_method: string, args: unknown[]) => {
    requested = args[1] as typeof requested;
    return { result: { context: { slot: Number(slot) }, value: { err: null, logs: [], accounts: [{ executable: false, lamports: 1, rentEpoch: 0, ...account,
      data: [Buffer.from(data).toString("base64"), "base64"] }] } } };
  } }) as unknown as Connection;
const code = (p: Promise<unknown>) => p.then(() => "accepted", (e: unknown) => e instanceof MimirBetaError ? e.code : String(e));
const u64 = (b: Uint8Array, at: number) => Buffer.from(b).readBigUInt64LE(at);
const flip = (b: Uint8Array, at: number) => { const x = Uint8Array.from(b); x[at]! ^= 1; return x; };

// Parent probe: the complete 32-account tag-87 executed on the 0adaf281 ELF and its authentic Degraded CSP.
{
  const f = JSON.parse(readFileSync(new URL("./fixtures/compositeTag87Degraded0adaf281.json", import.meta.url), "utf8"));
  const post = Uint8Array.from(Buffer.from(f.postAccount.data[0], "base64"));
  const instruction = { programAddress: f.programId as Address, accounts: f.instruction.accounts, data: Uint8Array.from(Buffer.from(f.instruction.dataHex, "hex")) };
  const probe = (data: Uint8Array, slot: bigint, owner = f.programId) => mimirCompositeBelowFloorPublication(connection(data, slot, { owner }),
    { payer: f.payer, programId: f.programId, commitment: "confirmed", instruction, snapshot: f.snapshot, belowFloorSources: [7], minContextSlot: BigInt(f.slot), ageLimits: ages });
  assert.equal((await probe(post, BigInt(f.slot))).status, "degraded");
  assert.equal(requested.minContextSlot, f.slot);
  assert.equal(await code(probe(post, u64(post, 120) + 1n)), "accepted", "expired price, Degraded carry");
  assert.equal(await code(probe(flip(post, 16), BigInt(f.slot))), "COMPOSITE_PUBLICATION_NOT_FRESH", "wrong feed");
  assert.equal(await code(probe(post, BigInt(f.slot) - 1n)), "SIMULATION_FAILED", "context below planning floor");
  assert.equal(await code(probe(post, BigInt(f.slot), f.payer)), "COMPOSITE_PUBLICATION_NOT_FRESH", "wrong owner");
}

// Independent reproduction over the 0adaf281 converter cell.
{
  const c = JSON.parse(readFileSync(new URL("./fixtures/compositeDegraded0adaf281.json", import.meta.url), "utf8")).cases["197-clmm-converter"];
  const b = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));
  const pre = b(c.belowFloor.pre), post = b(c.belowFloor.post), fresh = b(c.recovered.post), p = u64(post, 112);
  const data = encodeMimirFusedRefreshData({ compositeFeedId: pre.subarray(16, 48), expectedConfigRevision: 1n, previousSnapshotRevision: u64(pre, 96),
    nextSnapshotRevision: u64(pre, 96) + 1n, componentSourceConfigRevisions: [1n], maxRefreshFeeLamports: 0n,
    componentRingNewestSlots: [u64(pre, 136)], converterRingNewestSlots: [u64(pre, 136)], maxReuseAgeSlots: 8 });
  const instruction = { programAddress: c.programId, data, accounts: [{ address: c.payer, isSigner: true, isWritable: true },
    { address: c.snapshot, isSigner: false, isWritable: true }, { address: bytesAddress(pre.subarray(48, 80)), isSigner: false, isWritable: false }] };
  const call = (bytes: Uint8Array, slot: bigint, account: object = {}, floor = 0n, limits = ages) => code(mimirCompositeBelowFloorPublication(
    connection(bytes, slot, { owner: c.programId, ...account }),
    { payer: c.payer, programId: c.programId, commitment: "confirmed", instruction, snapshot: c.snapshot, belowFloorSources: [7], minContextSlot: floor, ageLimits: limits }));
  const wrongConfigRevision = Uint8Array.from(post); Buffer.from(wrongConfigRevision.buffer).writeBigUInt64LE(2n, 88);
  const refused = "COMPOSITE_PUBLICATION_NOT_FRESH";
  for (const [name, got, want] of [
    ["nominal-degraded", await call(post, p), "accepted"],
    ["fresh-noop-reuse", await call(fresh, u64(fresh, 112)), "accepted"],
    ["expired-degraded", await call(post, u64(post, 120) + 1n), "accepted"],
    ["future-price-at-regressed-context", await call(post, 1n), refused],
    ["stale-component-degraded", await call(post, p, {}, 0n, { ...ages, maxComponentSnapshotAgeSlots: 5 }), "accepted"],
    ["too-old-publication", await call(post, p + 11n, {}, 0n, { ...ages, maxSnapshotAgeSlots: 10 }), refused],
    ["wrong-feed-id", await call(flip(post, 16), p), refused],
    ["wrong-config-address", await call(flip(post, 48), p), refused],
    ["wrong-config-revision", await call(wrongConfigRevision, p), refused],
    ["executable-snapshot", await call(post, p, { executable: true }), refused],
    ["same-slot-unchanged-fresh", await call(pre, u64(pre, 112)), "accepted"],
    ["unchanged-fresh-older-than-window", await call(pre, u64(pre, 112) + 11n, {}, 0n, { ...ages, maxSnapshotAgeSlots: 10 }), refused],
    ["expired-fresh", await call(fresh, u64(fresh, 120) + 1n), refused],
    ["context-below-floor", await call(post, p, {}, p + 1n), "SIMULATION_FAILED"],
    ["wrong-owner", await call(post, p, { owner: c.payer }), refused],
  ] as const) assert.equal(got, want, name);
  assert.notEqual(await call(post.subarray(0, 719), p), "accepted", "719-byte CSP");
}
console.log("compositePublicationBoundary: ok");
