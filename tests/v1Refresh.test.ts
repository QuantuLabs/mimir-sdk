import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import bs58 from "bs58";
import type { Address } from "@solana/kit";
import { buildMimirV1FusedCompositeRefreshInstruction, decodeV1ClassicFeed, decodeV1CompositeFeed, mimirV1RefreshComputeUnitLimit,
  prepareMimirV1ClassicRefresh, prepareMimirV1CompositeRefresh } from "../src/v1/index.js";
import { mimirV1RowVectors } from "../src/v1/refresh.js";
import { mimirExecutableGenerationPins } from "../src/internal/nativeMonoRefreshCore.js";
import { getProgramDerivedAddress } from "@solana/kit";
import { orcaSqrtPriceX64FromTickIndex, raydiumSqrtPriceX64FromTickIndex } from "../src/beta/capture.js";
import { staticConnection } from "./helpers/staticConnection.js";
import { MimirBetaStalePreparationError, MimirBetaSimulationError } from "../src/beta/errors.js";
import * as C from "../src/v1/layout/common.js";
import * as K from "../src/v1/layout/classic.js";

// V1 worlds dumped by the v1-harness (`tests/v1_sdk_refresh.rs`, ELF f051ea1) after CREATE_CLASSIC / CREATE_COMPOSITE on captured
// mainnet pools; `expected` is the instruction that published Fresh there. Only the accounts the preparer read are kept.
const dir = new URL("./fixtures/v1Refresh/", import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const prepare = (f: ReturnType<typeof load>, accounts = f.accounts, read = new Set<string>()) => {
  const connection = staticConnection(f.slot, accounts, read);
  const opts = { programId: f.programId as Address, cluster: f.cluster };
  return f.request.kind === "classic" ? prepareMimirV1ClassicRefresh(connection, f.request.feed, opts)
    : prepareMimirV1CompositeRefresh(connection, f.request.composite, f.request.payer, opts);
};

const names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
assert.equal(names.length, 8, "7 Classic families + 1 N2 composite");
for (const name of names) {
  const f = load(name);
  const read = new Set<string>(), p = await prepare(f, f.accounts, read);
  for (const { address } of p.instruction.accounts) {
    if (address !== "11111111111111111111111111111111" && address !== "Sysvar1nstructions1111111111111111111111111")
      assert.ok(read.has(address), `${name} captures every final instruction account`);
  }
  assert.equal(p.instruction.programAddress, f.expected.programId, name);
  assert.deepEqual(p.instruction.accounts.map((a) => ({ address: a.address, isSigner: a.isSigner, isWritable: a.isWritable })), f.expected.accounts, `${name} metas`);
  assert.equal(Buffer.from(p.instruction.data).toString("hex"), f.expected.data, `${name} data`);
  assert.equal(p.computeUnitLimit, f.expected.computeUnitLimit, `${name} CU hint`);
  assert.equal(p.mode, "publish");
  assert.equal(p.instruction.data[0], f.request.kind === "classic" ? 89 : 87);
}

// Sample-only: new = previous, no reuse window; composite sample carries no fee.
{
  const f = load("usdc_ammv4_sampled.json");
  const p = await prepareMimirV1ClassicRefresh(staticConnection(f.slot, f.accounts), f.request.feed, { programId: f.programId, mode: "sample" });
  const v = new DataView(p.instruction.data.buffer, p.instruction.data.byteOffset);
  assert.equal(v.getBigUint64(35, true), v.getBigUint64(43, true), "sample: new == previous");
  assert.equal(p.instruction.data[93], 1, "sample: ensure floors by default");
}
// Sample-only needs a temporal-module, converter or q<N row; an all-required S=0 feed without modules requires publish.
for (const [name, ok] of [["usdc_ammv4_sampled.json", true], ["sol_quoted_orca.json", true], ["sol_usdc_clmm.json", false], ["usdc_2src_clmm_orca.json", false]] as const) {
  const f = load(name);
  for (const exactSample of [false, true]) {
    const run = prepareMimirV1ClassicRefresh(staticConnection(f.slot, f.accounts), f.request.feed, { programId: f.programId, cluster: f.cluster, mode: "sample", exactSample });
    if (ok) assert.equal((await run).mode, "sample", name); else await assert.rejects(run, (e: { code?: string; message: string }) => e.code === "INVALID_ARGUMENT" && /requires publish/.test(e.message), name);
  }
}

// Wrong owner, and a full-membership row whose sealed tuple no longer matches the live vector.
{
  const f = load("usdc_ammv4_sampled.json");
  const feed = f.request.feed as string;
  await assert.rejects(prepare(f, { ...f.accounts, [feed]: { ...f.accounts[feed], owner: "11111111111111111111111111111111" } }), /ACCOUNT_OWNER_MISMATCH/);
  const data = Buffer.from(f.accounts[feed].data, "base64");
  const decoded = decodeV1ClassicFeed(data);
  const m = decoded.memberships[0]!;
  assert.equal(m.derived, false, "AMM v4 keeps full tuples");
  const at = data.indexOf(Buffer.from(bs58.decode(m.tuples[0]!.address)), 1_558 + 944 * decoded.header.n);
  assert.ok(at > 0);
  data[at] ^= 1;
  await assert.rejects(prepare(f, { ...f.accounts, [feed]: { ...f.accounts[feed], data: data.toString("base64") } }), /PLAN_STALE/);
}
// Orca sparse (uninitialized) lower/active/upper tick array: same tag89 instruction and CU; spot (7) and quiet marker (9) vectors keep L/A/U.
for (const name of ["sol_quoted_orca.json", "usdc_2src_clmm_orca.json"]) {
  const f = load(name);
  const decoded = decodeV1ClassicFeed(Buffer.from(f.accounts[f.request.feed].data, "base64"));
  const rows = [...decoded.rows, ...(decoded.converter?.rows ?? [])];
  const orca = rows.findIndex((r) => r.descriptor.adapterType === 0);
  assert.ok(orca >= 0, name);
  const quietRows = rows.map((r, i) => i === orca ? { ...r, descriptor: { ...r.descriptor, mode: 3 } } : r);
  const spot = (await mimirV1RowVectors(staticConnection(f.slot, f.accounts), rows, decoded.memberships))[orca]!;
  const quiet = (await mimirV1RowVectors(staticConnection(f.slot, f.accounts), quietRows, decoded.memberships))[orca]!;
  assert.equal(spot.length, 7); assert.equal(quiet.length, 9);
  assert.deepEqual(quiet.slice(0, 7), spot);
  assert.deepEqual(quiet.slice(7), mimirExecutableGenerationPins("mainnet").orca.slice(0, 2));
  for (const tick of spot.slice(4, 7)) {
    const sparse = { ...f.accounts, [tick]: null };
    const p = await prepare(f, sparse);
    assert.deepEqual(p.instruction.accounts.map((a) => ({ address: a.address, isSigner: a.isSigner, isWritable: a.isWritable })), f.expected.accounts, `${name} sparse metas`);
    assert.equal(Buffer.from(p.instruction.data).toString("hex"), f.expected.data, `${name} sparse data`);
    assert.equal(p.computeUnitLimit, f.expected.computeUnitLimit, `${name} sparse CU`);
    assert.deepEqual((await mimirV1RowVectors(staticConnection(f.slot, sparse), quietRows, decoded.memberships))[orca], quiet);
    await assert.rejects(prepare(f, { ...f.accounts, [tick]: { ...f.accounts[tick], owner: "11111111111111111111111111111111", data: "AQ==" } }), /ACCOUNT_OWNER_MISMATCH/);
    await assert.rejects(prepare(f, { ...f.accounts, [tick]: { ...f.accounts[tick], owner: "11111111111111111111111111111111", executable: true, data: "" } }));
  }
  const config = spot[3]!;
  await assert.rejects(prepare(f, { ...f.accounts, [config]: null }));
}
// Edge arrays: a pool in the venue's outermost array keeps three distinct L/A/U metas; the out-of-domain neighbour is its exact,
// absent (null RPC) PDA; a real array at that role is refused.
const edgeWorld = async (f: ReturnType<typeof load>, venue: "whir" | "CAMM", tick: number) => {
  const orca = venue === "whir";
  const [pool, row] = Object.entries<{ owner: string; data: string }>(f.accounts).find(([, v]) => v?.owner.startsWith(venue) && Buffer.from(v.data, "base64").length === (orca ? 653 : 1_544))!;
  const data = Buffer.from(row.data, "base64"), [spacingAt, sqrtAt, tickAt, per] = orca ? [41, 65, 81, 88] : [235, 253, 269, 60];
  const span = data.readUInt16LE(spacingAt) * per, owner = row.owner as Address;
  const pda = async (start: number) => (await getProgramDerivedAddress({ programAddress: owner, seeds: ["tick_array", bs58.decode(pool),
    orca ? start.toString() : (() => { const b = Buffer.alloc(4); b.writeInt32BE(start); return b; })()] }))[0];
  const window = (t: number) => { const a = Math.floor(t / span) * span; return Promise.all([a - span, a, a + span].map(pda)); };
  const [before, after] = [await window(data.readInt32LE(tickAt)), await window(tick)];
  data.writeInt32LE(tick, tickAt);
  const sqrt = (orca ? orcaSqrtPriceX64FromTickIndex : raydiumSqrtPriceX64FromTickIndex)(tick);
  data.writeBigUInt64LE(sqrt & ((1n << 64n) - 1n), sqrtAt); data.writeBigUInt64LE(sqrt >> 64n, sqrtAt + 8);
  const accounts = { ...f.accounts, [pool]: { ...row, data: data.toString("base64") }, ...Object.fromEntries(after.map((a) => [a, null])) };
  return { accounts, before, after };
};
for (const [name, venue, tick] of [["sol_quoted_orca.json", "whir", -443_600], ["sol_quoted_orca.json", "whir", 443_600],
  ["sol_usdc_clmm.json", "CAMM", -443_630], ["sol_usdc_clmm.json", "CAMM", 443_630]] as const) {
  const f = load(name), { accounts, before, after } = await edgeWorld(f, venue, tick);
  const p = await prepare(f, accounts);
  const swap = (a: string) => before.includes(a as Address) ? after[before.indexOf(a as Address)]! : a;
  assert.deepEqual(p.instruction.accounts.map((a) => ({ address: a.address, isSigner: a.isSigner, isWritable: a.isWritable })),
    f.expected.accounts.map((a: { address: string }) => ({ ...a, address: swap(a.address) })), `${name} ${tick} edge metas`);
  assert.equal(p.computeUnitLimit, f.expected.computeUnitLimit, `${name} ${tick} edge CU`);
  const outer = after[tick < 0 ? 0 : 2]!;
  await assert.rejects(prepare(f, { ...accounts, [outer]: f.accounts[before[1]!] }), `${name} ${tick} real array at the out-of-domain role`);
}
// Composite fused-row edge plan: the N2 composite with its first row replaced by the Orca raw row at the bottom edge tick.
{
  const f = load("composite_n2.json"), o = load("sol_quoted_orca.json");
  const c = decodeV1CompositeFeed(Buffer.from(f.accounts[f.request.composite].data, "base64"), f.request.composite);
  const od = decodeV1ClassicFeed(Buffer.from(o.accounts[o.request.feed].data, "base64"));
  const i = od.rows.findIndex((r) => r.descriptor.adapterType === 0);
  const rows = [od.rows[i]!, ...c.rows.slice(1)], memberships = [od.memberships[i]!, ...c.memberships.slice(1)];
  const { accounts, before, after } = await edgeWorld(o, "whir", -443_600);
  const plan = async (world: Record<string, unknown>) => {
    const vectors = await mimirV1RowVectors(staticConnection(o.slot, { ...f.accounts, ...world }), rows, memberships, { cluster: f.cluster });
    const ix = buildMimirV1FusedCompositeRefreshInstruction({ programId: f.programId, payer: f.request.payer, composite: f.request.composite,
      registry: f.expected.accounts[2].address, adminConfig: f.expected.accounts[3].address, treasury: f.expected.accounts[4].address,
      decoded: { rows, converter: null }, componentAccounts: vectors, converterAccounts: [],
      request: { compositeFeedId: c.config.feedId, expectedConfigRevision: c.config.configRevision, previousSnapshotRevision: 1n, nextSnapshotRevision: 2n,
        componentSourceConfigRevisions: rows.map(() => 1n), maxRefreshFeeLamports: 0n, componentRingNewestSlots: rows.map(() => 0n), converterRingNewestSlots: [] } });
    return { vectors, metas: ix.accounts.map((a) => a.address), cu: mimirV1RefreshComputeUnitLimit(vectors.length) };
  };
  const [base, edge] = [await plan(o.accounts), await plan(accounts)];
  assert.deepEqual(base.vectors[0]!.slice(4, 7), before, "composite control: interior L/A/U");
  assert.equal(accounts[after[0]!], null, "composite edge: out-of-domain neighbour is an absent PDA");
  assert.deepEqual(edge.vectors[0]!.slice(4, 7), after, "composite edge: three derived L/A/U metas");
  assert.deepEqual(edge.metas, base.metas.map((a) => before.includes(a as Address) ? after[before.indexOf(a as Address)]! : a), "composite edge metas");
  assert.equal(edge.cu, base.cu, "composite edge CU hint");
  assert.equal(edge.cu, f.expected.computeUnitLimit, "composite edge CU hint = N2 hint");
}
// DLMM direct at an array edge (preserved bin-70 capture; its upper-edge mirror at bin 139): the planned non-active neighbour bin array
// is an absent PDA; the direct vector keeps the same four accounts (Classic and composite). A missing active array, or a routeable row
// needing that neighbour, is refused.
const bin70 = JSON.parse(readFileSync(new URL("./fixtures/dlmmBin70Boundary.json", import.meta.url), "utf8"));
const [dlmmPool, dlmmActive] = ["9d9mb8kooFfaD3SctgZtkxQypkshx6ezhbKio89ixyy2", "3MysKYcjD3Lxf9TfqpSXLD2sMZoMxgmkzoXpAYfq8uFc"];
const upperEdge = (() => {
  const pool = Buffer.from(bin70[dlmmPool].data, "base64"), array = Buffer.from(bin70[dlmmActive].data, "base64");
  pool.writeInt32LE(139, 76); array.copy(array, 56 + 69 * 144, 56, 56 + 144); array.fill(0, 56 + 69 * 144 + 16, 56 + 69 * 144 + 32);
  return { [dlmmPool]: { ...bin70[dlmmPool], data: pool.toString("base64") }, [dlmmActive]: { ...bin70[dlmmActive], data: array.toString("base64") } };
})();
for (const name of ["usdc_dlmm.json", "composite_n2.json"]) {
  const f = load(name);
  const d = f.request.kind === "classic" ? decodeV1ClassicFeed(Buffer.from(f.accounts[f.request.feed].data, "base64"))
    : decodeV1CompositeFeed(Buffer.from(f.accounts[f.request.composite].data, "base64"), f.request.composite);
  const i = d.rows.findIndex((r) => r.descriptor.adapterType === 3);
  const vectors = (accounts: typeof f.accounts, memberships = d.memberships) =>
    mimirV1RowVectors(staticConnection(f.slot, accounts), d.rows, memberships, { cluster: f.cluster });
  const base = (await vectors(f.accounts))[i]!;
  assert.equal(base.length, 4, name);
  for (const [edge, overlay] of [["lower", { [dlmmPool]: bin70[dlmmPool], [dlmmActive]: bin70[dlmmActive] }], ["upper", upperEdge]] as const) {
    const accounts = { ...f.accounts, ...overlay };
    assert.deepEqual((await vectors(accounts))[i], base, `${name} ${edge} edge direct vector`);
    if (f.request.kind === "classic") {
      const p = await prepare(f, accounts);
      assert.deepEqual(p.instruction.accounts.map((a) => a.address), f.expected.accounts.map((a: { address: string }) => a.address), `${name} ${edge} edge metas`);
    }
    await assert.rejects(vectors({ ...accounts, [dlmmActive]: null }), /ACCOUNT_OWNER_MISMATCH/, `${name} ${edge} edge missing active array`);
    await assert.rejects(vectors(accounts, d.memberships.map((m, j) => j === i ? { ...m, bindingVariant: 1, derived: true } : m)), /PLAN_STALE/, `${name} ${edge} edge routeable neighbour`);
  }
}
// On-demand canonical neighbour (bin 70, step 50, Legacy t=1, lower arm clipped): a visible window that passes appends nothing; a failing
// one appends only the authentic lower array -1 -> 0 when it repairs the floor; thin, malformed or opted-out neighbours keep the base vector.
{
  const f = load("usdc_dlmm.json"), d = decodeV1ClassicFeed(Buffer.from(f.accounts[f.request.feed].data, "base64"));
  const lowerKey = "2JGdvbwbKnfNTJhTDcrm9shbWiTqVgpKNvzxBGiF9FqW";
  const thin = Buffer.from(bin70[dlmmActive].data, "base64"); thin.writeBigUInt64LE(100_000_000n, 64);
  const neighbour = (y: bigint, index = 0n) => {
    const a = Buffer.from(bin70[dlmmActive].data, "base64"); a.fill(0, 56); a.writeBigInt64LE(index, 8); a.writeBigUInt64LE(y, 64 + 69 * 144);
    return { ...bin70[dlmmActive], data: a.toString("base64") };
  };
  const world = (active: string, lower: unknown) => ({ ...f.accounts, [dlmmPool]: bin70[dlmmPool], [dlmmActive]: { ...bin70[dlmmActive], data: active }, [lowerKey]: lower });
  const vectors = async (accounts: typeof f.accounts, dlmmOptionalNeighbours?: boolean) =>
    (await mimirV1RowVectors(staticConnection(f.slot, accounts), d.rows, d.memberships, { cluster: f.cluster, dlmmOptionalNeighbours }))[0]!;
  const base = await vectors(world(bin70[dlmmActive].data, null));
  assert.equal(base.length, 4);
  assert.deepEqual(await vectors(world(bin70[dlmmActive].data, neighbour(10n ** 9n))), base, "clipped but passing: no neighbour");
  assert.deepEqual(await vectors(world(thin.toString("base64"), neighbour(10n ** 9n))), [...base, lowerKey], "failing + clipped: lower only");
  assert.deepEqual(await vectors(world(thin.toString("base64"), neighbour(10n ** 9n)), false), base, "opt-out: base only");
  assert.deepEqual(await vectors(world(thin.toString("base64"), neighbour(1n))), base, "thin neighbour: base only");
  assert.deepEqual(await vectors(world(thin.toString("base64"), neighbour(10n ** 9n, 1n))), base, "wrong stored index: base only");
  assert.deepEqual(await vectors(world(thin.toString("base64"), null)), base, "absent neighbour: base only");
  const p = await prepare(f, world(thin.toString("base64"), neighbour(10n ** 9n)));
  const metas = p.instruction.accounts.map((a) => a.address);
  assert.deepEqual(metas.slice(0, metas.length), [...f.expected.accounts.map((a: { address: string }) => a.address).slice(0, 2 + d.rows[0]!.descriptor.externalWidth),
    lowerKey, ...f.expected.accounts.map((a: { address: string }) => a.address).slice(2 + d.rows[0]!.descriptor.externalWidth)], "tag89 trailer follows its own row");
  assert.equal(Buffer.from(p.instruction.data).toString("hex"), f.expected.data, "trailer leaves instruction data unchanged");
}
// Custom3 after preparation: crossing DLMM array -321/-320 must discard the prepared vector, including converter rows.
{
  const dlmm = load("usdc_dlmm.json"), converter = load("sol_quoted_orca.json");
  const raw = Buffer.from(dlmm.accounts[dlmm.request.feed].data, "base64");
  const image = Buffer.from(converter.accounts[converter.request.feed].data, "base64");
  const converterRow = K.CLASSIC_ROWS + C.SOURCE_ROW_LEN + C.CONVERTER_FIXED_LEN;
  raw.copy(image, converterRow, K.CLASSIC_ROWS, K.CLASSIC_ROWS + C.SOURCE_ROW_LEN);
  image[converterRow + C.D_MODE] = C.MODE_NATIVE_BOUNDED;
  image[converterRow + C.D_EXTERNAL_WIDTH] = 7;
  raw.copy(image, image.length - C.MEMBERSHIP_HEADER_LEN, raw.length - C.MEMBERSHIP_HEADER_LEN);
  converter.accounts = { ...dlmm.accounts, ...converter.accounts,
    [converter.request.feed]: { ...converter.accounts[converter.request.feed], data: image.toString("base64") } };
  const worlds = await Promise.all([-321, -320].map(async (index) => {
    const seed = Buffer.alloc(8); seed.writeBigInt64LE(BigInt(index));
    const [key] = await getProgramDerivedAddress({ programAddress: dlmm.accounts[dlmmPool].owner,
      seeds: ["bin_array", bs58.decode(dlmmPool), seed] });
    const data = Buffer.from(dlmm.accounts[dlmmActive].data, "base64");
    data.writeBigInt64LE(BigInt(index), 8);
    // Keep all required bins initialized with two-sided liquidity; zero cached prices use the live bin-id price.
    for (let bin = 0; bin < 70; bin++) {
      const at = 56 + bin * 144;
      data.writeBigUInt64LE(1_000_000_000_000n, at); data.writeBigUInt64LE(1_000_000_000_000n, at + 8);
      data.fill(0, at + 16, at + 32);
    }
    return { key, account: { ...dlmm.accounts[dlmmActive], data: data.toString("base64") } };
  }));
  const poolAt = (active: number) => {
    const data = Buffer.from(dlmm.accounts[dlmmPool].data, "base64");
    data.writeInt32LE(active, 76); data.writeUInt16LE(1, 80);
    return { ...dlmm.accounts[dlmmPool], data: data.toString("base64") };
  };
  // This converter is native: keep its oracle and generation pins authentic in movement controls.
  const nativeCapture = JSON.parse(readFileSync(new URL("./fixtures/exportedRefresh/classic-dlmm-native-routeable-e9.json", import.meta.url), "utf8"));
  const nativePins = mimirExecutableGenerationPins(converter.cluster).dlmm;
  const [nativeOracle] = await getProgramDerivedAddress({ programAddress: nativePins[0], seeds: ["oracle", bs58.decode(dlmmPool)] });
  const oracleData = Buffer.alloc(64); oracleData.set([139, 194, 131, 179, 140, 179, 229, 244]); oracleData.writeBigUInt64LE(1n, 24);
  converter.accounts[nativeOracle] = { owner: nativePins[0], executable: false, lamports: 1, data: oracleData.toString("base64") };
  for (const key of nativePins.slice(0, 2) as Address[]) converter.accounts[key] = { ...nativeCapture.accounts[key], lamports: Number(nativeCapture.accounts[key].lamports) };
  for (const [label, f] of [["Classic primary", dlmm], ["Composite component", load("composite_n2.json")], ["Classic converter", converter]] as const) {
    for (const [before, after] of [[0, 1], [1, 0]]) {
      const accounts = { ...f.accounts, ...Object.fromEntries(worlds.map((w) => [w.key, w.account])),
        [dlmmPool]: poolAt(before === 0 ? -22_402 : -22_398) };
      const p = await prepare(f, accounts);
      assert.equal(typeof p.preparationDrift, "function", `${label} callback`);
      const fail = (err = { InstructionError: [0, { Custom: 3 }] }, programId = f.programId, code = "3") => p.preparationDrift!(err,
        [`Program ${programId} invoke [1]`, `Program ${programId} failed: custom program error: 0x${code}`]);
      await assert.rejects(fail(), MimirBetaSimulationError, `${label} unchanged Custom3 is hard`);
      accounts[dlmmPool] = poolAt(after === 0 ? -22_402 : -22_398);
      await assert.rejects(fail(), MimirBetaStalePreparationError, `${label} ${before}->${after} stale`);
      await assert.rejects(fail(undefined, "11111111111111111111111111111111"), MimirBetaSimulationError, `${label} unrelated program stays hard`);
      await assert.rejects(fail({ InstructionError: [0, { Custom: 7 }] }), MimirBetaSimulationError, `${label} unrelated code stays hard`);
      await assert.rejects(fail(undefined, f.programId, "7"), MimirBetaSimulationError, `${label} mismatched log code stays hard`);
      const vault = "81BadRGfaHFpAmuXpJ65k8tYtUWsZ54EFSmsVo1rbDTV", goodVault = accounts[vault];
      accounts[vault] = { ...goodVault, owner: "11111111111111111111111111111111" };
      await assert.rejects(fail(), (error) => error instanceof MimirBetaSimulationError && error.code === "SIMULATION_FAILED",
        `${label} moved, wrong DLMM vault owner stays hard`);
      accounts[vault] = goodVault;
      // Every present supplied row role: primary/companion pools, converter rows, vaults, mints and arrays.
      for (const companion of new Set(p.instruction.accounts.map((a) => a.address))) {
        const good = accounts[companion];
        if (companion === "11111111111111111111111111111111" || companion === "Sysvar1nstructions1111111111111111111111111") continue;
        if (!good) {
          accounts[companion] = { owner: f.programId, executable: false, lamports: 1, data: "" };
          await assert.rejects(fail(), MimirBetaSimulationError, `${label} supplied absent role appeared`);
          accounts[companion] = good;
          continue;
        }
        for (const [kind, bad] of [
          ["owner", { ...good, owner: good.owner === f.programId ? "11111111111111111111111111111111" : f.programId }], ["missing", null],
          ["executable", { ...good, executable: !good.executable }],
          ["shorter", { ...good, data: Buffer.from(good.data, "base64").subarray(1).toString("base64") }],
          ["longer", { ...good, data: Buffer.concat([Buffer.from(good.data, "base64"), Buffer.alloc(1)]).toString("base64") }],
        ] as const) {
          accounts[companion] = bad;
          await assert.rejects(fail(), (error) => error instanceof MimirBetaSimulationError && error.code === "SIMULATION_FAILED",
            `${label} moved, companion ${companion} ${kind} stays hard`);
        }
        accounts[companion] = good;
      }
      const movedPool = accounts[dlmmPool], oldKey = worlds[before]!.key, oldArray = accounts[oldKey];
      const rebound = Buffer.from(movedPool.data, "base64"); rebound[152] ^= 1;
      for (const bad of [{ ...movedPool, owner: "11111111111111111111111111111111" },
        { ...movedPool, data: rebound.toString("base64") }]) {
        accounts[dlmmPool] = bad;
        await assert.rejects(fail(), MimirBetaSimulationError, `${label} moved, invalid pool identity/binding stays hard`);
        accounts[dlmmPool] = movedPool;
      }
      accounts[oldKey] = { ...oldArray, owner: "11111111111111111111111111111111" };
      await assert.rejects(fail(), MimirBetaSimulationError, `${label} moved, wrong old-array owner stays hard`);
      accounts[oldKey] = oldArray;
      const nextKey = worlds[after]!.key, nextGood = accounts[nextKey];
      for (const bad of [null, { ...nextGood, data: Buffer.alloc(10_136).toString("base64") }]) {
        accounts[nextKey] = bad;
        await assert.rejects(fail(), MimirBetaSimulationError, `${label} moved, invalid required new array is hard`);
      }
      accounts[nextKey] = nextGood;
      const fresh = await prepare(f, accounts);
      assert.deepEqual(fresh.instruction.accounts, p.instruction.accounts.map((a) =>
        a.address === worlds[before]!.key ? { ...a, address: worlds[after]!.key } : a), `${label} fresh canonical PDA`);
      assert.deepEqual(fresh.instruction.data, p.instruction.data, `${label} same instruction bytes`);
      assert.equal(fresh.instruction.accounts.length, p.instruction.accounts.length, `${label} same account count`);
      assert.equal(fresh.computeUnitLimit, p.computeUnitLimit, `${label} same CU`);
      accounts[dlmmPool] = poolAt(before === 0 ? -22_402 : -22_398);
      const key = worlds[before]!.key, good = accounts[key];
      const wrongRelation = Buffer.from(good.data, "base64"); wrongRelation.writeBigInt64LE(1n, 8);
      for (const [kind, bad] of [
        ["owner", { ...good, owner: "11111111111111111111111111111111" }],
        ["PDA relation", { ...good, data: wrongRelation.toString("base64") }],
        ["missing", null], ["uninitialized", { ...good, data: Buffer.alloc(10_136).toString("base64") }],
      ] as const) {
        accounts[key] = bad;
        await assert.rejects(fail(), MimirBetaSimulationError, `${label} unchanged ${kind} is hard`);
      }
      accounts[key] = good;
    }
  }
  // R2: real Classic Orca primary + DLMM converter, with a supplied sparse tick absent at preparation.
  {
    const [tick, tickAccount] = Object.entries<any>(converter.accounts).find(([, a]) =>
      a?.owner.startsWith("whir") && Buffer.from(a.data, "base64").length === 9988)!;
    const accounts = { ...converter.accounts, ...Object.fromEntries(worlds.map((w) => [w.key, w.account])),
      [dlmmPool]: poolAt(-22_402), [tick]: null };
    const p = await prepare(converter, accounts);
    assert.ok(p.instruction.accounts.some((a) => a.address === tick), "sparse companion is supplied");
    const fail = () => p.preparationDrift!({ InstructionError: [0, { Custom: 3 }] },
      [`Program ${converter.programId} invoke [1]`, `Program ${converter.programId} failed: custom program error: 0x3`]);
    accounts[dlmmPool] = poolAt(-22_398);
    await assert.rejects(fail(), MimirBetaStalePreparationError, "unchanged absence permits authenticated movement");
    for (const [kind, account] of [["authentic", tickAccount],
      ["foreign owner", { ...tickAccount, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }],
      ["executable", { ...tickAccount, executable: true }],
      ["empty System", { ...tickAccount, owner: "11111111111111111111111111111111", data: "" }]] as const) {
      accounts[tick] = account;
      await assert.rejects(fail(), (e) => e instanceof MimirBetaSimulationError && e.code === "SIMULATION_FAILED",
        `formerly absent ${kind} companion stays hard`);
    }
    accounts[tick] = { ...tickAccount, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" };
    await assert.rejects(prepare(converter, accounts), /ACCOUNT_OWNER_MISMATCH:Orca tick owner mismatch/);
    accounts[dlmmPool] = poolAt(-22_402);
    await assert.rejects(fail(), MimirBetaSimulationError, "foreign owner without movement stays hard");
  }
  // Exercise the planner's one automatic rebuild with the real preparer and its retained-cohort classifier.
  const { assessMimirRefresh } = await import("../src/beta/refreshPlanner.js");
  const { getCompiledTransactionMessageDecoder } = await import("@solana/transaction-messages");
  const accounts = { ...dlmm.accounts, ...Object.fromEntries(worlds.map((w) => [w.key, w.account])), [dlmmPool]: poolAt(-22_402) };
  let builds = 0, simulations = 0, hashes = 0;
  const readiness = await assessMimirRefresh({ programId: dlmm.programId, payer: dlmm.request.feed,
    target: { kind: "classic", feedConfig: dlmm.request.feed },
    consumer: { instructions: [{ programAddress: "11111111111111111111111111111111" as Address, accounts: [], data: Uint8Array.of(0) }], computeUnits: 1_000 },
    rpc: {
      getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: worlds[hashes++ % 2]!.key, lastValidBlockHeight: 99n } }) }),
      simulateTransaction: (wire: string) => ({ send: async () => {
        const message = getCompiledTransactionMessageDecoder().decode(Buffer.from(wire, "base64"));
        assert.ok(message.staticAccounts.includes(worlds[simulations === 0 ? 0 : 1]!.key), "simulation uses current prepared vector");
        if (++simulations === 1) {
          accounts[dlmmPool] = poolAt(-22_398);
          return { value: { err: { InstructionError: [0, { Custom: 3 }] },
            logs: [`Program ${dlmm.programId} invoke [1]`, `Program ${dlmm.programId} failed: custom program error: 0x3`] } };
        }
        assert.ok(!message.staticAccounts.includes(worlds[0]!.key), "rebuilt simulation excludes stale PDA");
        return { value: { err: null, unitsConsumed: 1_000n } };
      } }),
    } as never,
    buildRefreshGroup: async () => {
      builds++;
      const p = await prepare(dlmm, accounts);
      return { updates: [], publish: { instructions: [p.instruction], computeUnitBound: p.computeUnitLimit }, preparationDrift: p.preparationDrift,
        check: { account: dlmm.request.feed, kind: "classic-snapshot", slotOffset: 116, revisionOffset: 96, statusOffset: 104,
          expectedStatus: 0, validUntilSlotOffset: 124, snapshotSourceOffset: 107, expectedSnapshotSource: 5, config: dlmm.request.feed } };
    } });
  assert.equal(readiness.state, "needs-full-refresh");
  assert.equal(builds, 2, "normal V1 preparer rebuilt once");
  assert.equal(simulations, 3, "stale refresh, rebuilt refresh and final inline consumer simulated");
  assert.ok(hashes >= 2, "rebuild gets a new blockhash");
}
// Venue-unavailable rows (program 130, never terminal at refresh): a venue-disabled status plans the same vector, stamped NOT_READY on a
// CLMM/CPMM/DLMM private ring (blank rings take the source adapter) and PAUSED otherwise; an authenticated primary in an unsupported
// schema plans the stored static roles where they are the whole vector (DAMM v2 spot), and throws otherwise. Wrong identity still throws.
{
  const metas = (p: { instruction: { accounts: readonly { address: string; isSigner: boolean; isWritable: boolean }[] } }) =>
    p.instruction.accounts.map((a) => ({ address: a.address, isSigner: a.isSigner, isWritable: a.isWritable }));
  const patch = (f: ReturnType<typeof load>, owner: string, len: number, fn: (d: Buffer) => void, envelope: Record<string, unknown> = {}) => {
    const [k, v] = Object.entries<{ owner: string; data: string }>(f.accounts).find(([, v]) => v?.owner === owner && Buffer.from(v.data, "base64").length === len)!;
    const d = Buffer.from(v.data, "base64"); fn(d);
    return { ...f.accounts, [k]: { ...v, data: d.toString("base64"), ...envelope } };
  };
  const NR = 0x100, PAUSED = 0x1;
  for (const [name, owner, len, disable, cond] of [
    ["usdc_cpmm_dual.json", "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", 637, (d: Buffer) => { d[329]! |= 4; }, NR],
    ["sol_usdc_clmm.json", "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", 1_544, (d: Buffer) => { d[389]! |= 16; }, NR],
    ["usdc_dlmm.json", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", 904, (d: Buffer) => { d[82] = 1; }, NR],
    ["usdc_ammv4_sampled.json", "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", 752, (d: Buffer) => { d.writeBigUInt64LE(2n, 0); }, PAUSED],
    ["usdc_damm_v2_spot.json", "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", 1_112, (d: Buffer) => { d[481] = 1; }, PAUSED],
  ] as const) {
    const f = load(name);
    assert.deepEqual((await prepare(f)).unavailableRows, [], `${name} healthy`);
    const p = await prepare(f, patch(f, owner, len, disable));
    assert.deepEqual(metas(p), f.expected.accounts, `${name} disabled metas`);
    assert.equal(Buffer.from(p.instruction.data).toString("hex"), f.expected.data, `${name} disabled data`);
    assert.deepEqual(p.unavailableRows, [{ row: 0, reason: "venue-disabled", cond }], `${name} disabled stamp`);
    await assert.rejects(prepare(f, patch(f, owner, len, disable, { owner: "11111111111111111111111111111111" })), `${name} disabled wrong owner`);
  }
  const damm = load("usdc_damm_v2_spot.json");
  const schema = await prepare(damm, patch(damm, "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", 1_112, (d) => { d[0]! ^= 1; }));
  assert.deepEqual(metas(schema), damm.expected.accounts, "DAMM v2 unsupported schema: stored static roles");
  assert.deepEqual(schema.unavailableRows, [{ row: 0, reason: "venue-schema", cond: PAUSED }]);
  // ... but an invalid required vault (null, wrong owner, short beside the same-length pool) keeps the structural refusal.
  {
    const unsupported = patch(damm, "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", 1_112, (d) => { d[0]! ^= 1; });
    const vault = damm.expected.accounts.find((a: { address: string }) => damm.accounts[a.address]?.owner === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")!.address;
    for (const bad of [null, { ...damm.accounts[vault], owner: "11111111111111111111111111111111" }, { ...damm.accounts[vault], data: "AQ==" }]) {
      await assert.rejects(prepare(damm, { ...unsupported, [vault]: bad }), /ACCOUNT_(OWNER_MISMATCH|MALFORMED)/, "DAMM v2 unsupported schema, invalid vault");
      await assert.rejects(prepare(damm, { ...damm.accounts, [vault]: bad }), "DAMM v2 healthy, invalid vault");
    }
  }
  const cpmm = load("usdc_cpmm_dual.json");
  await assert.rejects(prepare(cpmm, patch(cpmm, "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", 637, (d) => { d[0]! ^= 1; })), /discriminator mismatch/,
    "a derived CPMM row in an unsupported schema has no stored vector");
  // Authenticated auxiliaries in an unsupported schema (canonical address, venue owner): the same vector, NOT_READY; a wrong owner or a
  // missing auxiliary still throws.
  for (const [name, owner, len, label, mutate] of [
    ["usdc_cpmm_dual.json", "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", 4_075, "CPMM observation discriminator", (d: Buffer) => { d[0]! ^= 1; }],
    ["sol_usdc_clmm.json", "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", 4_483, "CLMM observation discriminator", (d: Buffer) => { d[0]! ^= 1; }],
    ["sol_usdc_clmm.json", "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", 10_240, "CLMM tick-array discriminator", (d: Buffer) => { d[0]! ^= 1; }],
    ["usdc_dlmm.json", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", 10_136, "DLMM array discriminator", (d: Buffer) => { d[0]! ^= 1; }],
    ["usdc_dlmm.json", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", 10_136, "DLMM array version 0", (d: Buffer) => { d[16] = 0; }],
    ["usdc_dlmm.json", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", 10_136, "DLMM array padding 17", (d: Buffer) => { d[17] = 1; }],
    ["usdc_dlmm.json", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", 10_136, "DLMM array padding 23", (d: Buffer) => { d[23] = 1; }],
    ["composite_n2.json", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", 10_136, "composite DLMM array version 0", (d: Buffer) => { d[16] = 0; }],
  ] as const) {
    const f = load(name), row = name === "composite_n2.json" ? 1 : 0;
    const p = await prepare(f, patch(f, owner, len, mutate));
    assert.deepEqual(metas(p), f.expected.accounts, `${label} metas`);
    assert.equal(Buffer.from(p.instruction.data).toString("hex"), f.expected.data, `${label} data`);
    assert.deepEqual(p.unavailableRows, [{ row, reason: "venue-schema", cond: NR }], `${label} stamp`);
    await assert.rejects(prepare(f, patch(f, owner, len, mutate, { owner: "11111111111111111111111111111111" })), `${label} wrong owner`);
  }
  {
    const f = load("sol_usdc_clmm.json");
    const [k] = Object.entries<{ owner: string; data: string }>(f.accounts).find(([, v]) => v?.owner === "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK" && Buffer.from(v.data, "base64").length === 4_483)!;
    await assert.rejects(prepare(f, { ...f.accounts, [k]: null }), "CLMM observation missing");
  }
  // Composite: the N2 composite with its DLMM component disabled plans the same tag87.
  const c = load("composite_n2.json");
  const cp = await prepare(c, patch(c, "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", 904, (d) => { d[82] = 1; }));
  assert.deepEqual(metas(cp), c.expected.accounts, "composite disabled component metas");
  assert.equal(cp.unavailableRows.length, 1);
  assert.equal(cp.unavailableRows[0]!.reason, "venue-disabled");
}
// Adaptive Orca refresh: the CREATE-only Oracle admission is neither read nor required (vector [B,Q,P,C,L,A,U]); whatever the Oracle's
// trade_enable_timestamp, or with no Oracle at all, the row plans the same metas.
{
  const f = load("sol_quoted_orca.json");
  const [pool, a] = Object.entries<{ owner: string; data: string; executable: boolean; lamports: number }>(f.accounts)
    .find(([, v]) => v?.owner.startsWith("whir") && Buffer.from(v.data, "base64").length === 653)!;
  const data = Buffer.from(a.data, "base64"); data.writeUInt16LE(data.readUInt16LE(41) ^ 1, 43);
  const [oracle] = await getProgramDerivedAddress({ programAddress: a.owner as Address, seeds: [Buffer.from("oracle"), bs58.decode(pool)] });
  const now = Buffer.from(f.accounts["SysvarC1ock11111111111111111111111111111111"].data, "base64").readBigInt64LE(32);
  for (const t of [0n, now + 1n, null]) {
    const o = Buffer.alloc(254); o.set([139, 194, 131, 179, 140, 179, 229, 244]); o.set(bs58.decode(pool), 8); o.writeBigUInt64LE(t ?? 0n, 40);
    const accounts = { ...f.accounts, [pool]: { ...a, data: data.toString("base64") },
      [oracle]: t === null ? null : { owner: a.owner, data: o.toString("base64"), executable: false, lamports: 1 } };
    const read = new Set<string>();
    const p = await prepareMimirV1ClassicRefresh(staticConnection(f.slot, accounts, read), f.request.feed, { programId: f.programId, cluster: f.cluster });
    assert.deepEqual(p.instruction.accounts.map((x) => ({ address: x.address, isSigner: x.isSigner, isWritable: x.isWritable })), f.expected.accounts, `adaptive Orca T=${t}`);
    assert.ok(!read.has(oracle), `adaptive Orca T=${t}: Oracle not read`);
  }
}
// CU hint >= the main9g maxima (a-main9g fuzz and bank parity) by row count.
for (const [rows, cu] of [[1, 161_879], [2, 175_794], [3, 217_239], [4, 307_970], [5, 248_803], [6, 302_730]] as const) {
  assert.ok(mimirV1RefreshComputeUnitLimit(rows) >= cu, `CU hint ${rows} rows`);
}
// Source compatibility (strict tsc): a producer without `unavailableRows` still assigns; direct preparer readers need no optional chaining.
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "NodeNext",
  "--moduleResolution", "NodeNext", "tests/fixtures/v1PreparedRefreshCompat.ts"], { stdio: "inherit" });
console.log(`v1Refresh: ${names.length} fixtures ok`);
