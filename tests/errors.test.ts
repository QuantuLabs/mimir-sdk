import assert from "node:assert/strict";
import {
  MIMIR_PROGRAM_ID,
  formatMimirProgramErrorForUser,
  isRetryableMimirHotStateDrift,
  isRetryableMimirRevisionDrift,
  parseMimirProgramError,
} from "../src/index.js";

function makeMimirCustomError(customCode: number): Error & { logs: string[] } {
  const id = MIMIR_PROGRAM_ID.toBase58();
  const error = new Error(
    `Transaction simulation failed: {"InstructionError":[0,{"Custom":${customCode}}]}`,
  ) as Error & { logs: string[] };
  error.logs = [
    `Program ${id} invoke [1]`,
    `Program ${id} failed: custom program error: 0x${customCode.toString(16)}`,
  ];
  return error;
}

const dispersionError = makeMimirCustomError(33);
const parsedDispersion = parseMimirProgramError(dispersionError);
assert.equal(parsedDispersion?.code, 33);
assert.equal(parsedDispersion?.name, "DispersionTooWide");
for (const [code, name] of [[96, "CreationClosed"], [114, "InvalidPayoutDestination"], [123, "NoticeNotElapsed"], [127, "DuplicateWritableAccount"], [129, "PriceUnrepresentable"], [130, "VenueSourceUnavailable"]] as const) {
  assert.equal(parseMimirProgramError(makeMimirCustomError(code))?.name, name);
}

const activationMessage = formatMimirProgramErrorForUser(dispersionError, {
  action: "activation",
});
assert.match(activationMessage ?? "", /Activation cannot finish yet/);
assert.match(activationMessage ?? "", /Raydium CP-Swap native TWAP/);
assert.match(activationMessage ?? "", /single-source Raydium CP-Swap feed/);
assert.match(activationMessage ?? "", /Wait for the TWAP window to converge/);

const genericMessage = formatMimirProgramErrorForUser(dispersionError);
assert.match(genericMessage ?? "", /Mimir oracle refresh cannot finish yet/);

const invalidTwapMessage = formatMimirProgramErrorForUser(
  makeMimirCustomError(50),
  { action: "activation" },
);
assert.match(invalidTwapMessage ?? "", /Activation cannot finish yet/);
assert.match(invalidTwapMessage ?? "", /Mimir TWAP state is not usable/);
assert.match(invalidTwapMessage ?? "", /Rebuild the oracle refresh/);

assert.equal(
  isRetryableMimirHotStateDrift(makeMimirCustomError(54)),
  true,
  "source-ring expectedPrevNewestSlot drift should rebuild from live state",
);
assert.equal(
  isRetryableMimirHotStateDrift(makeMimirCustomError(56)),
  true,
  "same-slot source-ring refresh should wait/rebuild from live state",
);
assert.equal(isRetryableMimirHotStateDrift(makeMimirCustomError(33)), false);

assert.equal(formatMimirProgramErrorForUser(makeMimirCustomError(58)), null);

for (const code of [54, 58]) assert.equal(isRetryableMimirHotStateDrift(makeMimirCustomError(code), { fusedPublish: true }), false, `fused publish ${code} is not a race`);
assert.equal(isRetryableMimirHotStateDrift(makeMimirCustomError(56), { fusedPublish: true }), true);
assert.equal(isRetryableMimirRevisionDrift(makeMimirCustomError(58), { fusedPublish: true }), false);
assert.equal(isRetryableMimirRevisionDrift(makeMimirCustomError(58)), true);

{
  const { MimirError: E } = await import("../src/easy/price.js");
  assert.match(new E("TICKER_NOT_FOUND", "No Mimir ticker X", "never").hint, /listFeeds/);
  assert.match(new E("TICKER_TAKEN", "taken", "never").hint, /another ticker/);
  assert.match(new E("INVALID_INPUT", "quantity 0: a number above 0", "never").hint, /quantity 0/);
  console.log("errors code hints: ok");
}

{
  const { brand } = await import("../src/brand.js");
  const { MimirBetaError, MimirBetaUnpriceableError, MimirBetaCompositeQualityError } = await import("../src/beta/errors.js");
  class CopyBase extends Error {}
  brand("@quantulabs/mimir-sdk/beta:MimirBetaError", CopyBase);
  class CopyUnpriceable extends CopyBase {}
  brand("@quantulabs/mimir-sdk/beta:MimirBetaUnpriceableError", CopyUnpriceable);
  class CopyQuality extends CopyUnpriceable {}
  brand("@quantulabs/mimir-sdk/beta:MimirBetaCompositeQualityError", CopyQuality);
  assert.ok(new CopyQuality() instanceof MimirBetaCompositeQualityError);
  assert.ok(new CopyQuality() instanceof MimirBetaUnpriceableError);
  assert.ok(new CopyBase() instanceof MimirBetaError);
  assert.ok(!(new CopyBase() instanceof MimirBetaUnpriceableError));
  const { MimirV1CreationTooLargeError } = await import("../src/v1/tx.js");
  class CopyTooLarge extends CopyBase {}
  brand("@quantulabs/mimir-sdk/v1:MimirV1CreationTooLargeError", CopyTooLarge);
  assert.ok(new CopyTooLarge() instanceof MimirV1CreationTooLargeError);
  assert.ok(new MimirV1CreationTooLargeError(1, 1) instanceof CopyTooLarge && new MimirV1CreationTooLargeError(1, 1) instanceof MimirBetaError);
  assert.ok(!(new CopyBase() instanceof MimirV1CreationTooLargeError));
  console.log("beta errors brand across copies: ok");
}
