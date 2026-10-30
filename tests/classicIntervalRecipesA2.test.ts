import assert from "node:assert/strict";
import type { Address } from "@solana/kit";
import { MimirClassicNativeNotReadyError, mimirClassicOrcaMarkerReadiness, assertMimirClassicDammRecipePolicy, classicRowExternals, mimirClassicIntervalRow, type MimirClassicIntervalRecipe } from "../src/beta/live.js";
import { mimirClassicExecutionLayout, mimirClassicRow } from "../src/beta/classicExecution.js";
import { withMimirBetaPoolBindingVariant } from "../src/beta/discovery.js";
import { mimirExecutableGenerationPins, mimirOrcaWhirlpoolsConfigAddress, mimirVenueDeploymentUnix } from "../src/internal/nativeMonoRefreshCore.js";
import { addressBytes, bytesAddress } from "../src/beta/bytes.js";

// Explicit mode-3 arms seal their exact tuple; the recurring Orca marker vector carries its pins at 7/8; variants are per-pool and family-checked.
const key = (n: number) => bytesAddress(new Uint8Array(32).fill(n));
const base = Array.from({ length: 7 }, (_, i) => key(40 + i));
const witness = { feedId: new Uint8Array(32), sourceIndex: 0, ringVersion: 1, minSlotGap: 1, expectedSourceConfigRevision: 1n,
  expectedSourceSetRevision: 1n, expectedPlanHash: new Uint8Array(32), sourceSetSiblings: [], accountsSiblings: [] };
const arms: [MimirClassicIntervalRecipe, number, string][] = [["cpmm-quiet-interval-v2", 2, "2/0/3/1/7"], ["orca-marker-quiet", 0, "0/0/3/0/9"],
  ["damm-onlyb-interval-v1", 7, "7/0/3/2/5"], ["damm-reserve-interval-v3", 7, "7/0/3/3/5"]];
const descriptors = arms.map(([recipe, adapterType, tuple]) => {
  const tail = mimirClassicIntervalRow({ adapterType, adapterVersion: 0, adapterAccounts: base, recipe, cluster: "mainnet" });
  const row = mimirClassicRow({ role: "primary", adapterType, adapterVersion: 0, currentPoint: false, sourceConfig: key(1), feedConfig: key(2),
    sourcingPlan: key(3), adapterAccounts: tail.adapterAccounts, ...tail.temporal ? { temporal: tail.temporal } : {}, witness });
  const r = row.recipe;
  assert.equal(`${r.adapterType}/${r.adapterVersion}/${r.mode}/${r.temporalKind}/${r.externalWidth}`, tuple, recipe);
  return mimirClassicExecutionLayout([r], []).descriptors[0]!;
});
assert.throws(() => mimirClassicIntervalRow({ adapterType: 1, adapterVersion: 0, adapterAccounts: base, recipe: "orca-marker-quiet", cluster: "mainnet" }),
  (e: Error & { code?: string }) => e.code === "CLASSIC_RECIPE_UNSUPPORTED");
const orca = mimirExecutableGenerationPins("mainnet").orca;
const [refresh] = classicRowExternals([descriptors[1]!], { adapterAccounts: [base], cpmmPins: [key(31), key(32)], generationCluster: "mainnet" } as never);
assert.deepEqual(refresh, [...base, orca[0], orca[1]]);
const pool = (family: string) => ({ family, pool: key(5), creation: { bindingVariant: "direct", staticAccounts: [], tokenProgramId: key(6),
  token2022Mint: null, vaultAuthority: key(7), observationState: null } }) as never;
assert.equal(withMimirBetaPoolBindingVariant(pool("meteora-dlmm"), "routeable").creation.bindingVariant, "routeable");
assert.throws(() => withMimirBetaPoolBindingVariant(pool("raydium-cpmm"), "routeable"), (e: Error & { code?: string }) => e.code === "INVALID_ARGUMENT");
// DAMM temporal recipe must equal the pool policy: OnlyB mode1 -> v1, reserve mode0/layout1/compounding0 -> v3; anything else refuses.
const DAMM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG" as Address;
const damm = (mode: number, layout = 1, compounding = 0) => { const d = new Uint8Array(1112); d.set([241, 154, 109, 4, 17, 177, 109, 188]);
  d[360] = 2; d[552] = 1; // Eligible total/permanently locked liquidity.
  d[484] = mode; d[696] = layout; d[54] = compounding; return { address: key(5), owner: DAMM, executable: false, lamports: 1n, data: d }; };
