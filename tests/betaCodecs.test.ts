import assert from "node:assert/strict";
import { bytesAddress } from "../src/beta/bytes.js";
import { assertMimirBetaActiveCreationContext, decodeMimirBetaRegistryContext } from "../src/beta/context.js";
import { MimirBetaError } from "../src/beta/errors.js";
import {
  decodeMimirClassicConfig,
  decodeMimirCompositeConfig,
  encodeMimirClassicV1,
  encodeMimirCompositeV1,
} from "../src/beta/codecs.js";
import {
  computeMimirBetaTickerTariff,
  decodeMimirBetaTicker,
  deriveMimirBetaTickerPda,
  encodeMimirBetaTicker,
} from "../src/beta/abi.js";

const key = (byte: number) => Uint8Array.from({ length: 32 }, () => byte);
const asset = bytesAddress(key(9));

function classic(): Uint8Array {
  const out = new Uint8Array(325);
  out.set(new TextEncoder().encode("MIMIRCFG"));
  new DataView(out.buffer).setUint16(10, 325, true);
  out.set(key(1), 16); out.set(key(2), 48); out.set(key(3), 80);
  out[118] = 9; out[119] = 6; out[120] = 1; out[121] = 1; out[122] = 1; out[312] = 7;
  return out;
}

function composite(): Uint8Array {
  const out = new Uint8Array(629);
  out.set(new TextEncoder().encode("MIMIRCFC"));
  new DataView(out.buffer).setUint16(10, 629, true);
  out.set(key(1), 16); out.set(key(2), 48); out.set(key(3), 80); out[119] = 1;
  out[116] = 1; out[117] = 4;
  const view = new DataView(out.buffer); view.setUint16(120, 1, true); view.setUint16(122, 1, true);
  view.setBigUint64(160, 1n, true); view.setBigUint64(168, 1n, true); view.setBigUint64(176, 1n, true);
  out.set(key(4), 128); out[184] = 8; out.set(key(5), 229); out.set(key(6), 261);
  new DataView(out.buffer).setBigUint64(293, 1n, true);
  return out;
}

function compositeN2(): Uint8Array {
  const out = composite(); out[119] = 2; out.set(key(1), 229); out.set(key(15), 309); out.set(key(7), 341);
  new DataView(out.buffer).setBigUint64(373, 1n, true);
  return out;
}

const classicV0 = classic();
assert.throws(() => decodeMimirClassicConfig(classicV0), /wrong version\/header\/length tuple/);
const classicV1 = encodeMimirClassicV1(classicV0, asset, "ABC123");
assert.equal(classicV1.length, 357);
assert.equal(decodeMimirClassicConfig(classicV1).identityAsset, asset);
assert.equal(decodeMimirClassicConfig(classicV1).ticker, "ABC123");
assert.deepEqual(encodeMimirClassicV1(decodeMimirClassicConfig(classicV1).rawV0, asset, "ABC123"), classicV1);

const compositeV0 = composite();
assert.throws(() => decodeMimirCompositeConfig(compositeV0), /wrong version\/header\/length tuple/);
const compositeV1 = encodeMimirCompositeV1(compositeV0, asset, "INDEX");
assert.equal(decodeMimirCompositeConfig(compositeV1).identityAsset, asset);
assert.equal(decodeMimirCompositeConfig(compositeV1).ticker, "INDEX");

const compositeN2V1 = encodeMimirCompositeV1(compositeN2(), asset, "INDEX");
const compositeN2Input = Buffer.from(compositeN2V1); const compositeN2Before = Buffer.from(compositeN2Input);
assert.deepEqual(decodeMimirCompositeConfig(compositeN2Input).components.map(({ feed }) => feed),
  [bytesAddress(key(1)), bytesAddress(key(15))], "canonical ordering follows feed bytes 01 < 0f");
assert.deepEqual(compositeN2Input, compositeN2Before, "N2 decode leaves authoritative Buffer bytes unchanged");
const reversedN2 = Buffer.from(compositeN2V1); const firstN2Component = Buffer.from(reversedN2.subarray(229, 309));
reversedN2.copyWithin(229, 309, 389); reversedN2.set(firstN2Component, 309);
assert.throws(() => decodeMimirCompositeConfig(reversedN2), /composite components not canonical/);
const duplicateN2 = Buffer.from(compositeN2V1); duplicateN2.set(key(1), 309);
assert.throws(() => decodeMimirCompositeConfig(duplicateN2), /duplicate or zero composite component/);

for (const [bytes, decode] of [[classicV1, decodeMimirClassicConfig], [compositeV1, decodeMimirCompositeConfig]] as const) {
  const input = Buffer.from(bytes), before = Buffer.from(input);
  decode(input);
  assert.deepEqual(input, before, "decoding a Node Buffer must not mutate authoritative account bytes");
  assert.equal(decode(input).version, 1);
}

for (const invalid of [
  classicV1.slice(0, 356),
  Uint8Array.from([...classicV1, 0]),
  (() => { const value = classicV1.slice(); value[8] = 2; return value; })(),
  (() => { const value = classicV1.slice(); value.fill(0, 325); return value; })(),
  (() => { const value = classicV1.slice(); value[313] = 0; return value; })(),
]) assert.throws(() => decodeMimirClassicConfig(invalid));

