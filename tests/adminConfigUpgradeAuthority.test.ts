import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ADMIN_CONFIG_HEADER_LEN,
  ADMIN_CONFIG_MAGIC,
  ADMIN_CONFIG_OFFSETS,
  MIMIR_PROGRAM_ID,
  createUpsertAdminConfigV1Instruction,
  findAdminConfigPda,
  findMimirProgramDataAddress,
} from "../src/index.js";

const key = (seed: number) => new PublicKey(Buffer.alloc(32, seed));
const [adminConfig, bump] = findAdminConfigPda(1, MIMIR_PROGRAM_ID);
const payer = Keypair.generate().publicKey;
const admin = key(211);
const upgradeAuthority = key(77);

function header(edit?: (data: Buffer) => void): Buffer {
  const data = Buffer.alloc(ADMIN_CONFIG_HEADER_LEN);
  ADMIN_CONFIG_MAGIC.copy(data, ADMIN_CONFIG_OFFSETS.magic);
  data.writeUInt16LE(1, ADMIN_CONFIG_OFFSETS.version);
  data.writeUInt16LE(ADMIN_CONFIG_HEADER_LEN, ADMIN_CONFIG_OFFSETS.headerLen);
  data[ADMIN_CONFIG_OFFSETS.status] = 1;
  data[ADMIN_CONFIG_OFFSETS.bump] = bump;
  admin.toBuffer().copy(data, ADMIN_CONFIG_OFFSETS.adminAuthority);
  key(212).toBuffer().copy(data, ADMIN_CONFIG_OFFSETS.collateralMint);
  data.writeBigUInt64LE(50_000n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw);
  data[ADMIN_CONFIG_OFFSETS.collateralRequired] = 1;
  data.writeUInt16LE(8_000, ADMIN_CONFIG_OFFSETS.compositeOwnerShareBps);
  data.writeBigUInt64LE(1_000n, ADMIN_CONFIG_OFFSETS.compositeRefreshFeeLamports);
  key(213).toBuffer().copy(data, ADMIN_CONFIG_OFFSETS.feeTreasury);
  data.writeBigUInt64LE(9n, ADMIN_CONFIG_OFFSETS.configRevision);
  key(214).toBuffer().copy(data, ADMIN_CONFIG_OFFSETS.rentRecoveryDestination);
  edit?.(data);
  return data;
}

assert.equal(
  findMimirProgramDataAddress(new PublicKey("TYo5SEVfHyFzpjsbFVzNFKTnmLdBvdYjLxmnv32iQ9r")).toBase58(),
  "GGWT28MXmFFaTXXqbB9j5Vk8ukwMKjA8FnD1JNPSGWek",
);

const adminIx = createUpsertAdminConfigV1Instruction({
  payer, authority: admin, adminConfig, adminConfigHeader: header(),
});
assert.deepEqual(
  adminIx.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
  [
    [payer.toBase58(), true, true],
    [admin.toBase58(), true, false],
    [adminConfig.toBase58(), false, true],
    [SystemProgram.programId.toBase58(), false, false],
  ],
);

const uaIx = createUpsertAdminConfigV1Instruction({
  payer, authority: upgradeAuthority, adminConfig, adminConfigHeader: header(),
  authorityRole: "upgradeAuthority",
});
assert.deepEqual(
  uaIx.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
  [
    [payer.toBase58(), true, true],
    [upgradeAuthority.toBase58(), true, false],
    [adminConfig.toBase58(), false, true],
    [SystemProgram.programId.toBase58(), false, false],
    [findMimirProgramDataAddress(MIMIR_PROGRAM_ID).toBase58(), false, false],
  ],
);
assert.deepEqual(uaIx.data, adminIx.data);

assert.throws(
  () => createUpsertAdminConfigV1Instruction({
    payer, authority: upgradeAuthority, adminConfig, adminConfigHeader: header(),
  }),
  /InvalidGovernanceAuthority/,
);

