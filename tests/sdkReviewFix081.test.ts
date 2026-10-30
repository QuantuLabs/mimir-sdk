import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddressEncoder, type Address } from "@solana/kit";
import { readFileSync } from "node:fs";
import { mimirClassicCpmmNativeReadiness, mimirClassicNativeRebuild, mimirClassicNativeRowReadiness, MimirClassicNativeNotReadyError } from "../src/beta/live.js";
import { extractMeteoraDlmmNativeTwapSample, mimirVenueDeploymentUnix } from "../src/internal/nativeMonoRefreshCore.js";
import { deriveMimirBetaPda } from "../src/beta/abi.js";
import { addressBytes, bytesAddress } from "../src/beta/bytes.js";
import { scoreInput } from "../src/create/recommend.js";
import { scoreFeed } from "../src/easy/feedInfo.js";
import { USDC_QUOTE_MINT } from "../src/create/helpers.js";
import { makeBetaCaptureFixture } from "./fixtures/betaCaptureFixtures.js";
import { withReadyNativeHistory } from "./fixtures/nativeReadyHistory.js";
import { decodeMimirBetaCaptureCandidate } from "../src/beta/index.js";
import * as V1 from "../src/v1/index.js";
import * as K from "../src/v1/layout/classic.js";

const DLMM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo" as Address;
const key = (n: number) => bytesAddress(new Uint8Array(32).fill(n));
const POOL = key(13);
type Rec = { cum: bigint; created: bigint; updated: bigint };
function dlmmOracle(latestIndex: number, activeSize: number, length: number, slots: Map<number, Rec>): Uint8Array {
  const d = new Uint8Array(32 + 32 * length); const v = new DataView(d.buffer);
  d.set([139, 194, 131, 179, 140, 179, 229, 244]);
  v.setBigUint64(8, BigInt(latestIndex), true); v.setBigUint64(16, BigInt(activeSize), true); v.setBigUint64(24, BigInt(length), true);
  for (const [i, r] of slots) {
    const o = 32 + 32 * i; v.setBigUint64(o, BigInt.asUintN(64, r.cum), true); v.setBigInt64(o + 8, r.cum >> 64n, true);
    v.setBigUint64(o + 16, r.created, true); v.setBigUint64(o + 24, r.updated, true);
  }
  return d;
}
const cpmmObs = (ts: bigint[], last: bigint) => { const d = new Uint8Array(4_075); const v = new DataView(d.buffer);
  d.set([122, 174, 197, 53, 129, 9, 165, 132]); d[8] = 1; v.setUint16(9, ts.length - 1, true); d.set(addressBytes(POOL), 11);
  ts.forEach((t, i) => { v.setBigUint64(43 + 40 * i, t, true); d[43 + 40 * i + 8] = 1; }); v.setBigUint64(4_043, last, true); return d; };

