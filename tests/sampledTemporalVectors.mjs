import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const hex = (value) => Uint8Array.from(Buffer.from(value, "hex"));
const toHex = (bytes) => Buffer.from(bytes).toString("hex");
const record = (row) => ({ slot: BigInt(row.slot), unixTs: BigInt(row.unix), priceX64: BigInt(row.price_x64), observationHash: hex(row.observation_hash) });
const point = (row) => ({ record: record(row), observedDepthNative: BigInt(row.observed_depth_input) });
const SOURCE = new Uint8Array(32).fill(2), PLAN = new Uint8Array(32).fill(3);

function summaryMatches(api, state, expected, label) {
  const s = api.summarizeMimirSampledState(state);
  const actual = { start_unix: s.startUnixTs, end_unix: s.endUnixTs, support_seconds: s.supportSeconds, actual_records: s.actualRecords,
    integral_x64_seconds: s.integralX64Seconds, mean_x64: s.meanX64, lower_x64: s.lowerX64, upper_x64: s.upperX64,
    observed_band_bps: s.observedBandBps, confidence_bps: s.confidenceBps, close_deviation_bps: s.closeDeviationBps,
    depth_floor_quote_native: s.depthFloorQuoteNative, accepted_count: s.acceptedCount, sequence: s.sequence, next_index: s.nextIndex,
    temporal_ready: s.temporalReady, ready: s.ready, flags: s.flags, last_accepted_bucket: s.lastAcceptedBucket,
    next_eligible_unix: s.nextEligibleUnixTs };
  for (const [key, value] of Object.entries(expected)) assert.equal(String(actual[key]), String(value), `${label}.${key}`);
}

function attempt(fn) {
  try { return { ok: true, value: fn() }; } catch (error) { return { ok: false, error: error.code ?? error.message }; }
}

/** Returns the number of golden-vector checks; throws on the first mismatch. */
export function runSampledTemporalVectorParity(api, dir) {
  const load = (name) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
  let checks = 0;
  const base = { sourceConfig: SOURCE, planHash: PLAN };
  for (const v of load("sampler")) {
    if (v.events) {
      let state = null;
      for (const [index, event] of v.events.entries()) {
        const result = api.applyMimirSampledObservation(state, point(event.input), hex(v.context), base);
        assert.equal(result.action, event.action, `${v.id}[${index}]`);
        state = result.state; summaryMatches(api, state, event.post, `${v.id}[${index}]`); checks++;
      }
      assert.equal(toHex(api.encodeMimirSampledTemporalModule(state)), v.module_hex, v.id);
      assert.equal(toHex(api.computeMimirSampledHistoryDigest(state)), v.history_digest, v.id);
      const decoded = api.decodeMimirSampledTemporalModule(hex(v.module_hex), record(v.events.at(-1).input));
      summaryMatches(api, decoded, v.final, `${v.id}.decode`); checks++;
      continue;
    }
    if (v.id === "forged_context_not_reset") continue;
    let previous = null;
    if (v.initial_module_hex) previous = api.decodeMimirSampledTemporalModule(hex(v.initial_module_hex), record(v.initial_closure));
    if (v.initial_sequence) {
      const seed = load("abi").module;
      previous = { ...api.decodeMimirSampledTemporalModule(hex(seed.hex), record(seed.closure)), sequence: BigInt(v.initial_sequence) };
    }
    const options = { ...base };
    if (v.options?.expected_prev_slot !== undefined) options.expectedPrevSlot = BigInt(v.options.expected_prev_slot);
    if (v.options?.existing_ring_slot !== undefined) options.existingRingSlot = BigInt(v.options.existing_ring_slot);
    if (v.options?.source_depth_floor !== undefined) options.sourceDepthFloor = BigInt(v.options.source_depth_floor);
    if (v.source_depth_floor !== undefined) options.sourceDepthFloor = BigInt(v.source_depth_floor);
    const context = v.context ?? (v.source_depth_floor ? createHash("sha256").update("context-floor-100").digest("hex") : previous ? toHex(previous.context) : v.context);
    const result = attempt(() => api.applyMimirSampledObservation(previous, point(v.input), hex(context), options));
    assert.equal(result.ok, v.expected.ok, `${v.id}: ${result.error}`);
    if (!result.ok) { assert.equal(result.error, v.expected.error, v.id); checks++; continue; }
    assert.equal(result.value.action, v.expected.action, v.id);
    if (v.expected.post) summaryMatches(api, result.value.state, v.expected.post, v.id);
    if (v.expected.history_digest) assert.equal(toHex(api.computeMimirSampledHistoryDigest(result.value.state)), v.expected.history_digest, v.id);
    if (v.expected.module_hex) assert.equal(toHex(api.encodeMimirSampledTemporalModule(result.value.state)), v.expected.module_hex, v.id);
    checks++;
  }
  const abi = load("abi");
  assert.equal(toHex(api.MIMIR_SAMPLED_INTERVAL_MODEL_HASH), abi.mimir_model_hash);
  const decoded = api.decodeMimirSampledTemporalModule(hex(abi.module.hex), record(abi.module.closure));
  summaryMatches(api, decoded, abi.module.decoded, "abi.module");
  assert.equal(toHex(api.encodeMimirSampledTemporalModule(decoded)), abi.module.hex);
  const rejects = [[abi.invalid_nonzero_unused.hex, abi.module.closure, abi.invalid_nonzero_unused.expected.error, {}],
    [abi.n523_module_rejected.hex, abi.module.closure, abi.n523_module_rejected.expected.error, {}],
    ...abi.mutations.map((m) => [m.hex, abi.module.closure, m.expected.error, {}])];
  const pc = abi.policy_context_change;
  rejects.push([pc.old_module_hex, pc.old_closure, pc.unchanged_context_bad_ready_bit.error, { bandLimitBps: 50 }]);
  rejects.push([pc.invalid_intrinsic_ready_hint.module_hex, pc.invalid_intrinsic_ready_hint.closure,
    pc.invalid_intrinsic_ready_hint.expected.error, { bandLimitBps: 50, closeLimitBps: 50, changedContext: true }]);
  for (const [raw, close, error, options] of rejects) {
    const result = attempt(() => api.decodeMimirSampledTemporalModule(hex(raw), record(close), options));
    assert.deepEqual(result, { ok: false, error }); checks++;
  }
  const changed = api.decodeMimirSampledTemporalModule(hex(pc.old_module_hex), record(pc.old_closure),
    { bandLimitBps: 50, closeLimitBps: 50, changedContext: true });
  summaryMatches(api, changed, pc.authenticated_changed_context_decode.value, "changed_context");
  const reset = api.applyMimirSampledObservation(changed, point(pc.reset_input), hex(pc.new_context), base);
  assert.equal(reset.action, pc.reset_expected.action);
  assert.equal(toHex(api.encodeMimirSampledTemporalModule(reset.state)), pc.reset_expected.module_hex); checks += 2;
  for (const v of load("arithmetic")) {
    if (!v.records || v.expected?.mean_x64 === undefined) continue;
    const p = api.projectMimirSampledHistory(v.records.map(record), record(v.close),
      { startUnixTs: v.start === undefined ? undefined : BigInt(v.start), endUnixTs: v.end === undefined ? undefined : BigInt(v.end) });
    for (const [key, field] of [["integral_x64_seconds", "integralX64Seconds"], ["mean_x64", "meanX64"], ["lower_x64", "lowerX64"],
      ["upper_x64", "upperX64"], ["actual_records", "actualRecords"], ["support_seconds", "supportSeconds"]])
      if (v.expected[key] !== undefined) assert.equal(String(p[field]), String(v.expected[key]), `${v.id}.${key}`);
    checks++;
  }
  for (const v of load("captured_abi")) {
    const close = record(v.closing_record);
    const module = api.decodeMimirSampledTemporalModule(hex(v.module_hex), close,
      { depthFloor: BigInt(v.projection.depth_floor_quote_native) });
    summaryMatches(api, module, v.projection, v.id);
    assert.deepEqual(api.mimirSampledClosureFromRing(hex(v.module_hex), hex(v.ring_point_only_hex)), close);
    const snapshot = api.decodeMimirSampledSource6Snapshot(hex(v.source6_snapshot_hex));
    assert.equal(String(snapshot.meanX64), v.projection.mean_x64);
    const ctx = parseContext(hex(v.context_preimage_hex));
    assert.equal(toHex(api.computeMimirSampledContextHash(ctx).hash), v.context_hash);
    const obs = parseObservation(hex(v.observation_preimage_hex));
    assert.equal(toHex(api.computeMimirSampledObservationHash(obs).hash), v.observation_hash);
    assert.equal(v.observation_hash, toHex(close.observationHash));
    checks += 3;
  }
  return checks;
}

