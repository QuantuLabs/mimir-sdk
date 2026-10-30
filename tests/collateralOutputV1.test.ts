import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  CONFIG_OFFSETS,
  FEED_CONFIG_V1_HEADER_LEN,
  MIMIR_MAINNET_PROGRAM_ID,
  OFFSETS,
  SourceDirection,
} from "../src/constants.js";
import {
  computeMimirFeedPolicyCommitmentV1,
  normalizeMimirCollateralPriceX64,
  verifyMimirFeedConfigV1,
  verifyMimirFeedSnapshotV1,
} from "../src/collateralOutputV1.js";

import { buildTestFeedConfigHeader, buildTestSnapshotHeader, TEST_FEED_ID, toTestFeedConfigV1 } from "../src/fixtures.js";
import { findFeedConfigPda, findFeedSnapshotPda } from "../src/pda.js";

const key = (fill: number) => new PublicKey(Buffer.alloc(32, fill));
const hash = (fill: number) => Buffer.alloc(32, fill);
const FIXTURE_COLLATERAL_PROGRAM = new PublicKey("TYo5SEVfHyFzpjsbFVzNFKTnmLdBvdYjLxmnv32iQ9r");
const CANONICAL_COLLATERAL_PROGRAM = new PublicKey(MIMIR_MAINNET_PROGRAM_ID.toBytes());
const LEGACY_COLLATERAL_PROGRAM = new PublicKey("GqGbSz8rncAyJRpDgJ1RN7vBvkaAi3dXRF4xNQfFuMVe");

function deriveOrdinaryPdas(feedId: Uint8Array, program = CANONICAL_COLLATERAL_PROGRAM) {
  return {
    config: PublicKey.findProgramAddressSync([Buffer.from("feed_config"), Buffer.from(feedId)], program),
    snapshot: PublicKey.findProgramAddressSync([Buffer.from("feed_snapshot"), Buffer.from(feedId)], program),
  };
}

const verifyFixtureConfig = (shell: Parameters<typeof verifyMimirFeedConfigV1>[0]) =>
  verifyMimirFeedConfigV1(shell, FIXTURE_COLLATERAL_PROGRAM);

function withOwnGetter<T extends object>(
  value: T,
  property: string,
  get: () => unknown,
): T {
  const copy = Object.create(Object.getPrototypeOf(value), Object.getOwnPropertyDescriptors(value)) as T;
  Object.defineProperty(copy, property, { configurable: true, enumerable: true, get });
  return copy;
}


