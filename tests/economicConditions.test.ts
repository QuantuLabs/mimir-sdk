import assert from "node:assert/strict";
import { makeBetaCaptureFixture } from "./fixtures/betaCaptureFixtures.js";
import { decodeMimirBetaCaptureCandidate } from "../src/beta/capture.js";
import { MIMIR_COND } from "../src/liveness.js";

for (const family of ["meteora-dlmm", "raydium-cpmm", "pumpswap"] as const) {
  const fixture = await makeBetaCaptureFixture(family);
  const healthy = await decodeMimirBetaCaptureCandidate(fixture.input);
  assert.equal(healthy.conditions, undefined);
  const accounts = fixture.input.accounts.map((row) => ({ ...row, data: row.data.slice() }));
  if (family === "meteora-dlmm") {
    const active = new DataView(fixture.poolAccount.data.buffer).getInt32(76, true);
    for (const row of accounts) {
      if (fixture.fixtureAccounts.find((entry) => entry.address === row.address)?.fixtureRole !== "depth-bin-array") continue;
      const local = active - Number(new DataView(row.data.buffer).getBigInt64(8, true)) * 70;
      if (local >= 0 && local < 70) row.data.fill(0, 56 + local * 144, 56 + local * 144 + 16);
    }
  } else {
    for (const role of family === "pumpswap" ? ["quote-vault"] : ["base-vault", "quote-vault"]) {
      const vault = fixture.fixtureAccounts.find((entry) => entry.fixtureRole === role)!;
      new DataView(accounts.find((row) => row.address === vault.address)!.data.buffer).setBigUint64(64, family === "pumpswap" ? 0n : 1n, true);
    }
  }
  if (family === "pumpswap") {
    new DataView(accounts.find((row) => row.address === fixture.poolAccount.address)!.data.buffer).setBigUint64(245, 1_000_000n, true);
  }
  const conditioned = await decodeMimirBetaCaptureCandidate({ ...fixture.input, accounts });
  assert.equal(conditioned.pool, healthy.pool, family);
  assert.equal(conditioned.conditions, MIMIR_COND.DEPTH_BELOW_FLOOR, family);
}
console.log("economic conditions tests passed");
