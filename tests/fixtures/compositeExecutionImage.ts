import type { Address } from "@solana/kit";
import { sha256 as sha256Sync } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { addressBytes, concatBytes, utf8 } from "../../src/beta/bytes.js";
import { buildTestSourceObservationRingHeader, TEST_FEED_ID, TEST_RING_VERSION } from "../../src/fixtures.js";
import { RING_OFFSETS } from "../../src/constants.js";
import { findSourceConfigPda, findSourceRingPda } from "../../src/pda.js";

const FIXTURE_MIMIR_PROGRAM_ID = new PublicKey("TYo5SEVfHyFzpjsbFVzNFKTnmLdBvdYjLxmnv32iQ9r");
import { decodeMimirClassicExecution, mimirClassicExecutionLayout } from "../../src/beta/classicExecution.js";
import { decodeMimirFusedDescriptor, encodeMimirFusedDescriptor, mimirAdmittedRecipe, mimirCompositeExecutionLayout, type MimirFusedRecipe } from "../../src/beta/compositeExecution.js";

/** Active `CompositeExecutionV1` bytes for recipes (or for a tag-88 SEAL's descriptors). */
export function compositeExecutionImage(args: { feedId: Uint8Array; cfc: Address; components: readonly MimirFusedRecipe[];
  converter?: readonly MimirFusedRecipe[]; status?: number; ringSlot?: (row: number) => bigint;
  /** Seal-copied images per row (source, feed, plan) and the converter (feed, plan), as frozen Seal writes them. */
  images?: Readonly<{ rows: readonly Readonly<{ source: Uint8Array; feed?: Uint8Array; plan?: Uint8Array }>[]; converter?: Readonly<{ feed: Uint8Array; plan: Uint8Array }> }> }): Uint8Array {
  const conv = args.converter ?? [];
  const layout = mimirCompositeExecutionLayout(args.components, conv);
  const data = new Uint8Array(layout.exactLength); const dv = new DataView(data.buffer);
  data.set(new TextEncoder().encode("MIMIRCEF")); dv.setUint16(8, layout.version, true); dv.setUint16(10, 128, true); dv.setUint32(12, data.length, true);
  data.set(args.feedId, 16); data.set(addressBytes(args.cfc), 48); dv.setBigUint64(112, 1n, true);
  data[120] = args.components.length; data[122] = args.status ?? 1; data[123] = conv.length; data.fill(7, 80, 112);
  const b = 128 + 1_621 * args.components.length;
  layout.descriptors.forEach((d, r) => {
    const component = r < args.components.length;
    const o = component ? 128 + 1_621 * r : b + 1_829 + 944 * (r - args.components.length);
    data.set(encodeMimirFusedDescriptor(d), o); dv.setBigUint64(o + 16 + 360, 1n, true);
    dv.setBigUint64(o + (component ? 1_077 : 400) + 64, args.ringSlot?.(r) ?? 0n, true);
    const m = layout.membershipOffsets[r]!; data[m] = d.bindingWidth; data[m + 1] = d.accountsBindingVersion;
    const image = args.images?.rows[r];
    if (image) {
      if (component) { data.set(image.source, o + 16); data.set(image.feed!, o + 400); data.set(image.plan!, o + 757); }
      else data.set(image.source, o + 16);
      data[m + 2] = mimirAdmittedRecipe({ adapterType: d.adapterType, adapterVersion: d.adapterVersion, accountsBindingVersion: d.accountsBindingVersion,
        mode: d.mode, externalWidth: d.externalWidth, temporalKind: d.temporalKind, converterRow: !component }).bindingVariant;
    }
  });
  if (args.images?.converter) { data.set(args.images.converter.feed, b); data.set(args.images.converter.plan, b + 357); }
  return data;
}