test("closed ordinary and output account shells authenticate owner, length, PDA, bump and bindings", () => {
  const owner = FIXTURE_COLLATERAL_PROGRAM;
  const ordinaryPdas = deriveOrdinaryPdas(TEST_FEED_ID, owner);
  const [ordinaryConfigKey] = ordinaryPdas.config;
  const [ordinarySnapshotKey] = ordinaryPdas.snapshot;
  assert.equal(ordinaryConfigKey.toBase58(), "BRi4TcNSwrv3ZzmBCPvuiPYmJQmRredhYELygrwZaA5x");
  assert.equal(ordinaryPdas.config[1], 255);
  assert.equal(ordinarySnapshotKey.toBase58(), "GL1V94YDZc7YhccP5Rjfn4WvJqDo4wiWuow6xNZMe5DH");
  assert.equal(ordinaryPdas.snapshot[1], 255);
  const legacyOrdinaryPdas = deriveOrdinaryPdas(TEST_FEED_ID, LEGACY_COLLATERAL_PROGRAM);
  assert.equal(legacyOrdinaryPdas.config[0].toBase58(), "JCaPg9bSqrAATJkBYJoxDRdfbX4DW1iUL4gPSn5tiZaN");
  assert.equal(legacyOrdinaryPdas.config[1], 255);
  assert.equal(legacyOrdinaryPdas.snapshot[0].toBase58(), "DPWGX5rCkAJh7LSJ4bm8iJPUNbzgoAobaCb5zGMdduj7");
  assert.equal(legacyOrdinaryPdas.snapshot[1], 255);
  const legacyConfigData = buildTestFeedConfigHeader((bytes) => { bytes[CONFIG_OFFSETS.bump] = ordinaryPdas.config[1]; });
  const configData = toTestFeedConfigV1(legacyConfigData);
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: legacyConfigData }));
  const snapshotData = buildTestSnapshotHeader((data) => {
    ordinaryConfigKey.toBuffer().copy(data, OFFSETS.feedConfig);
  });
  const ordinaryConfig = verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: configData });
  const ordinarySnapshot = verifyMimirFeedSnapshotV1({ address: ordinarySnapshotKey, owner, executable: false, data: snapshotData }, ordinaryConfig);
  assert.equal(ordinarySnapshot.configKey.toBase58(), ordinaryConfigKey.toBase58());
  assert.equal(ordinaryConfig.orientation, SourceDirection.QuotePerBase);
  const policyCommitment = computeMimirFeedPolicyCommitmentV1(key(25), ordinaryConfig).toString("hex");
  assert.equal(policyCommitment, "b6419a2763366ec50fcaaf3de215549f6af41a45163c4b0f500bc17f50dd00d5");
  assert.notEqual(policyCommitment, "1cd0b13643518a315a9bc4a2e790a081d4068f8431e12a968e7e7b7e361696c6");

  const configDataV1 = Buffer.concat([legacyConfigData, hash(90)]);
  configDataV1.writeUInt16LE(1, CONFIG_OFFSETS.version);
  configDataV1.writeUInt16LE(FEED_CONFIG_V1_HEADER_LEN, CONFIG_OFFSETS.headerLen);
  configDataV1.writeUInt32LE(1, CONFIG_OFFSETS.flags);
  Buffer.from([3, 65, 66, 67, 0, 0, 0]).copy(configDataV1, 313);
  const ordinaryConfigV1 = verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: configDataV1 });
  assert.equal(ordinaryConfigV1.data.length, FEED_CONFIG_V1_HEADER_LEN);
  const registry = key(25);
  const policyCommitmentV1 = computeMimirFeedPolicyCommitmentV1(registry, ordinaryConfigV1);
  const nativeCommitmentV1 = createHash("sha256")
    .update("MIMIR_FEED_POLICY_COMMITMENT_V1", "ascii")
    .update(Buffer.from([0]))
    .update(owner.toBuffer())
    .update(registry.toBuffer())
    .update(ordinaryConfigKey.toBuffer())
    .update(configDataV1)
    .digest();
  assert.deepEqual(policyCommitmentV1, nativeCommitmentV1);

  const changedIdentityData = Buffer.from(configDataV1);
  changedIdentityData[325] ^= 1;
  assert.deepEqual(changedIdentityData.subarray(0, 325), configDataV1.subarray(0, 325));
  assert.notDeepEqual(changedIdentityData.subarray(325), configDataV1.subarray(325));
  const changedIdentity = verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: changedIdentityData });
  assert.notDeepEqual(computeMimirFeedPolicyCommitmentV1(registry, changedIdentity), policyCommitmentV1);

  const noTickerV1 = Buffer.from(configDataV1);
  noTickerV1.writeUInt32LE(0, CONFIG_OFFSETS.flags);
  noTickerV1.fill(0, 313, 325);
  assert.equal(verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: noTickerV1 }).data.length, FEED_CONFIG_V1_HEADER_LEN);
  const badNoTicker = Buffer.from(noTickerV1); badNoTicker[313] = 1;
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: badNoTicker }));
  const twelveByteTicker = Buffer.from(configDataV1); Buffer.from("ABC123456789").copy(twelveByteTicker, 313);
  assert.doesNotThrow(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: twelveByteTicker }));

  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: configDataV1.subarray(0, 356) }));
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: Buffer.concat([configDataV1, Buffer.from([0])]) }));
  const zeroIdentity = Buffer.from(configDataV1); zeroIdentity.fill(0, 325, FEED_CONFIG_V1_HEADER_LEN);
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: zeroIdentity }));
  const badV1Flags = Buffer.from(configDataV1); badV1Flags.writeUInt32LE(2, CONFIG_OFFSETS.flags);
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: badV1Flags }));
  const badTickerPadding = Buffer.from(configDataV1); badTickerPadding[319] = 1;
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: badTickerPadding }));
  const badV1Reserved = Buffer.from(configDataV1); badV1Reserved[123] = 1;
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: badV1Reserved }));
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner: LEGACY_COLLATERAL_PROGRAM, executable: false, data: configDataV1 }));
  assert.throws(() => verifyFixtureConfig({ address: key(29), owner, executable: false, data: configDataV1 }));
  const badV1Bump = Buffer.from(configDataV1); badV1Bump[CONFIG_OFFSETS.bump] ^= 1;
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: badV1Bump }));

  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner: LEGACY_COLLATERAL_PROGRAM, executable: false, data: configData }));
  assert.throws(() => verifyFixtureConfig({ address: legacyOrdinaryPdas.config[0], owner, executable: false, data: configData }));
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner: key(30), executable: false, data: configData }));
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: true, data: configData }));
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: configData.subarray(0, 351) }));
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: Buffer.concat([configData, Buffer.from([0])]) }));
  assert.throws(() => verifyFixtureConfig({ address: key(29), owner, executable: false, data: configData }));
  const badOrdinaryBump = Buffer.from(configData); badOrdinaryBump[CONFIG_OFFSETS.bump] ^= 1;
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: badOrdinaryBump }));
  const badOrdinaryEnum = Buffer.from(configData); badOrdinaryEnum[CONFIG_OFFSETS.lifecycleState] = 0xff;
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: badOrdinaryEnum }));
  const badReserved = Buffer.from(configData); badReserved[313] = 1;
  assert.throws(() => verifyFixtureConfig({ address: ordinaryConfigKey, owner, executable: false, data: badReserved }));
  assert.throws(() => verifyMimirFeedSnapshotV1({ address: key(28), owner, executable: false, data: snapshotData }, ordinaryConfig));
  const badSnapshotConfig = Buffer.from(snapshotData); key(27).toBuffer().copy(badSnapshotConfig, OFFSETS.feedConfig);
  assert.throws(() => verifyMimirFeedSnapshotV1({ address: ordinarySnapshotKey, owner, executable: false, data: badSnapshotConfig }, ordinaryConfig));
  const badSnapshotEnum = Buffer.from(snapshotData); badSnapshotEnum[OFFSETS.status] = 0xff;
  assert.throws(() => verifyMimirFeedSnapshotV1({ address: ordinarySnapshotKey, owner, executable: false, data: badSnapshotEnum }, ordinaryConfig));

});

