import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeFeedInfo, recommendPools, scoreFeed, type ScorePool } from "../../src/easy/index.js";

// Spec v1 CHECK cases (recommender calibration).
const pool = (exchange: string, depth50Usdc: number): ScorePool => ({ exchange, depth50Usdc, trades24h: 2000, lastTradeMin: 1 });
const A = pool("Orca", 100_000);
assert.deepEqual([scoreFeed({ pools: [A] })!.score, scoreFeed({ pools: [A] })!.band, scoreFeed({ pools: [A] })!.pauseCost], [78, "Strong", null]);
assert.equal(scoreFeed({ pools: [A, pool("Orca", 1000)] })!.score, 53, "a same-exchange thin pool lowers the score");
assert.equal(scoreFeed({ pools: [A, pool("Meteora", 100_000)] })!.score, 86);
assert.equal(scoreFeed({ pools: [A, pool("Meteora", 100_000), pool("Raydium", 100_000)] })!.score, 89);
assert.equal(scoreFeed({ pools: [pool("Meteora", 18)] })!.band, "Thin");

// Auto keeps two exchanges for HYPE (SOL): 108,144 + 53,429 → 74; unknown activity = 0.5.
const hype = [{ exchange: "Orca", depth50Usdc: 108_144 }, { exchange: "Raydium", depth50Usdc: 53_429 }, { exchange: "Orca", depth50Usdc: 900 }];
const auto = recommendPools(hype)!;
assert.deepEqual([auto.pools, auto.score.score, auto.score.factors.activity], [hype.slice(0, 2), 74, 0.5]);
assert.equal(auto.deltas[0]! < 0 && auto.deltas[1]! < 0 && auto.deltas[2]! < 0, true);
assert.equal(recommendPools([]), null);

// Captured hBYr accounts: COLA is one Meteora DAMM v2 pool; SOL-quoted depth needs a SOL price; an index has components.
const fx = JSON.parse(readFileSync(new URL("../fixtures/hbyr/accounts.json", import.meta.url), "utf8")) as {
  slot: number; accounts: Record<string, { owner: string; executable: boolean; data: string }> };
const account = (address: string) => { const a = fx.accounts[address]!; return { address, owner: a.owner, executable: a.executable, data: Buffer.from(a.data, "base64") }; };
const all = await Promise.all(Object.keys(fx.accounts).filter((k) => /^MIMIRSNP|^MIMIRCSP/.test(Buffer.from(fx.accounts[k]!.data, "base64").subarray(0, 8).toString()))
  .map((k) => decodeFeedInfo(account(k), { slot: fx.slot })));
const COLA = all.find((i) => i.ticker === "COLA")!.feed;
const cola = await decodeFeedInfo(account(COLA), { slot: fx.slot });
assert.deepEqual([cola.ticker, cola.kind, cola.quote, cola.maxDispersionBps, cola.components], ["COLA", "token", "SOL", 100, []]);
const { feePpm: _f, confBps: _c, mode: _m, depthSlot: _s, ...colaPool } = cola.pools[0]!;
assert.deepEqual(colaPool, { pool: "67MdiDhic5bNb1Y6TX2EZyViGwdoQxFEVz5rr6SKSSXh", venue: "Meteora DAMM v2", exchange: "Meteora", adapterType: 7, depth50Usdc: null });
assert.equal(cola.slot, BigInt(fx.slot));
const fresh = cola.pools[0]!.depthSlot + 150n;
assert.ok((await decodeFeedInfo(account(COLA), { slot: fresh, solUsdc: 100 })).pools[0]!.depth50Usdc! > 0);
// A ring older than 150 slots at the read slot has no depth: scoreFeed({ pools: info.pools }) is null without passing `slot`.
const staleCola = await decodeFeedInfo(account(COLA), { slot: fresh + 1n, solUsdc: 100 });
assert.deepEqual([staleCola.pools[0]!.depth50Usdc, scoreFeed({ pools: staleCola.pools })], [null, null]);
const SOLF = "F5fXuWuVFwBF3eBVtFkxXS5PMY651uVQ1bL4W4mse5Qj";
const sol = await decodeFeedInfo(account(SOLF), { slot: (await decodeFeedInfo(account(SOLF), { slot: fx.slot })).pools[0]!.depthSlot });
assert.deepEqual([sol.ticker, sol.quote, sol.pools.map((p) => [p.venue, Math.round(p.depth50Usdc!)])], ["SOL", "USDC", [["Meteora DLMM", 1075]]]);
const index = await decodeFeedInfo(account("EjccovzYj9TW7xAYRV13TLPdqzFtfBgpprshXos2T6J1"), { slot: fx.slot });
assert.deepEqual([index.kind, index.pools.length, index.components.length], ["index", 0, 3]);
assert.deepEqual([sol.pools[0]!.mode, sol.pools[0]!.confBps], [2, 1]);