const adminUpdate = (edit: (d: Buffer) => void, current = header()) =>
  createUpsertAdminConfigV1Instruction({
    payer, authority: admin, adminConfig, adminConfigHeader: header(edit),
    currentAdminConfigHeader: current,
  });
for (const [edit, ok] of [
  [(d: Buffer) => d.writeBigUInt64LE(0n, ADMIN_CONFIG_OFFSETS.compositeRefreshFeeLamports), true],
  [(d: Buffer) => d.writeBigUInt64LE(1_000_000n, ADMIN_CONFIG_OFFSETS.compositeRefreshFeeLamports), true],
  [(d: Buffer) => d.writeBigUInt64LE(1_000_001n, ADMIN_CONFIG_OFFSETS.compositeRefreshFeeLamports), false],
  [(d: Buffer) => d.writeUInt16LE(0, ADMIN_CONFIG_OFFSETS.compositeOwnerShareBps), true],
  [(d: Buffer) => d.writeUInt16LE(10_000, ADMIN_CONFIG_OFFSETS.compositeOwnerShareBps), true],
  [(d: Buffer) => d.writeBigUInt64LE(10n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw), true],
  [(d: Buffer) => d.writeBigUInt64LE(1_000_000_000_000_000n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw), true],
  [(d: Buffer) => d.writeBigUInt64LE(1_000_000_000_000_010n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw), false],
  [(d: Buffer) => d.writeBigUInt64LE(15n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw), false],
  [(d: Buffer) => { d[ADMIN_CONFIG_OFFSETS.collateralRequired] = 0; d.writeBigUInt64LE(0n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw); }, false],
  ...[104, 108, 112].flatMap((o) => [
    [(d: Buffer) => d.writeUInt32LE(100_000_000, o), true],
    [(d: Buffer) => d.writeUInt32LE(100_000_001, o), false],
  ] as const),
  ...[116, 117, 118, 119].flatMap((o) => [[(d: Buffer) => { d[o] = 255; }, true]] as const),
] as const) {
  if (ok) adminUpdate(edit);
  else assert.throws(() => adminUpdate(edit), /InvalidAdminConfig/);
}
assert.throws(() => adminUpdate(() => {}), /AdminConfigNoOp/);
const flagged = (flags: number, revision: bigint) => (d: Buffer) => { d[89] = flags; d.writeBigUInt64LE(revision, ADMIN_CONFIG_OFFSETS.configRevision); };
assert.equal(adminUpdate(flagged(3, 10n), header(flagged(1, 9n))).data[1 + 89], 3);
assert.throws(() => adminUpdate(flagged(1, 10n), header(flagged(1, 9n))), /AdminConfigNoOp/);
assert.throws(
  () => adminUpdate((d) => d.writeBigUInt64LE(10n, ADMIN_CONFIG_OFFSETS.configRevision)),
  /AdminConfigNoOp/,
);

const newAdmin = key(88);
const rotate = (edit: (d: Buffer) => void) =>
  createUpsertAdminConfigV1Instruction({
    payer, authority: upgradeAuthority, adminConfig,
    adminConfigHeader: header(edit), currentAdminConfigHeader: header(),
    authorityRole: "upgradeAuthority",
  });