test("trusted custom program binds config owner/PDA, snapshot and policy without mutable authority", () => {
  const program = new PublicKey(LEGACY_COLLATERAL_PROGRAM.toBytes());
  const pdas = deriveOrdinaryPdas(TEST_FEED_ID, program), canonical = deriveOrdinaryPdas(TEST_FEED_ID, FIXTURE_COLLATERAL_PROGRAM);
  assert.equal(pdas.config[1], canonical.config[1]); // Identical config bytes in both hash domains.
  const data = toTestFeedConfigV1(buildTestFeedConfigHeader((bytes) => { bytes[CONFIG_OFFSETS.bump] = pdas.config[1]; }));
  const shell = { address: pdas.config[0], owner: program, executable: false, data };
  const config = verifyMimirFeedConfigV1(shell, program);
  const snapshotData = buildTestSnapshotHeader(bytes => pdas.config[0].toBuffer().copy(bytes, OFFSETS.feedConfig));
  const snapshot = { address: pdas.snapshot[0], owner: new PublicKey(program.toBytes()), executable: false, data: snapshotData };
  assert.doesNotThrow(() => verifyMimirFeedSnapshotV1(snapshot, config));
  assert.throws(() => verifyMimirFeedConfigV1(shell), /InvalidMimirFeedConfigV1Shell/);
  assert.throws(() => verifyMimirFeedConfigV1({ ...shell, owner: FIXTURE_COLLATERAL_PROGRAM }, program), /InvalidMimirFeedConfigV1Shell/);
  assert.throws(() => verifyMimirFeedConfigV1({ ...shell, address: canonical.config[0] }, program), /InvalidMimirFeedConfigV1Pda/);
  assert.throws(() => verifyMimirFeedSnapshotV1({ ...snapshot, owner: FIXTURE_COLLATERAL_PROGRAM }, config), /InvalidMimirFeedSnapshotV1Shell/);
  assert.throws(() => verifyMimirFeedSnapshotV1({ ...snapshot, address: canonical.snapshot[0] }, config), /InvalidMimirFeedSnapshotV1Binding/);
  assert.throws(() => verifyMimirFeedConfigV1(shell, { toBytes: () => new Uint8Array(31) } as never), /ProgramId/);
  const registry = key(25), commitment = computeMimirFeedPolicyCommitmentV1(registry, config);
  const expected = createHash("sha256").update("MIMIR_FEED_POLICY_COMMITMENT_V1\0", "ascii")
    .update(program.toBuffer()).update(registry.toBuffer()).update(pdas.config[0].toBuffer()).update(data).digest();
  assert.deepEqual(commitment, expected);
  const canonicalConfig = verifyFixtureConfig({ ...shell, address: canonical.config[0], owner: FIXTURE_COLLATERAL_PROGRAM });
  assert.deepEqual(canonicalConfig.data, config.data);
  assert.notDeepEqual(computeMimirFeedPolicyCommitmentV1(registry, canonicalConfig), commitment);
  (program as PublicKey & { _bn: unknown })._bn = (key(31) as PublicKey & { _bn: unknown })._bn;
  (config.key as PublicKey & { _bn: unknown })._bn = (key(30) as PublicKey & { _bn: unknown })._bn;
  assert.deepEqual(computeMimirFeedPolicyCommitmentV1(registry, config), commitment);
  assert.doesNotThrow(() => verifyMimirFeedSnapshotV1(snapshot, config));
});