// Spec v2 (score-check §2): unknown activity, market fit reported, never applied to the score.
const v2 = (pools: ScorePool[], capBps?: number) => scoreFeed({ pools, capBps })!;
const one = (exchange: string, depth50Usdc: number, mode: number, confBps: number): ScorePool => ({ exchange, depth50Usdc, mode, confBps });
assert.deepEqual([v2([one("Meteora", 1075, 2, 1)]).score, v2([one("Meteora", 5462, 2, 1)]).score, v2([one("Meteora", 5462, 2, 1)]).band], [45, 54, "Good"]);
assert.deepEqual([v2([one("Raydium", 34_590, 0, 5)]).score, v2([one("Raydium", 34_590, 3, 5)]).score], [64, 64]);
const pengu = v2([one("Meteora", 3226, 3, 125)], 157);
assert.deepEqual([pengu.score, pengu.marketFit.fit, v2([{ exchange: "Meteora", depth50Usdc: 3226 }], 157).score], [51, false, 51]);
const jitosol = v2([one("Orca", 1709, 0, 5)]), jlp = v2([one("Orca", 4663, 0, 5), one("Orca", 3124, 0, 5), one("Meteora", 353, 0, 5)]);
assert.deepEqual([jitosol.score, jlp.score, jitosol.marketFit.reason], [48, 32, "single spot pool: use the interval/point recipe"]);
const spot = v2([one("Raydium", 34_590, 0, 5)]), spotNoFit = v2([{ exchange: "Raydium", depth50Usdc: 34_590 }]);
assert.deepEqual([spot.fitVerdict.status, spot.fitVerdict.reason, spot.score], ["not-as-is", "RECIPE_UNSUPPORTED", spotNoFit.score], "a not-as-is spot pool keeps its score");
assert.equal(scoreFeed({ pools: [A, { exchange: "Meteora", depth50Usdc: null }] }), null);
assert.equal(recommendPools([{ exchange: "Orca", depth50Usdc: null }]), null);
for (const bad of [NaN, -1, Infinity]) assert.equal(scoreFeed({ pools: [{ ...A, depth50Usdc: bad }] }), null, `depth ${bad}`);
assert.equal(scoreFeed({ pools: [{ ...A, depthSlot: 1000n }], slot: 1151n }), null, "depth older than 150 slots");
assert.ok(scoreFeed({ pools: [{ ...A, depthSlot: 1000n }], slot: 1150n }));
// « Stays priced »: a native-bounded DLMM or CPMM row pauses while its pool is quiet; CLMM native, DUAL (temporal 6) and Default do not.
{
  const jup = { exchange: "meteora", depth50Usdc: 30_000, trades24h: 3_276, adapterType: 3 };
  const dflt = scoreFeed({ pools: [{ ...jup, mode: 0 }] })!;
  assert.deepEqual([dflt.score, dflt.band, dflt.pausesWhenQuiet, dflt.factors.stays], [71, "Strong", false, 1], "JUP-shaped single DLMM pool under Default keeps 71");
  for (const adapterType of [2, 3]) {
    const native = scoreFeed({ pools: [{ ...jup, adapterType, mode: 2 }] })!;
    assert.deepEqual([native.pausesWhenQuiet, native.pauseCost, native.factors.stays, native.score], [true, 0, 0, 51], `adapter ${adapterType} native pauses when quiet`);
  }
  for (const row of [{ adapterType: 1, mode: 2 }, { adapterType: 3, mode: 2, temporalKind: 6 }]) {
    const s = scoreFeed({ pools: [{ ...jup, ...row }] })!;
    assert.deepEqual([s.pausesWhenQuiet, s.factors.stays, s.score], [false, 1, 71], JSON.stringify(row));
  }
}
console.log("feedInfo OK");