/** Post-Seal image; with the Seal's accounts and a pre-state lookup it carries the exact Seal-copied images. */
export function compositeExecutionImageFromSeal(seal: Uint8Array, cfc: Address, sealAccounts?: readonly Address[],
  lookup?: (address: Address) => Uint8Array): Uint8Array {
  const n = seal[34]!; const s = seal[35]!;
  const recipes = Array.from({ length: n + s }, (_, r) => decodeMimirFusedDescriptor(seal.subarray(36 + 16 * r, 52 + 16 * r)));
  let images: Parameters<typeof compositeExecutionImage>[0]["images"];
  if (sealAccounts && lookup) {
    let k = 5; const rows: { source: Uint8Array; feed?: Uint8Array; plan?: Uint8Array }[] = [];
    for (let r = 0; r < n; r += 1) { rows.push({ source: lookup(sealAccounts[k]!), feed: lookup(sealAccounts[k + 1]!), plan: lookup(sealAccounts[k + 2]!) }); k += 3 + recipes[r]!.externalWidth; }
    const converter = s ? { feed: lookup(sealAccounts[k]!), plan: lookup(sealAccounts[k + 1]!) } : undefined; k += s ? 2 : 0;
    for (let j = 0; j < s; j += 1) { rows.push({ source: lookup(sealAccounts[k]!) }); k += 1 + recipes[n + j]!.externalWidth; }
    images = { rows, ...(converter ? { converter } : {}) };
  }
  return compositeExecutionImage({ feedId: seal.subarray(2, 34), cfc, components: recipes.slice(0, n), converter: recipes.slice(n), ...(images ? { images } : {}) });
}

/** Active `ClassicExecutionV1` bytes for a tag-90 SEAL's descriptors: canonical images; rings and modules zero. */
export function classicExecutionImageFromSeal(seal: Uint8Array, snapshot: Address, bump = 255): Uint8Array {
  const n = seal[34]!; const s = seal[35]!;
  const recipes = Array.from({ length: n + s }, (_, r) => decodeMimirFusedDescriptor(seal.subarray(36 + 16 * r, 52 + 16 * r)));
  const layout = mimirClassicExecutionLayout(recipes.slice(0, n), recipes.slice(n));
  const data = new Uint8Array(layout.exactLength); const dv = new DataView(data.buffer);
  data.set(new TextEncoder().encode("MIMIRCLX")); dv.setUint16(8, 1, true); dv.setUint16(10, 384, true); dv.setUint32(12, data.length, true);
  data.set(seal.subarray(2, 34), 16); data.set(addressBytes(snapshot), 48); data.fill(0xd1, 80, 112); dv.setBigUint64(112, 1n, true);
  data[120] = n; data[121] = s; data[122] = bump; data[123] = 1; dv.setUint32(124, s ? 1 : 0, true);
  const primary = canonicalRowImages(seal.subarray(2, 34), recipes.slice(0, n));
  data.set(primary.feed, 384); data.set(primary.plan, 741);
  const conv = s ? canonicalRowImages(new Uint8Array(32).fill(8), recipes.slice(n)) : null;
  if (conv) { const c = 1_573 + 944 * n; data.set(conv.feed, c); data.set(conv.plan, c + 357); }
  layout.descriptors.forEach((d, r) => {
    data.set(encodeMimirFusedDescriptor(d), layout.rowOffsets[r]!);
    data.set(r < n ? primary.sources[r]! : conv!.sources[r - n]!, layout.rowOffsets[r]! + 16);
    const m = layout.membershipOffsets[r]!; data[m] = d.bindingWidth; data[m + 1] = d.accountsBindingVersion;
    data[m + 2] = mimirAdmittedRecipe({ adapterType: d.adapterType, adapterVersion: d.adapterVersion, accountsBindingVersion: d.accountsBindingVersion,
      mode: d.mode, externalWidth: d.externalWidth, temporalKind: d.temporalKind, converterRow: true, pointOk: r < n }).bindingVariant;
  });
  return data;
}

