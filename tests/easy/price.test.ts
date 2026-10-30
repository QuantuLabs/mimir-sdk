import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodePrice, getPrice, MimirError, MIMIR_PROGRAM_IDS, type MimirAccount } from "../../src/easy/index.js";
import { mergeFreshPrice } from "../../src/easy/refresh.js";
import { decodeV1ClassicFeed, decodeV1CompositeFeed } from "../../src/v1/decoders.js";
import { decodeMimirTickerClaim } from "../../src/beta/codecs.js";
import { buildMimirBetaComputeUnitLimitInstruction } from "../../src/beta/liveAbi.js";
import { MIMIR_COND, predictMimirDegradedSnapshot } from "../../src/liveness.js";

// Real hBYr mainnet accounts, captured read-only (tests/fixtures/hbyr/accounts.json).
const fx = JSON.parse(readFileSync(new URL("../fixtures/hbyr/accounts.json", import.meta.url), "utf8")) as {
  program: string; slot: number; accounts: Record<string, { magic: string; owner: string; executable: boolean; data: string }> };
const HBYR = "hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR", CLOSED = "hMuPDstPQEb5uaYc6d5N18Rz4srL1Bewc5fYibMimiR";
const SOL = "F5fXuWuVFwBF3eBVtFkxXS5PMY651uVQ1bL4W4mse5Qj", WALLST = "12f5JLW69u8tdcwipmUFoGFTtiNEwiFtP5gbyP7saFJp";
const account = (address: string): MimirAccount => { const a = fx.accounts[address]!; return { address, owner: a.owner, executable: a.executable, data: Buffer.from(a.data, "base64") }; };
const rejects = async (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: unknown) => e instanceof MimirError && e.code === code && e.retry === "never" ? true : assert.fail(`${code}: ${e}`));

assert.equal(MIMIR_PROGRAM_IDS.mainnet, HBYR);
assert.deepEqual(Object.keys(MIMIR_PROGRAM_IDS), ["mainnet"]);
const feeds = Object.keys(fx.accounts).filter((k) => fx.accounts[k]!.magic === "MIMIRSNP" || fx.accounts[k]!.magic === "MIMIRCSP");
const tickers = Object.values(fx.accounts).filter((a) => a.magic === "MIMIRTIK").map((a) => decodeMimirTickerClaim(Buffer.from(a.data, "base64")).config as string);
assert.equal(feeds.length, 16);
assert.deepEqual([...tickers].sort(), [...feeds].sort(), "every feed has its ticker");

// All 16 at the capture slot: every token feed is past validUntil (needs-refresh, still priced); WALLST is a Degraded NO_PRICE index.
for (const feed of feeds) {
  const p = await decodePrice(account(feed), { slot: fx.slot });
  assert.equal(p.feed, feed);
  assert.match(p.ticker, /^[A-Z0-9]{1,12}$/);
  assert.equal(p.live, false);
  const raw = account(feed).data;
  assert.equal(p.generation, (p.kind === "index" ? decodeV1CompositeFeed(raw) : decodeV1ClassicFeed(raw)).owner.generation);
  if (feed === WALLST) {
    assert.equal(p.status, "none"); assert.equal(p.price, null); assert.equal(p.priceX64, null); assert.equal(p.components?.length, 5);
  } else {
    assert.equal(p.status, "needs-refresh", p.ticker);
    assert.ok(p.price! > 0 && p.lowerX64! <= p.priceX64! && p.priceX64! <= p.upperX64! && p.validUntilSlot < BigInt(fx.slot), p.ticker);
    assert.equal(p.ageSlots, BigInt(fx.slot) - p.slot);
  }
}

// Fresh: the same SOL bytes read inside their validity window.
const sol = await decodePrice(account(SOL), { slot: 460423200n });
assert.deepEqual([sol.ticker, sol.kind, sol.quote, sol.status, sol.exponent, sol.mantissa, sol.ageSlots], ["SOL", "token", "USDC", "fresh", -8, 10389817691n, 17n]);
assert.ok(Math.abs(sol.price! - 103.898) < 0.001);
const index = await decodePrice(account("EjccovzYj9TW7xAYRV13TLPdqzFtfBgpprshXos2T6J1"), { slot: 461584944n });
assert.deepEqual([index.ticker, index.kind, index.status, index.components?.length], ["LAPEACE", "index", "fresh", 3]);
assert.ok(index.components!.every((c) => feeds.includes(c.feed) && c.quantity > 0));
assert.deepEqual([sol.mode, index.mode], ["standard", "current-point"]);

// Degraded: the program's carry of SOL keeps the old price and valid_until; never "fresh", even inside that window.
const degradedSol = account(SOL);
const pre = Uint8Array.from(degradedSol.data.subarray(0, 512));
degradedSol.data = Buffer.concat([predictMimirDegradedSnapshot(pre, { newRevision: 2n, minSources: 1, sourceCount: pre[252]!, snapshotSource: 5,
  clock: { slot: 460423190n, unixTs: 1_800_000_000n }, conditionFlags: MIMIR_COND.PAUSED, powersMask: 0, conditionedSources: 1 }), degradedSol.data.subarray(512)]);
const carried = await decodePrice(degradedSol, { slot: 460423200n });
assert.deepEqual([carried.status, carried.priceX64, carried.validUntilSlot, carried.slot], ["degraded", sol.priceX64, sol.validUntilSlot, sol.slot]);