const rotation = (d: Buffer) => {
  newAdmin.toBuffer().copy(d, ADMIN_CONFIG_OFFSETS.adminAuthority);
  d.writeBigUInt64LE(10n, ADMIN_CONFIG_OFFSETS.configRevision);
};
assert.equal(rotate(rotation).keys.length, 5);
assert.throws(
  () => rotate((d) => d.writeBigUInt64LE(10n, ADMIN_CONFIG_OFFSETS.configRevision)),
  /AdminConfigNoOp/,
);
assert.throws(
  () => rotate((d) => newAdmin.toBuffer().copy(d, ADMIN_CONFIG_OFFSETS.adminAuthority)),
  /InvalidAdminRotation/,
);
assert.throws(
  () => rotate((d) => { rotation(d); d.writeBigUInt64LE(2_000n, ADMIN_CONFIG_OFFSETS.compositeRefreshFeeLamports); }),
  /InvalidAdminRotation/,
);
assert.throws(
  () => rotate((d) => { rotation(d); d[ADMIN_CONFIG_OFFSETS.tickerTierTenths] = 150; }),
  /InvalidAdminRotation/,
);
assert.throws(
  () => rotate((d) => { rotation(d); d.writeUInt32LE(800_000, ADMIN_CONFIG_OFFSETS.compositeActivationOwnerFeeLamports); }),
  /InvalidAdminRotation/,
);
assert.throws(
  () => createUpsertAdminConfigV1Instruction({
    payer, authority: admin, adminConfig, adminConfigHeader: header(),
    authorityRole: "owner" as "admin",
  }),
  /InvalidAuthorityRole/,
);
console.log("adminConfigUpgradeAuthority ok");

const uaCreate = (edit: (data: Buffer) => void, cluster?: "mainnet" | "devnet" | "localnet") =>
  createUpsertAdminConfigV1Instruction({
    payer, authority: upgradeAuthority, adminConfig, authorityRole: "upgradeAuthority", cluster,
    adminConfigHeader: header((d) => { d.writeBigUInt64LE(1n, ADMIN_CONFIG_OFFSETS.configRevision); edit(d); }),
  });
for (const bad of [
  (d: Buffer) => d.writeBigUInt64LE(1_000_001n, ADMIN_CONFIG_OFFSETS.compositeRefreshFeeLamports),
  (d: Buffer) => d.writeBigUInt64LE(15n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw),
  (d: Buffer) => d.writeBigUInt64LE(1_000_000_000_000_010n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw),
]) {
  assert.throws(() => uaCreate(bad), /InvalidAdminConfig/);
  assert.throws(() => uaCreate(bad, "devnet"), /InvalidAdminConfig/);
  assert.doesNotThrow(() => uaCreate(bad, "localnet"));
}
assert.doesNotThrow(() => uaCreate((d) => {
  d.writeBigUInt64LE(1_000_000n, ADMIN_CONFIG_OFFSETS.compositeRefreshFeeLamports);
  d.writeBigUInt64LE(1_000_000_000_000_000n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw);
}));

const disabledCollateral = header((d) => {
  d[ADMIN_CONFIG_OFFSETS.collateralRequired] = 0;
  d.writeBigUInt64LE(0n, ADMIN_CONFIG_OFFSETS.collateralAmountRaw);
});
assert.doesNotThrow(() => createUpsertAdminConfigV1Instruction({
  payer, authority: admin, adminConfig, adminConfigHeader: disabledCollateral, cluster: "localnet",
}));
assert.throws(() => createUpsertAdminConfigV1Instruction({
  payer, authority: admin, adminConfig, adminConfigHeader: disabledCollateral,
}), /InvalidAdminConfig/);

const bootstrap = key(90);
const legacyCurrent = header((d) => {
  bootstrap.toBuffer().copy(d, ADMIN_CONFIG_OFFSETS.adminAuthority);
  d.writeBigUInt64LE(1n, ADMIN_CONFIG_OFFSETS.configRevision);
});
const legacyProposed = header((d) => d.writeBigUInt64LE(2n, ADMIN_CONFIG_OFFSETS.configRevision));
for (const currentAdminConfigHeader of [undefined, legacyCurrent]) {
  assert.doesNotThrow(() => createUpsertAdminConfigV1Instruction({
    payer: bootstrap, authority: admin, adminConfig, adminConfigHeader: legacyProposed, currentAdminConfigHeader,
  }));
}
assert.throws(() => createUpsertAdminConfigV1Instruction({
  payer, authority: admin, adminConfig, adminConfigHeader: legacyProposed,
  currentAdminConfigHeader: header((d) => d.writeBigUInt64LE(1n, ADMIN_CONFIG_OFFSETS.configRevision)),
}), /AdminConfigNoOp/);