/** What SEAL finalizes: canonical bump, header source-set revision from row 0, and the definition digest over PDA-derived keys. */
export function sealClassicExecution(image: Uint8Array, programId: Address, execution: Address): Uint8Array {
  const d = Uint8Array.from(image); const v = new DataView(d.buffer); const pid = new PublicKey(programId);
  const pda = (...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds.map((x) => Buffer.from(x)), pid);
  d[122] = pda(utf8("classic_execution"), d.subarray(16, 48))[1];
  const row0 = decodeMimirClassicExecution(d).primary[0]!.sourceConfigImage;
  v.setBigUint64(112, new DataView(row0.buffer, row0.byteOffset).getBigUint64(368, true), true);
  const st = decodeMimirClassicExecution(d); const n = st.componentCount; const s = st.converterSourceCount;
  const le = (bytes: number, x: number) => { const o = new Uint8Array(bytes); for (let i = 0; i < bytes; i += 1) o[i] = (x / 256 ** i) & 255; return o; };
  const keys = (feed: Uint8Array, plan: Uint8Array) => [pda(utf8("feed_config"), feed.subarray(16, 48))[0].toBytes(), feed,
    pda(utf8("sourcing_plan"), plan.subarray(16, 48), plan.subarray(48, 50), plan.subarray(50, 52))[0].toBytes(), plan];
  const rows = [...st.primary, ...(st.converter?.sources ?? [])].map((r) => [encodeMimirFusedDescriptor(r.descriptor), r.sourceConfigImage,
    Uint8Array.of(r.membership.bindingWidth, r.membership.accountsBindingVersion, r.membership.bindingVariant, 0),
    ...r.membership.accounts.map((a) => concatBytes(addressBytes(a.address), addressBytes(a.owner), Uint8Array.of(a.executable ? 1 : 0)))]);
  const parts = [utf8("MIMIR_FUSED_CLASSIC_DEFINITION_V1"), pid.toBytes(), new PublicKey(execution).toBytes(), le(4, d.length), d.subarray(16, 48), d.subarray(48, 80),
    Uint8Array.of(n), Uint8Array.of(s), ...keys(st.feedConfigImage, st.planImage), ...rows.slice(0, n).flat(),
    ...(st.converter ? [st.converter.feedConfigImage.subarray(16, 48), ...keys(st.converter.feedConfigImage, st.converter.planImage), ...rows.slice(n).flat()] : []),
    ...st.layout.descriptors.flatMap((x, r) => [le(4, st.layout.rowOffsets[r]! + 400), le(2, 544), le(4, x.moduleOffset), le(2, x.moduleLength)])];
  d.set(sha256Sync(concatBytes(...parts)), 80);
  return d;
}