// Authentication.
await rejects(decodePrice({ ...account(SOL), owner: "11111111111111111111111111111111" }, { slot: fx.slot }), "WRONG_OWNER");
await rejects(decodePrice({ ...account(SOL), executable: true }, { slot: fx.slot }), "EXECUTABLE");
await rejects(decodePrice({ ...account(SOL), address: "ApksDEdELjtXmbu7p8Jrvskx8YMbdWBkHNBijvxYSwEo" }, { slot: fx.slot }), "WRONG_ADDRESS");
await rejects(decodePrice({ ...account(SOL), data: account(SOL).data.subarray(0, 600) }, { slot: fx.slot }), "MALFORMED");
const LAPEACE = "EjccovzYj9TW7xAYRV13TLPdqzFtfBgpprshXos2T6J1";
const mutate = (address: string, f: (d: Buffer) => void) => { const a = account(address); a.data = Buffer.from(a.data); f(a.data as Buffer); return a; };
for (const f of [(d: Buffer) => { d[8] = 1; }, (d: Buffer) => { d.fill(0, 200, 216); }]) await rejects(decodePrice(mutate(LAPEACE, f), { slot: 461584944n }), "MALFORMED");
for (const f of [(d: Buffer) => { d[8] = 1; }, (d: Buffer) => { d.fill(0, 216, 232); }, (d: Buffer) => { d.fill(0, 232, 248); }]) await rejects(decodePrice(mutate(SOL, f), { slot: 460423200n }), "MALFORMED");
assert.equal((await decodePrice(mutate(LAPEACE, (d) => { d.fill(0, 96, 104); }), { slot: 461584944n })).status, "none", "revision zero = constructing");
await rejects(decodePrice(account(SOL), { slot: fx.slot, generation: 1n }), "GENERATION_MISMATCH");
assert.equal((await decodePrice(account(SOL), { slot: fx.slot, generation: 482788690100224n })).ticker, "SOL");
await rejects(decodePrice({ ...account(SOL), owner: CLOSED }, { slot: fx.slot, program: CLOSED }), "CLOSED_PROGRAM");
await rejects(decodePrice({ ...account(SOL), owner: CLOSED }, { slot: fx.slot }), "CLOSED_PROGRAM");
await rejects(getPrice("SOL", { program: CLOSED, rpc: "http://127.0.0.1:9" }), "CLOSED_PROGRAM");

// MimirError retry classes over the program error parser.
const err = (code: number) => MimirError.from({ message: `Program ${HBYR} failed: custom program error: 0x${code.toString(16)}` });
assert.deepEqual([14, 56, 130, 3].map((c) => [err(c).name, err(c).retry]),
  [["StaleSnapshot", "after-refresh"], ["NonMonotonicSourceRing", "now"], ["VenueSourceUnavailable", "later"], ["InvalidAccountOwner", "never"]]);
assert.match(err(130).hint, /venue/);
assert.deepEqual([84, 88].map((c) => err(c).name), ["InvalidIdentityOwner", "PumpSwapBoostPending"]);
const logless = { message: JSON.stringify({ InstructionError: [1, { Custom: 14 }] }), logs: [] };
assert.equal(MimirError.from(logless).code, "UNKNOWN", "a log-less custom error is not attributed by default");
assert.equal(MimirError.from(logless, { instructions: [{ programAddress: "x" }, { programAddress: HBYR }] }).name, "StaleSnapshot");
assert.equal(MimirError.from(logless, { instructions: [{ programAddress: HBYR }, { programAddress: "x" }] }).code, "UNKNOWN");
assert.deepEqual([MimirError.from(new Error("429 Too Many Requests: {}")), MimirError.from(new Error("Signature x has expired: block height exceeded.")),
  MimirError.from(Object.assign(new Error("PLAN_STALE:moved"), { code: "PLAN_STALE" }))].map((e) => [e.code, e.retry]), [["RPC", "later"], ["EXPIRED", "now"], ["PLAN_STALE", "now"]]);

// withFreshPrice: one merged budget first, refresh, then the consumer with nothing in between.
const ix = (tag: number) => ({ programAddress: "Consumer111111111111111111111111111111111111" as never, accounts: [], data: Uint8Array.of(tag) });
const refresh = { instructions: [ix(89)], computeUnitLimit: 300_000, contextSlot: 1n };
const merged = mergeFreshPrice(refresh, [buildMimirBetaComputeUnitLimitInstruction(150_000), ix(7)]);
assert.equal(merged.computeUnitLimit, 450_000);
assert.deepEqual(merged.instructions.map((i) => i.data[0]), [2, 89, 7]);
assert.equal(mergeFreshPrice(refresh, [ix(7), ix(8)]).computeUnitLimit, 700_000);
console.log("easy price: ok");

// An RPC error never carries the URL or its secret: host only, or "rpc".
for (const [rpc, host] of [["https://u:SECRET@x.test", "x.test"], ["x.test/?key=SECRET", "rpc"], ["SECRETONLY", "rpc"]] as const) {
  await assert.rejects(getPrice(SOL, { rpc }), (e: unknown) => e instanceof MimirError && e.code === "RPC" && !e.message.includes("SECRET") && e.message.startsWith(host) ? true : assert.fail(String(e)));
}