test("public shell capture rejects the R93 three-yield address forge and all shell accessors", () => {
  const feedId = hash(90);
  const [address, bump] = deriveOrdinaryPdas(feedId).config;
  const data = toTestFeedConfigV1(buildTestFeedConfigHeader((bytes) => {
    feedId.copy(bytes, CONFIG_OFFSETS.feedId);
    bytes[CONFIG_OFFSETS.bump] = bump;
  }));
  const shell = { address, owner: CANONICAL_COLLATERAL_PROGRAM, executable: false, data };
  let reads = 0;
  let fact: unknown;
  const forged = withOwnGetter(shell, "address", () => {
    reads += 1;
    return reads < 3 ? address : key(31);
  });
  assert.throws(() => { fact = verifyMimirFeedConfigV1(forged); }, /MalformedMimirFeedConfigV1Shell/);
  assert.equal(reads, 0);
  assert.equal(fact, undefined);

  for (const field of ["owner", "data"] as const) {
    let fieldReads = 0;
    const accessor = withOwnGetter(shell, field, () => {
      fieldReads += 1;
      return shell[field];
    });
    assert.throws(() => verifyMimirFeedConfigV1(accessor), /MalformedMimirFeedConfigV1Shell/, field);
    assert.equal(fieldReads, 0, field);
  }
  for (const [name, malformed] of [
    ["non-record", []],
    ["missing", { address, owner: CANONICAL_COLLATERAL_PROGRAM, executable: false }],
    ["surplus", { ...shell, surplus: true }],
    ["symbol", { ...shell, [Symbol("surplus")]: true }],
  ] as const) {
    assert.throws(() => verifyMimirFeedConfigV1(malformed as never), /MalformedMimirFeedConfigV1Shell/, name);
  }
});

