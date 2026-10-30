import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const hex = (s) => Uint8Array.from(Buffer.from(s, "hex"));
const toHex = (b) => Buffer.from(b).toString("hex");

export function runCurrentPointVectorParity(api, vectorsPath) {
  const v = JSON.parse(readFileSync(vectorsPath, "utf8"));
  let checks = 0;
  const ok = (cond) => { assert.ok(cond); checks++; };
  ok(toHex(api.MIMIR_CURRENT_POINT_MODEL_HASH) === v.point_model_sha256);
  const p = v.point, record = { slot: BigInt(p.slot), unixTs: BigInt(p.unix), priceX64: BigInt(p.price_x64), fingerprint: hex(p.fingerprint) };
  const state = { context: hex(p.context), sourceConfig: hex(p.source), planHash: hex(p.plan), sequence: BigInt(p.sequence), record };
  ok(toHex(api.computeMimirCurrentPointRecordDigest(state)) === p.record_digest);
  const module = api.encodeMimirCurrentPointModule(state);
  ok(module.length === v.module_length && toHex(module) === v.module_hex);
  ok(createHash("sha256").update(module).digest("hex") === v.module_sha256);
  const decoded = api.decodeMimirCurrentPointModule(hex(v.module_hex));
  ok(decoded.sequence === state.sequence && decoded.record.priceX64 === record.priceX64);
  const ready = api.projectMimirCurrentPointReadiness(decoded, BigInt(p.unix) + 3n);
  ok(ready.status === "CURRENT_POINT_READY" && ready.historySeconds === 0n && ready.ageSeconds === 3n && ready.upperX64 === record.priceX64 + 1n);
  for (const m of v.required_negative_mutations) {
    const raw = hex(v.module_hex); raw.set(hex(m.replacement_hex), m.offset);
    assert.throws(() => api.decodeMimirCurrentPointModule(raw), m.reason); checks++;
  }
  for (const c of v.compact_direction_cases) {
    if (!c.new_parser_bit_layout_valid) { assert.throws(() => api.unpackMimirCompactDirection(c.byte)); checks++; continue; }
    const out = api.unpackMimirCompactDirection(c.byte);
    ok(out.direction === c.direction && (out.temporalMode === "current-point") === c.current_point);
    ok(api.packMimirCompactDirection(c.direction, out.temporalMode) === c.byte);
  }
  return checks;
}