for (const invalid of [
  compositeV1.slice(0, 660),
  Uint8Array.from([...compositeV1, 0]),
  (() => { const value = compositeV1.slice(); value[10] = 0; return value; })(),
  (() => { const value = compositeV1.slice(); value.fill(0, 629); return value; })(),
  (() => { const value = compositeV1.slice(); value[185] = 0; return value; })(),
]) assert.throws(() => decodeMimirCompositeConfig(invalid));

assert.equal(decodeMimirClassicConfig(encodeMimirClassicV1(classicV0, asset, "abcdef")).ticker, "ABCDEF");
const twelveTickerBytes = encodeMimirBetaTicker("ab12xyzwvu34");
assert.deepEqual([...twelveTickerBytes], [...new TextEncoder().encode("AB12XYZWVU34")]);
assert.equal(decodeMimirBetaTicker(twelveTickerBytes), "AB12XYZWVU34");
assert.equal(decodeMimirClassicConfig(encodeMimirClassicV1(classicV0, asset, "AB12XYZWVU34")).ticker, "AB12XYZWVU34");
for (const ticker of ["A", "AB12XYZ", "AB12XYZW", "AB12XYZWVU34"]) {
  const bytes = encodeMimirBetaTicker(ticker);
  assert.equal(bytes.length, 12);
  if (ticker.length < 12) assert.deepEqual([...bytes.subarray(0, 1 + ticker.length)], [ticker.length, ...new TextEncoder().encode(ticker)]);
  assert.equal(decodeMimirBetaTicker(bytes), ticker);
  assert.equal(decodeMimirCompositeConfig(encodeMimirCompositeV1(compositeV0, asset, ticker)).ticker, ticker);
}
const tickerProgramId = bytesAddress(key(42));
assert.deepEqual(await deriveMimirBetaTickerPda(tickerProgramId, "ABCDEF"),
  ["CGLWzURbNiFZt7CCpH8TznfwMFAEtT4YVPHEhRdSUBvb", 252]);
assert.deepEqual(await deriveMimirBetaTickerPda(tickerProgramId, "ABC1234"),
  ["5mGUkx2mnQsTdscEmQ1VcLxsSHFoi5PtyLW7gcTYgmnk", 254]);
for (const invalid of [
  Uint8Array.of(7, 65, 66, 49, 50, 88, 89),
  Uint8Array.of(7, 65, 66, 49, 50, 88, 89, 0, 0, 0, 0, 0),
  Uint8Array.of(12, 65, 66, 49, 50, 88, 89, 65, 66, 49, 50, 88),
  Uint8Array.of(65, 66, 49, 50, 88, 89, 65, 66, 49, 50, 88, 58),
  Uint8Array.of(65, 66, 49, 50, 88, 89, 65, 66, 49, 50, 88, 122),
]) assert.throws(() => decodeMimirBetaTicker(invalid));
for (const ticker of ["", "TOOLONGTICKER", "A-B", "AB_C", "AB.CD", "É"]) {
  assert.throws(() => encodeMimirClassicV1(classicV0, asset, ticker));
}

const base = 50_000_000_000_000n;
for (const [ticker, expected] of [["AB", 750_000_000_000_000n], ["ABC", 150_000_000_000_000n],
  ["ABCD", 25_000_000_000_000n], ["ABCDE", 10_000_000_000_000n], ["ABCDEF", 10_000_000_000_000n],
  ["ABCDEFG", 10_000_000_000_000n], ["ABCDEFGH", 10_000_000_000_000n], ["ABCDEFGHIJ", 10_000_000_000_000n],
  ["ABCDEFGHIJKL", 10_000_000_000_000n]] as const) {
  assert.equal(computeMimirBetaTickerTariff(base, ticker), expected);
}
assert.equal(computeMimirBetaTickerTariff(base, "A"), 0n);
assert.throws(() => computeMimirBetaTickerTariff((1n << 64n) - 1n, "AB"));
assert.throws(() => computeMimirBetaTickerTariff(3n, "ABCD"));
assert.throws(() => computeMimirBetaTickerTariff(6n, "ABCDE"));
assert.throws(() => computeMimirBetaTickerTariff(6n, "ABCDEFGHIJKL"));
assert.throws(() => computeMimirBetaTickerTariff(base, "ABCDEFGHIJKLM"));

{
  const registryData = new Uint8Array(128);
  registryData.set(new TextEncoder().encode("MIMIRREG"));
  const view = new DataView(registryData.buffer);
  view.setUint16(10, 128, true);
  registryData.set(key(1), 16);
  view.setBigUint64(80, 1n, true); view.setUint16(88, 1, true); view.setBigUint64(96, 1n, true);
  view.setUint16(106, 1, true);
  const registry = await decodeMimirBetaRegistryContext(bytesAddress(key(7)), registryData);
  assert.equal(registry.emergencyAuthority, null);
  const admin = { status: 1 } as Parameters<typeof assertMimirBetaActiveCreationContext>[0]["admin"];
  assert.doesNotThrow(() => assertMimirBetaActiveCreationContext({ registry, admin }));
  registryData.set(key(2), 48);
  const stale = await decodeMimirBetaRegistryContext(bytesAddress(key(7)), registryData);
  assert.equal(stale.emergencyAuthority, bytesAddress(key(2)));
  assert.throws(() => assertMimirBetaActiveCreationContext({ registry: stale, admin }),
    (error: unknown) => error instanceof MimirBetaError && error.code === "PLAN_STALE");
}

console.log("beta codecs tests passed");