test("ordinary PDA helpers and shell verifiers ignore poisoned returned cache objects", () => {
  const canonicalProgram = new PublicKey(MIMIR_MAINNET_PROGRAM_ID.toBytes());
  const [cachedConfig] = findFeedConfigPda(TEST_FEED_ID);
  const [cachedSnapshot] = findFeedSnapshotPda(TEST_FEED_ID);
  const [canonicalConfig, canonicalBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("feed_config"), Buffer.from(TEST_FEED_ID)],
    canonicalProgram,
  );
  const [canonicalSnapshot] = PublicKey.findProgramAddressSync(
    [Buffer.from("feed_snapshot"), Buffer.from(TEST_FEED_ID)],
    canonicalProgram,
  );
  const mutableConfig = cachedConfig as PublicKey & { _bn: unknown };
  const mutableSnapshot = cachedSnapshot as PublicKey & { _bn: unknown };
  const attackerConfig = key(30) as PublicKey & { _bn: unknown };
  const attackerSnapshot = key(31) as PublicKey & { _bn: unknown };
  const savedConfigBn = mutableConfig._bn;
  const savedSnapshotBn = mutableSnapshot._bn;

  try {
    mutableConfig._bn = attackerConfig._bn;
    mutableSnapshot._bn = attackerSnapshot._bn;
    assert.equal(findFeedConfigPda(TEST_FEED_ID)[0].toBase58(), canonicalConfig.toBase58());
    assert.equal(findFeedSnapshotPda(TEST_FEED_ID)[0].toBase58(), canonicalSnapshot.toBase58());

    const configData = toTestFeedConfigV1(buildTestFeedConfigHeader((data) => {
      data[CONFIG_OFFSETS.bump] = canonicalBump;
    }));
    const config = verifyMimirFeedConfigV1({
      address: canonicalConfig,
      owner: canonicalProgram,
      executable: false,
      data: configData,
    });
    const snapshotData = buildTestSnapshotHeader((data) => {
      canonicalConfig.toBuffer().copy(data, OFFSETS.feedConfig);
    });
    verifyMimirFeedSnapshotV1({
      address: canonicalSnapshot,
      owner: canonicalProgram,
      executable: false,
      data: snapshotData,
    }, config);

    assert.throws(() => verifyMimirFeedConfigV1({
      address: attackerConfig,
      owner: canonicalProgram,
      executable: false,
      data: configData,
    }));
    assert.throws(() => verifyMimirFeedSnapshotV1({
      address: attackerSnapshot,
      owner: canonicalProgram,
      executable: false,
      data: snapshotData,
    }, config));
  } finally {
    mutableConfig._bn = savedConfigBn;
    mutableSnapshot._bn = savedSnapshotBn;
  }
});


test("canonical collateral Q64 normalizer preserves the accepted exponent bounds", () => {
  const oneX64 = 1n << 64n;
  assert.equal(normalizeMimirCollateralPriceX64(oneX64, -18), 10n ** 18n);
  assert.equal(normalizeMimirCollateralPriceX64(oneX64, 0), 1n);
  assert.equal(normalizeMimirCollateralPriceX64(oneX64, 18), 0n);
  assert.throws(() => normalizeMimirCollateralPriceX64(oneX64, -19), /InvalidMimirCollateralNormalizedPrice/);
  assert.throws(() => normalizeMimirCollateralPriceX64(oneX64, 19), /InvalidMimirCollateralNormalizedPrice/);
  assert.throws(() => normalizeMimirCollateralPriceX64(oneX64, 0.5), /InvalidMimirCollateralNormalizedPrice/);
  assert.throws(() => normalizeMimirCollateralPriceX64(0n, 0), /InvalidMimirCollateralNormalizedPrice/);
});

test("rdv deployment program 4kxKWPh binds owner, PDAs and commitment; untrusted owners fail closed", () => {
  const program = new PublicKey("4kxKWPhWUZMj1x2D2BaCBW9BfeBZ6po4WagfzkUCsAt4");
  const pdas = deriveOrdinaryPdas(TEST_FEED_ID, program);
  const data = toTestFeedConfigV1(buildTestFeedConfigHeader(bytes => { bytes[CONFIG_OFFSETS.bump] = pdas.config[1]; }));
  const shell = { address: pdas.config[0], owner: program, executable: false, data };
  const config = verifyMimirFeedConfigV1(shell, program);
  const snapshotData = buildTestSnapshotHeader(bytes => pdas.config[0].toBuffer().copy(bytes, OFFSETS.feedConfig));
  assert.doesNotThrow(() => verifyMimirFeedSnapshotV1({ address: pdas.snapshot[0], owner: program, executable: false, data: snapshotData }, config));
  const registry = key(25);
  assert.deepEqual(computeMimirFeedPolicyCommitmentV1(registry, config), createHash("sha256").update("MIMIR_FEED_POLICY_COMMITMENT_V1\0", "ascii")
    .update(program.toBuffer()).update(registry.toBuffer()).update(pdas.config[0].toBuffer()).update(data).digest());
  const untrusted = key(77);
  assert.throws(() => verifyMimirFeedConfigV1({ ...shell, owner: untrusted }, program), /InvalidMimirFeedConfigV1Shell/);
  assert.throws(() => verifyMimirFeedConfigV1(shell), /InvalidMimirFeedConfigV1Shell/);
  assert.throws(() => verifyMimirFeedSnapshotV1({ address: pdas.snapshot[0], owner: untrusted, executable: false, data: snapshotData }, config), /InvalidMimirFeedSnapshotV1Shell/);
});