function reader(data) {
  let at = 0;
  const take = (n) => { const out = data.slice(at, at + n); at += n; assert.equal(out.length, n); return out; };
  const int = (n) => { let v = 0n; const b = take(n); for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]); return v; };
  return { take, int, blob: () => take(Number(int(4))), done: () => assert.equal(at, data.length) };
}
function parseContext(data) {
  const r = reader(data); assert.equal(Buffer.from(r.take(24)).toString(), "MIMIR_SAMPLED_CONTEXT_V1");
  const out = { mimirProgram: r.take(32), sourceConfig: r.take(32), sourceConfigData: r.blob(), feedConfig: r.take(32), feedConfigData: r.blob(),
    plan: r.take(32), planData: r.blob(), registry: r.take(32), registryData: r.blob(), ring: r.take(32), module: r.take(32),
    dexProgram: r.take(32), programData: r.take(32), deploymentSlot: r.int(8), poolBaseIsSourceBase: r.take(1)[0] === 1 };
  assert.equal(r.take(1)[0], 1);
  const count = Number(r.int(1)); out.dexRoles = Array.from({ length: count }, () => ({ ordinal: Number(r.int(1)), key: r.take(32) }));
  r.done(); return out;
}
function parseObservation(data) {
  const r = reader(data); assert.equal(Buffer.from(r.take(22)).toString(), "MIMIR_SAMPLED_POINT_V1");
  const context = r.take(32), count = Number(r.int(1));
  const dexRoles = Array.from({ length: count }, () => ({ ordinal: Number(r.int(1)), key: r.take(32), owner: r.take(32),
    executable: r.take(1)[0] === 1, data: r.blob() }));
  const [baseDecimals, quoteDecimals, direction, poolBase] = r.take(4);
  const out = { context, dexRoles, baseDecimals, quoteDecimals, direction, poolBaseIsSourceBase: poolBase === 1,
    priceX64: r.int(16), depthNative: r.int(16), liquidityNative: r.int(16) };
  r.done(); return out;
}
