// Parity with a real v1 mainnet SOL/USDC Raydium CLMM feed (program dGJWY…, v1-harness capture): the V1 definition built under the
// v1 program id must reproduce the accounts the v1 lifecycle wrote on chain (feed config minus its v1 identity tail, plan, source).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Address } from "@solana/kit";
import { bytesAddress } from "../src/beta/bytes.js";
import { decodeMimirBetaLiveFeed, decodeMimirBetaLivePlanFields, decodeMimirBetaLiveSource } from "../src/beta/liveAbi.js";
import { deriveMimirClassicRecipe } from "../src/beta/classicExecution.js";
import { decodeMimirFusedDescriptor } from "../src/beta/compositeExecution.js";
import type { MimirBetaEligiblePool } from "../src/beta/discovery.js";
import { buildMimirV1ClassicDefinition } from "../src/v1/index.js";

const V1_PROGRAM = "dGJWYdFVUT8tVsH8CJLrfGwCyy9BzdELa46h3oMiMir" as Address;
const fx = JSON.parse(readFileSync(new URL("./fixtures/v1/mainnet_v1_sol_usdc_clmm.json", import.meta.url), "utf8")) as {
  accounts: Record<string, { data: [string, string] | string }>; facts: Record<string, { owner: Address; executable: boolean }> };
const data = (k: string) => { const d = fx.accounts[k]!.data; return Uint8Array.from(Buffer.from(Array.isArray(d) ? d[0] : d, "base64")); };
const feedBytes = data("Hnb1a3dFWpxDRRXDWP4JhC1zRVuMg2imESntQx79UVWt");
const planBytes = data("HEEG8CfASKPFvoV6hPktKZdc7iFymrQFgkbHirY4F6ty");
const sourceBytes = data("FfWApn8SNPmajXUiJFKrfNbTRaDmu7tGCzinkqeYbtGm");
const execution = data("9RQvpmtWKwaUv3Rgri7hMKASdeSkWZYSqjQdoUsU7hkF");
const poolData = data("3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv");
const feed = decodeMimirBetaLiveFeed(feedBytes); const plan = decodeMimirBetaLivePlanFields(planBytes); const src = decodeMimirBetaLiveSource(sourceBytes);
const A = bytesAddress;
const ammConfig = A(poolData.subarray(9, 41));
const staticAccounts = [["base-vault", A(src.baseVault)], ["quote-vault", A(src.quoteVault)], ["pool", A(src.poolOrMarket)], ["amm-config", ammConfig]] as const;
const pool = { programId: A(src.programId), pool: A(src.poolOrMarket), baseVault: A(src.baseVault), quoteVault: A(src.quoteVault),
  creation: { adapterType: 1, adapterVersion: src.adapterVersion, bindingVariant: "routeable", tokenProgramId: A(src.tokenProgram), token2022Mint: null,
    vaultAuthority: A(src.vaultAuthority), observationState: null, staticAccounts: staticAccounts.map(([role, address]) => ({ role, address })) } } as unknown as MimirBetaEligiblePool;
const physicalAccounts = [...staticAccounts.map(([, x]) => x), A(feed.baseMint), A(feed.quoteMint)].map((address) => ({ address, ...fx.facts[address]! }));
const realDescriptor = decodeMimirFusedDescriptor(execution.subarray(1573, 1589));
const recipe = deriveMimirClassicRecipe({ role: "primary", adapterType: 1, adapterVersion: src.adapterVersion, externalWidth: realDescriptor.externalWidth, minSlotGap: 1 });
const t = feedBytes.subarray(313, 325);
const ticker = new TextDecoder().decode(t[0]! < 12 ? t.subarray(1, 1 + t[0]!) : t);

const def = await buildMimirV1ClassicDefinition({ programId: V1_PROGRAM, baseMint: A(feed.baseMint), quoteMint: A(feed.quoteMint),
  baseDecimals: feed.baseDecimals, quoteDecimals: feed.quoteDecimals, ticker, variant: 0, registryEpoch: feed.registryEpoch,
  policy: { profile: plan.profile, riskTier: feed.riskTier, priceExponent: feed.priceExponent, maxDispersionBps: feed.maxDispersionBps,
    maxSourceActivityAgeSlots: feed.maxSourceActivityAgeSlots, minCoverageRatioBps: feed.minCoverageRatioBps, maxConfidenceBps: feed.maxConfidenceBps,
    maxSnapshotAgeSlots: feed.maxSnapshotAgeSlots, anchorPolicyHash: feed.anchorPolicyHash, nativeExceptionHash: feed.nativeExceptionHash, minSources: plan.minSources },
  pools: [pool], physicalAccounts, rows: [{ recipe }],
  authoritativeSources: [{ ...src, feedId: A(src.feedId), programId: A(src.programId), poolOrMarket: A(src.poolOrMarket), baseVault: A(src.baseVault),
    quoteVault: A(src.quoteVault), tokenProgram: A(src.tokenProgram), vaultAuthority: A(src.vaultAuthority), direction: src.direction as 0 | 1,
    adapterType: 1, adapterVersion: src.adapterVersion as 0 | 1, temporalMode: src.temporalMode }] });

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const expectedFeed = feedBytes.slice(0, 325); expectedFeed.set([0, 0, 325 & 0xff, 325 >> 8], 8);
assert.equal(hex(def.definition.planImage), hex(planBytes), "plan image == v1 sourcing plan account");
assert.equal(hex(def.definition.rows[0]!.sourceImage), hex(sourceBytes), "source image == v1 source config account");
assert.equal(hex(def.definition.feedImage), hex(expectedFeed), "feed image == v1 feed config (V0 version/len, no identity tail)");
assert.equal(hex(def.definition.rows[0]!.descriptor), hex(execution.subarray(1573, 1589)), "descriptor == v1 sealed classic descriptor");
console.log("v1DefinitionMainnetParity ok");
