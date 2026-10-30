import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deriveMimirBetaClassicFeedId, recoverMimirBetaFeedVariant, recoverMimirBetaFeedVariantAsync } from "../src/beta/abi.js";
import type { Address } from "@solana/kit";

const mint = (seed: number) => {
  const bytes = createHash("sha256").update(`variant-${seed}`).digest();
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${bytes.toString("hex")}`), out = "";
  while (n > 0n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  return out as Address;
};
const base = mint(1), quote = mint(2);
const variants = Array.from({ length: 17 }, (_, i) => 0xffff - i * 97);
const feedIds = await Promise.all(variants.map((v) => deriveMimirBetaClassicFeedId(base, quote, v)));

let maxGap = 0, last = performance.now(), beating = true;
const beat = () => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; if (beating) setTimeout(beat, 0); };
setTimeout(beat, 0);
const recovered = await Promise.all(feedIds.map((id) => recoverMimirBetaFeedVariantAsync(base, quote, id)));
beating = false;
assert.deepEqual(recovered, variants);
assert.ok(maxGap < 50, `max event-loop gap ${maxGap.toFixed(1)} ms`);

const t0 = performance.now();
for (const id of feedIds) assert.ok(typeof (await recoverMimirBetaFeedVariantAsync(base, quote, id)) === "number");
assert.ok(performance.now() - t0 < 5, "second pass hits the memo");

const other = mint(3);
const fresh = await deriveMimirBetaClassicFeedId(base, other, 40000);
const a = recoverMimirBetaFeedVariantAsync(base, other, fresh), b = recoverMimirBetaFeedVariantAsync(base, other, fresh);
assert.equal(a, b, "concurrent calls share one search");
assert.equal(await a, 40000);
assert.equal(recoverMimirBetaFeedVariant(base, other, fresh), 40000);

const sync = mint(4);
const syncId = await deriveMimirBetaClassicFeedId(sync, quote, 30000);
assert.equal(recoverMimirBetaFeedVariant(sync, quote, syncId), await recoverMimirBetaFeedVariantAsync(sync, quote, syncId));
assert.equal(await recoverMimirBetaFeedVariantAsync(base, quote, mint(5)), null);
console.log(`variant recovery async ok, max gap ${maxGap.toFixed(1)} ms`);
