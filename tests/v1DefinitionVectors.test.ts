// Byte parity with the program's CREATE_CLASSIC definition vectors (mimir-program v1/defvec aa8eeb0, tests/fixtures/v1_definition):
// the SDK definition and planner must reproduce the tag93 data and the row metas, PumpSwap boost vault included.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Address } from "@solana/kit";
import { addressBytes, bytesAddress } from "../src/beta/bytes.js";
import { decodeMimirFusedDescriptor } from "../src/beta/compositeExecution.js";
import type { MimirBetaEligiblePool } from "../src/beta/discovery.js";
import { unpackMimirCompactDirection } from "../src/internal/currentPointCore.js";
import { planMimirV1ClassicCreationFromPools } from "../src/v1/index.js";

const dir = new URL("./fixtures/v1Definition/", import.meta.url);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));

for (const name of ["usdc_pumpswap_sampled"]) {
  const v = JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
  const capture = JSON.parse(readFileSync(new URL(`${name}.capture.json`, dir), "utf8")).accounts as Record<string, { owner: Address; executable: boolean }>;
  const i = v.inputs; const o = v.outputs;
  const init = unhex(i.init_args_hex); const iv = new DataView(init.buffer);
  const policy = { profile: init[209]!, riskTier: init[210]!, minSources: init[212]!, priceExponent: iv.getInt32(222, true),
    maxDispersionBps: iv.getUint16(226, true), maxSourceActivityAgeSlots: iv.getUint16(228, true), minCoverageRatioBps: iv.getUint16(230, true),
    maxConfidenceBps: iv.getUint16(232, true), maxSnapshotAgeSlots: iv.getUint16(234, true), anchorPolicyHash: init.slice(128, 160), nativeExceptionHash: init.slice(160, 192) };
  const sources = i.rows.map((r: { compact_hex: string }) => {
    const c = unhex(r.compact_hex); const cv = new DataView(c.buffer); const u16 = (at: number) => cv.getUint16(at, true);
    const u128 = (at: number) => cv.getBigUint64(at, true) | cv.getBigUint64(at + 8, true) << 64n; const key = (at: number) => bytesAddress(c.subarray(at, at + 32));
    return { feedId: key(0), sourceIndex: c[32]!, adapterType: c[33]!, ...unpackMimirCompactDirection(c[34]!), adapterVersion: u16(35),
      venueGroup: u16(37), operatorGroup: u16(39), liquidityOwnerGroup: u16(41), routeCorrelationGroup: u16(43), quoteAssetGroup: u16(45),
      bridgeOrWrapperGroup: u16(47), oracleSourceClass: u16(49), upgradeAuthorityGroup: u16(51), maxSourceWeightBps: u16(53),
      minLiquidityNative: u128(55), minDepthTo50BpsNative: u128(71), programId: key(87), poolOrMarket: key(119), baseVault: key(151), quoteVault: key(183),
      tokenProgram: key(215), vaultAuthority: key(247), sourceConfigRevision: cv.getBigUint64(279, true), sourceSetRevision: cv.getBigUint64(287, true) };
  });
  const pools = i.rows.map((r: { vector: Address[]; binding_width: number; binding_variant: number }, k: number) => ({
    programId: sources[k].programId, pool: sources[k].poolOrMarket, baseVault: sources[k].baseVault, quoteVault: sources[k].quoteVault,
    creation: { adapterType: sources[k].adapterType, adapterVersion: sources[k].adapterVersion, bindingVariant: r.binding_variant ? "routeable" : "plain",
      tokenProgramId: sources[k].tokenProgram, token2022Mint: sources[k].adapterType === 6 && sources[k].adapterVersion === 1 ? i.base_mint : null, vaultAuthority: sources[k].vaultAuthority, observationState: null,
      staticAccounts: r.vector.slice(0, r.binding_width).map((address, j) => ({ role: j === 0 ? "base-mint" : "static", address })) } }) as unknown as MimirBetaEligiblePool);
  const physical = [...new Set<Address>([i.base_mint, i.quote_mint, ...i.rows.flatMap((r: { vector: Address[]; binding_width: number }) => r.vector.slice(0, r.binding_width))])]
    .map((address) => ({ address, owner: capture[address]!.owner, executable: capture[address]!.executable }));
  const rows = i.rows.map((r: { vector: Address[] }, k: number) => {
    const { moduleOffset: _o, moduleLength: _l, ...recipe } = decodeMimirFusedDescriptor(unhex(o.rows[k].descriptor_hex));
    return { recipe, externals: r.vector };
  });
  const planned = await planMimirV1ClassicCreationFromPools({ programId: v.program_id, payer: "11111111111111111111111111111112" as Address,
    colaMint: "11111111111111111111111111111113" as Address, colaBaseAmountRaw: BigInt(i.admin_collateral_amount_raw), tickerTierTenths: [150, 30, 5, 2],
    baseMint: i.base_mint, quoteMint: i.quote_mint, baseDecimals: i.base_decimals, quoteDecimals: i.quote_decimals, ticker: i.ticker, variant: i.variant,
    registryEpoch: BigInt(i.registry_epoch), policy, pools, physicalAccounts: physical, rows, authoritativeSources: sources });
  assert.equal(hex(addressBytes(planned.feedId)), o.feed_id);
  assert.equal(hex(planned.definition.feedImage), o.feed_image_hex, `${name} feed image`);
  assert.equal(hex(planned.definition.planImage), o.plan_image_hex, `${name} plan image`);
  planned.definition.rows.forEach((row, k) => {
    assert.equal(hex(row.descriptor), o.rows[k].descriptor_hex, `${name} descriptor ${k}`);
    assert.equal(hex(row.sourceImage), o.rows[k].source_image_hex, `${name} source image ${k}`);
  });
  assert.equal(planned.exactLen, o.exact_len); assert.equal(planned.colaAmountRaw, BigInt(o.cola_amount_raw));
  assert.equal(planned.feed, o.pdas.feed.address);
  const ix = planned.plan.instructions.at(-1)!;
  assert.equal(hex(ix.data), o.create_data_hex, `${name} CREATE_CLASSIC data`);
  assert.deepEqual(ix.accounts.slice(10, 10 + o.create_vector_accounts.length).map((m) => m.address), o.create_vector_accounts, `${name} row metas`);
  assert.equal(ix.accounts.length, 10 + o.create_vector_accounts.length + (i.sol_feed ? 1 : 0));
  console.log(`v1DefinitionVectors ${name} ok`);
}