const policy = (version: number, poolAccount: unknown) => assertMimirClassicDammRecipePolicy({ row: 0, version, pool: key(5), poolAccount: poolAccount as never });
const unsupported = (e: Error & { code?: string }) => e.code === "CLASSIC_RECIPE_UNSUPPORTED" && /v3 does not match pool policy (v1|unsupported)/.test(e.message);
assert.throws(() => policy(3, damm(1)), unsupported);
policy(3, damm(0)); policy(1, damm(1));
for (const [version, mode] of [[1, 1], [3, 0]] as const) {
  for (const locked of [0, 3]) {
    const pool = damm(mode); pool.data[552] = locked;
    assert.throws(() => policy(version, pool), (e: Error & { code?: string }) => e.code === "CLASSIC_RECIPE_UNSUPPORTED");
  }
  const pool = damm(mode); pool.data[552] = 2; policy(version, pool);
}
assert.throws(() => policy(1, damm(0)), (e: Error & { code?: string }) => e.code === "CLASSIC_RECIPE_UNSUPPORTED");
for (const pool of [damm(0, 0), damm(0, 1, 1), damm(2)]) assert.throws(() => policy(3, pool), unsupported);
assert.throws(() => policy(1, { ...damm(1), owner: key(9) }), (e: Error & { code?: string }) => e.code === "ACCOUNT_MALFORMED");
assert.throws(() => policy(1, null), (e: Error & { code?: string }) => e.code === "ACCOUNT_MALFORMED");
console.log("classic interval recipes A2 ok");

const deployment = mimirVenueDeploymentUnix("mainnet").orca;
const markerReadiness = (marker: bigint, nowUnix: bigint) => {
  const data = new Uint8Array(653); data.set([0x3f, 0x95, 0xd1, 0x0c, 0xe1, 0x80, 0x63, 0x09]);
  data.set(addressBytes(mimirOrcaWhirlpoolsConfigAddress("mainnet")), 8);
  new DataView(data.buffer).setBigUint64(261, marker, true);
  return mimirClassicOrcaMarkerReadiness({ row: 0, pool: key(5), nowUnix, cluster: "mainnet", poolAccount: { ...damm(0), data } });
};
const floor = markerReadiness(deployment - 1n, deployment);
assert.equal(floor.readyAtUnixTs, deployment + 121n);
const sameSecond = markerReadiness(deployment + 10n, deployment + 10n);
assert.equal(sameSecond.readyAtUnixTs, deployment + 131n);
assert.equal(sameSecond.oldestSpanSecs, 0n);
assert.equal(new MimirClassicNativeNotReadyError(sameSecond).readiness.readyAtUnixTs, deployment + 131n);
assert.equal(markerReadiness(deployment + 10n, deployment + 130n).ready, false);
assert.equal(markerReadiness(deployment + 10n, deployment + 131n).ready, true);
assert.throws(() => markerReadiness(0n, deployment), (e: Error & { code?: string }) => e.code === "PLAN_STALE");
assert.equal(markerReadiness(deployment + 10n, deployment).readyAtUnixTs, undefined);

{
  const { mimirClassicQuietPrimeOutcome } = await import("../src/beta/live.js");
  const a = (anchorSlot: bigint | null, anchorUnix: bigint | null, invalidated = false) => ({ row: 0, anchorSlot, anchorUnix, invalidated });
  const set = mimirClassicQuietPrimeOutcome([a(10n, 1_000n)], [a(20n, 1_050n)], 1_060n);
  assert.deepEqual([set.state, set.readyAtUnix, set.waitSecs], ["anchored", 1_170n, 110n], "a new A justifies waiting A+120 s");
  assert.deepEqual([mimirClassicQuietPrimeOutcome([a(null, null)], [a(20n, 1_050n)], 1_200n).waitSecs], [0n], "blank -> A set; matured wait is zero");
  assert.equal(mimirClassicQuietPrimeOutcome([a(10n, 1_000n)], [a(10n, 1_000n)], 1_060n).state, "not-anchored", "a confirmed sample that kept A proves nothing");
  assert.equal(mimirClassicQuietPrimeOutcome([a(null, null)], [a(null, null)], 1_060n).state, "not-anchored");
  const conditioned = mimirClassicQuietPrimeOutcome([a(10n, 1_000n)], [a(20n, 1_050n, true)], 1_060n);
  assert.deepEqual([conditioned.state, conditioned.waitSecs], ["conditioned", null], "an invalidated module never yields a wait");
  assert.throws(() => mimirClassicQuietPrimeOutcome([], [], 1n), /PLAN_STALE/);
  console.log("quiet prime state machine ok");
}
