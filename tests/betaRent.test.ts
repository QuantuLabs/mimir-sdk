import assert from "node:assert/strict";
import { computeMimirRentExemptLamports, decodeMimirRentSysvar, getMimirRentExemptLamports, MIMIR_RENT_SYSVAR } from "../src/beta/rent.js";
import { MimirBetaError } from "../src/beta/errors.js";

const sysvar = (lamports: bigint, threshold: number, burn = 50) => {
  const data = new Uint8Array(17); const view = new DataView(data.buffer);
  view.setBigUint64(0, lamports, true); view.setFloat64(8, threshold, true); data[16] = burn; return data;
};
assert.deepEqual(decodeMimirRentSysvar(sysvar(5_080n, 1)), { lamportsPerByteYear: 5_080n, exemptionThreshold: 1, burnPercent: 50 });
assert.throws(() => decodeMimirRentSysvar(new Uint8Array(16)), (e) => e instanceof MimirBetaError && e.code === "ACCOUNT_MALFORMED");
assert.equal(computeMimirRentExemptLamports(decodeMimirRentSysvar(sysvar(5_080n, 1)), 1_406_509n), 7_145_715_960n);
assert.equal(computeMimirRentExemptLamports(decodeMimirRentSysvar(sysvar(3_480n, 2)), 1_406_509n), 9_790_193_520n);
assert.equal(computeMimirRentExemptLamports(decodeMimirRentSysvar(sysvar(3_480n, 2)), 0), 890_880n);
assert.throws(() => computeMimirRentExemptLamports(decodeMimirRentSysvar(sysvar(3_480n, 1.5)), 0),
  (e) => e instanceof MimirBetaError && e.code === "RENT_THRESHOLD_UNSUPPORTED");
const rpc = { getAccountInfo: (address: string, config: object) => ({ send: async () => {
  assert.equal(address, MIMIR_RENT_SYSVAR); assert.deepEqual(config, { commitment: "finalized", encoding: "base64" });
  return { context: { slot: 1n }, value: { data: [Buffer.from(sysvar(3_480n, 2)).toString("base64"), "base64"] } };
} }) } as never;
assert.equal(await getMimirRentExemptLamports(rpc, 165), 2_039_280n);
console.log("betaRent ok");