describe("0.8.1 review fixes", () => {
  it("V1 pre-purchase check honours a minSources quorum", async () => {




  const programId = V1.MIMIR_V1_MAINNET_PROGRAM_ID;
  const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const mk = async (family: "raydium-clmm" | "meteora-dlmm", s: number, baseMint?: Address) => {
    const fixture = await makeBetaCaptureFixture(family, { seed: s, quoteMint: USDC_QUOTE_MINT, ...(baseMint ? { baseMint } : {}) });
    const c = await decodeMimirBetaCaptureCandidate(fixture.input);
    const pool = { eligibility: "eligible", family, programId: c.programId, pool: c.pool, descriptorId: c.descriptorId, descriptorHash: c.descriptorHash,
      readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1, canonicalPairKey: c.canonicalPairKey,
      direction: "quote-per-base", baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault, quoteVault: c.quoteVault,
      adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
      minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: "a".repeat(64), creation: fixture.creation } as never;
    return { c, pool, accounts: fixture.fixtureAccounts };
  };
  const clmm = await mk("raydium-clmm", 11);
  const dlmm = await mk("meteora-dlmm", 23, clmm.c.baseMint);
  const store = new Map<Address, { owner: Address; executable: boolean; data: Uint8Array; fixtureRole?: string }>();
  for (const x of [...clmm.accounts, ...dlmm.accounts]) store.set(x.address, x);
  const [adminAddress] = await V1.findMimirV1AdminConfigPda(programId); const [registryAddress] = await V1.findMimirV1RegistryPda(programId);
  const admin = new Uint8Array(192); const av = view(admin);
  admin.set(new TextEncoder().encode("MIMIRCFG")); av.setUint16(8, 1, true); av.setUint16(10, 192, true); admin[12] = 1; admin[13] = 255;
  admin.fill(1, 16, 48); admin.set(new Uint8Array(32).fill(51), 48); av.setBigUint64(80, 1_000n, true); admin[88] = 1; admin[89] = 3;
  admin.set([150, 30, 5, 2], 116); admin.fill(2, 120, 152); av.setBigUint64(152, 1n, true); admin.fill(3, 160, 192);
  const registry = new Uint8Array(128); const rv = view(registry);
  registry.set(new TextEncoder().encode("MIMIRREG")); rv.setUint16(10, 128, true); registry.fill(4, 16, 48); rv.setBigUint64(96, 3n, true);
  store.set(adminAddress, { owner: programId, executable: false, data: admin }); store.set(registryAddress, { owner: programId, executable: false, data: registry });
  const mint = (decimals: number) => { const d = new Uint8Array(82); d[44] = decimals; d[45] = 1; return { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address, executable: false, data: d }; };
  if (!store.has(clmm.c.baseMint)) store.set(clmm.c.baseMint, mint(9));
  if (!store.has(clmm.c.quoteMint)) store.set(clmm.c.quoteMint, mint(6));
  withReadyNativeHistory(store as never, 9n); // CLMM EZVk observation (ready) + Clock at its recorded unix
  const now = BigInt(JSON.parse(readFileSync("tests/fixtures/native-ready-clmm-observation.json", "utf8")).clockUnix);
  const [oracle] = await deriveMimirBetaPda({ programId: dlmm.c.programId, seed: "oracle", values: [getAddressEncoder().encode(dlmm.c.pool) as Uint8Array] });
  const pd = Uint8Array.from(store.get(dlmm.c.pool)!.data); pd.set(getAddressEncoder().encode(oracle), 552); store.set(dlmm.c.pool, { ...store.get(dlmm.c.pool)!, data: pd });
  // four dense records 100 s apart (50 s creation gaps): ready at a 300 s window when the endpoint is fresh
  const setDlmm = (lastAgo: bigint) => store.set(oracle, { owner: dlmm.c.programId, executable: false, data: dlmmOracle(3, 4, 4,
    new Map([0, 1, 2, 3].map((j) => { const u = now - lastAgo - BigInt(3 - j) * 100n; return [j, { cum: 0n, created: u - 50n, updated: u }] as const; }))) });
  const rpcAccount = (x: Address) => { const a = store.get(x); return a ? { owner: a.owner, executable: a.executable, lamports: 1n, rentEpoch: 0n,
    space: BigInt(a.data.length), data: [Buffer.from(a.data).toString("base64"), "base64"] } : null; };
  const rpc = { getAccountInfo: (x: Address) => ({ send: async () => ({ context: { slot: 9n }, value: rpcAccount(x) }) }),
    getMultipleAccounts: (xs: readonly Address[]) => ({ send: async () => ({ context: { slot: 9n }, value: xs.map(rpcAccount) }) }) };
  const policy = { profile: 0, riskTier: 1, priceExponent: -8, maxDispersionBps: 100, maxSourceActivityAgeSlots: 150, minCoverageRatioBps: 10_000,
    maxConfidenceBps: 500, maxSnapshotAgeSlots: 150, anchorPolicyHash: new Uint8Array(32).fill(7), nativeExceptionHash: new Uint8Array(32).fill(8) };
    const run = async (lastAgo: bigint, minSources: number) => {
      setDlmm(lastAgo);
      return V1.prepareMimirV1ClassicCreation(rpc as never, { programId, payer: key(50), ticker: "SOLX", baseMint: clmm.c.baseMint, quoteMint: clmm.c.quoteMint,
        pools: [clmm.pool, dlmm.pool], policy: { ...policy, minSources }, variant: 1, recipes: ["native-bounded", "native-bounded"] });
    };
    assert.equal((await run(500n, 1)).definition.planImage[K.PLAN_OFFSET_MIN_SOURCES], 1);
    await assert.rejects(run(500n, 2), (e) => e instanceof MimirClassicNativeNotReadyError && e.readiness.row === 1 && e.readiness.reason === "stale-oracle");
  });

  it("extractMeteoraDlmmNativeTwapSample throws stale-oracle on an extended record without activeId", () => {
    const T = mimirVenueDeploymentUnix("mainnet").dlmm + 10_000n;
    const oracle = dlmmOracle(1, 2, 2, new Map([[0, { cum: 0n, created: T, updated: T + 100n }], [1, { cum: 500n * 150n, created: T + 150n, updated: T + 250n }]]));
    const now = T + 340n;
    const s = extractMeteoraDlmmNativeTwapSample({ oracleData: oracle, currentTimestamp: now, activeId: 500, cluster: "mainnet" });
    assert.equal(Number(s.newCumulativeBin - s.oldCumulativeBin) / Number(s.newTimestamp - s.oldTimestamp), 500);
    assert.throws(() => extractMeteoraDlmmNativeTwapSample({ oracleData: oracle, currentTimestamp: now, cluster: "mainnet" }), { reason: "stale-oracle" });
  });

  it("scoreInput marks dual-native-point as temporal kind 6", () => {
    const pool = { pool: "P", family: "meteora-dlmm", quoteMint: USDC_QUOTE_MINT, minDepthTo50BpsNative: 30_000_000_000n, creation: { adapterType: 3, adapterVersion: 0 } } as never;
    const s = scoreFeed({ pools: [scoreInput(pool, { recipe: "dual-native-point", routeable: false } as never, USDC_QUOTE_MINT)] })!;
    assert.equal(s.pausesWhenQuiet, false);
  });

  it("readyAtUnixTs is never before lastUpdate + 61 while the end is the last update", async () => {
    const c = mimirClassicCpmmNativeReadiness(cpmmObs([900n, 3000n, 3095n], 3100n), 3140n);
    assert.deepEqual([c.ready, c.readyAtUnixTs], [false, 3161n]);
    assert.equal(mimirClassicCpmmNativeReadiness(cpmmObs([900n, 3000n, 3095n], 3100n), 3161n).ready, true);
    const NOW = 1_800_000_000n;
    const [ORACLE] = await deriveMimirBetaPda({ programId: DLMM, seed: "oracle", values: [addressBytes(POOL)] });
    const lb = new Uint8Array(904); lb.set(addressBytes(ORACLE), 552);
    const acct = (data: Uint8Array) => ({ address: POOL, owner: DLMM, executable: false, lamports: 1n, data });
    const data = dlmmOracle(2, 3, 3, new Map(([[300n, 250n], [200n, 150n], [100n, 50n]] as const).map(([c2, u], i) => [i, { cum: 0n, created: NOW - c2, updated: NOW - u }])));
    const r = mimirClassicNativeRowReadiness({ row: 0, pool: { pool: POOL, programId: DLMM, creation: { adapterType: 3, adapterVersion: 0 }, readPlan: { auxiliary: [] } } as never,
      poolAccount: acct(lb), observation: ORACLE, observationAccount: acct(data), nowUnix: NOW, cluster: "mainnet" });
    assert.deepEqual([r.ready, r.readyAtUnixTs], [false, NOW + 11n]);
  });

  it("a quiet CPMM pool with a readyAt is history-rebuilding", () => {
    const q = mimirClassicCpmmNativeReadiness(cpmmObs([900n, 3000n], 3010n), 3080n);
    assert.deepEqual(mimirClassicNativeRebuild(2, q as never), { state: "history-rebuilding", aboutSecs: q.readyAtUnixTs! - 3080n });
    assert.equal(mimirClassicCpmmNativeReadiness(cpmmObs([900n, 3000n], 3010n), q.readyAtUnixTs!).ready, true);
  });
});
