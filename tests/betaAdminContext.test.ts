import assert from "node:assert/strict";
import { bytesAddress } from "../src/beta/bytes.js";
import { decodeMimirBetaAdminContext } from "../src/beta/context.js";

const key = (byte: number) => Uint8Array.from({ length: 32 }, () => byte);
const address = bytesAddress(key(9));

function admin(flags: number): Uint8Array {
  const out = new Uint8Array(192);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("MIMIRCFG"));
  view.setUint16(8, 1, true); view.setUint16(10, 192, true);
  out[12] = 1; out[13] = 254; out.set(key(1), 16);
  out[89] = flags;
  view.setBigUint64(152, 1n, true); out.set(key(2), 120); out.set(key(3), 160);
  return out;
}

const legacy = await decodeMimirBetaAdminContext(address, admin(0));
assert.equal(legacy.closePower, false); assert.equal(legacy.creationOpen, false);
assert.equal(legacy.collateralRequired, false); assert.equal(legacy.bump, 254);
const closeOnly = await decodeMimirBetaAdminContext(address, admin(1));
assert.equal(closeOnly.closePower, true); assert.equal(closeOnly.creationOpen, false);
const both = await decodeMimirBetaAdminContext(address, admin(3));
assert.equal(both.closePower, true); assert.equal(both.creationOpen, true);
await assert.rejects(decodeMimirBetaAdminContext(address, admin(4)), /admin flags invalid/);
const tail = admin(1); tail[90] = 1;
await assert.rejects(decodeMimirBetaAdminContext(address, tail), /admin collateral padding/);
const fees = admin(3); new DataView(fees.buffer).setUint32(104, 800_000, true); new DataView(fees.buffer).setUint32(108, 700_000, true);
new DataView(fees.buffer).setUint32(112, 1_000_000, true); fees.set([150, 30, 5, 2], 116);
const decodedFees = await decodeMimirBetaAdminContext(address, fees);
assert.deepEqual([decodedFees.compositeActivationOwnerFeeLamports, decodedFees.compositeActivationTreasuryComponentFeeLamports,
  decodedFees.compositeActivationTreasuryCreationFeeLamports, decodedFees.tickerTierTenths], [800_000n, 700_000n, 1_000_000n, [150, 30, 5, 2]]);
assert.deepEqual(legacy.tickerTierTenths, [0, 0, 0, 0]); assert.equal(legacy.compositeActivationOwnerFeeLamports, 0n);
new DataView(fees.buffer).setUint32(108, 100_000_001, true);
await assert.rejects(decodeMimirBetaAdminContext(address, fees), /activation fee above cap/);
console.log("betaAdminContext ok");