/** Canonical Seal-copied images (FeedConfig v1, SourcingPlan Merkle-v1, active SourceConfig) for one feed and its row descriptors. */
export function canonicalRowImages(feedId: Uint8Array, rows: readonly MimirFusedRecipe[]) {
  const put = (d: Uint8Array, o: number, b: Uint8Array) => { d.set(b, o); return d; };
  const mint = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n : 3));
  const hdr = (len: number, magic: string, version: number) => {
    const d = new Uint8Array(len); d.set(new TextEncoder().encode(magic)); const v = new DataView(d.buffer);
    v.setUint16(8, version, true); v.setUint16(10, len, true); return { d, v };
  };
  const feed = hdr(357, "MIMIRCFG", 1);
  put(feed.d, 16, feedId); put(feed.d, 48, mint(1)); put(feed.d, 80, mint(2)); feed.v.setInt32(112, -8, true);
  feed.v.setBigUint64(296, 1n, true); put(feed.d, 325, mint(9)); feed.d[117] = 3; feed.d.fill(4, 136, 168);
  const plan = hdr(320, "MIMIRPLN", 0);
  put(plan.d, 16, feedId); plan.d[55] = rows.length; plan.d[56] = 1; plan.d[57] = 1; plan.v.setUint16(60, 150, true); plan.v.setInt32(64, -8, true);
  put(plan.d, 68, mint(1)); put(plan.d, 100, mint(2)); plan.d.fill(4, 132, 164); plan.d.fill(5, 164, 196); plan.d.fill(6, 260, 292);
  plan.v.setBigUint64(292, rows.reduce((m, r) => m | (1n << BigInt(r.adapterType)), 0n), true);
  plan.d[301] = 1; plan.v.setUint16(302, 1, true); plan.d[304] = rows[0]?.accountsBindingVersion ?? 1;
  const le16 = (x: number) => Uint8Array.of(x, x >> 8);
  const p = plan.d; const pv = plan.v;
  const i32 = new Uint8Array(4); new DataView(i32.buffer).setInt32(0, pv.getInt32(64, true), true);
  const parts = [new TextEncoder().encode("MIMIR_MINT_ORACLE_PLAN_V3"), Uint8Array.of(p[301]!), le16(1), Uint8Array.of(p[304]!), p.subarray(16, 48),
    le16(pv.getUint16(48, true)), le16(pv.getUint16(50, true)), p.subarray(52, 53), p.subarray(54, 58), le16(pv.getUint16(58, true)), le16(150), i32,
    p.subarray(68, 100), p.subarray(100, 132), p.subarray(132, 164), p.subarray(164, 196), p.subarray(228, 260), p.subarray(260, 292), p.subarray(292, 300)];
  const all = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of parts) { all.set(x, o); o += x.length; }
  p.set(sha256Sync(all), 196);
  const sources = rows.map((r, i) => {
    const s = hdr(384, "MIMIRSRC", 0);
    put(s.d, 16, feedId); s.d[48] = i; s.d[49] = r.adapterType; s.v.setUint16(52, r.adapterVersion, true); s.v.setUint32(12, r.mode === 5 ? 1 : 0, true);
    s.v.setUint16(70, 10_000, true); s.d[72] = 1; s.d[88] = 1; s.d.fill(7, 104, 168); put(s.d, 232, mint(1)); put(s.d, 264, mint(2));
    s.v.setBigUint64(360, 1n, true); s.v.setBigUint64(368, 1n, true); return s.d;
  });
  return { feed: feed.d, plan: plan.d, sources };
}

/** Valid 544-byte source ring v1 whose newest slot is `slot` (the betaCreationStages atomic ring). */
export function validRingV1(slot: bigint): Uint8Array {
  const data = new Uint8Array(544); data.set(buildTestSourceObservationRingHeader(0, (d) => {
    findSourceConfigPda(TEST_FEED_ID, 0, FIXTURE_MIMIR_PROGRAM_ID)[0].toBuffer().copy(d, RING_OFFSETS.sourceConfig);
    d[RING_OFFSETS.bump] = findSourceRingPda(TEST_FEED_ID, 0, TEST_RING_VERSION, FIXTURE_MIMIR_PROGRAM_ID)[1];
  })); const v = new DataView(data.buffer);
  const u128 = (o: number, x: bigint) => { v.setBigUint64(o, x & ((1n << 64n) - 1n), true); v.setBigUint64(o + 8, x >> 64n, true); };
  v.setUint16(10, 544, true); v.setUint16(50, 1, true); data[53] = 0; v.setUint16(54, 1, true); v.setUint16(56, 300, true); v.setUint16(58, 0, true);
  v.setUint16(60, 1, true); v.setBigUint64(64, slot, true); v.setBigUint64(72, slot, true); v.setBigUint64(80, 0n, true); u128(144, 0n); v.setBigUint64(160, 0n, true);
  u128(88, 1n); u128(112, 1n); u128(128, 1n); data.fill(1, 184, 216); u128(320, 1n); u128(336, 1n); v.setBigUint64(352, 1n, true); v.setUint16(360, 50, true);
  data[369] = 1; data.fill(0, 370, 448); v.setBigUint64(448, slot, true); v.setBigUint64(456, 0n, true);
  for (const o of [464, 480, 496, 512, 528]) u128(o, 1n);
  return data;
}
