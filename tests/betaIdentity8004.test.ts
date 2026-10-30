import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BorshInstructionCoder, type Idl } from "@coral-xyz/anchor";
import { addressBytes, bytesAddress, hex, sha256, utf8 } from "../src/beta/bytes.js";
import {
  MIMIR_BETA_MPL_CORE_PROGRAM_ID,
  MIMIR_BETA_SYSTEM_PROGRAM_ID,
  validateMimirBetaDeployment,
  type MimirBetaDeployment,
} from "../src/beta/deployment.js";
import {
  createMimir8004IdentityAdapter,
  decodeMimir8004AgentAccount,
  decodeMimir8004DisplayNameMetadata,
  decodeMimir8004RegistryConfig,
  decodeMimir8004RootConfig,
  MIMIR_BETA_DISPLAY_NAME_MAX_UTF8_BYTES,
  MIMIR_BETA_DISPLAY_NAME_METADATA_KEY,
  validateMimirBetaDisplayName,
  verifyMimir8004ConfigPdas,
} from "../src/beta/identity8004.js";

const addr = (byte: number) => bytesAddress(Uint8Array.from({ length: 32 }, () => byte));
const collection = addr(13); const authority = addr(14); const asset = addr(15);
const pointer = "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const deployment: MimirBetaDeployment = {
  cluster: "localnet",
  mimirProgramId: addr(10),
  agentRegistryProgramId: addr(11),
  mplCoreProgramId: MIMIR_BETA_MPL_CORE_PROGRAM_ID,
  systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID,
  physicalCollection: collection,
  collectionPointer: pointer,
};
const adapter = createMimir8004IdentityAdapter(deployment);

const [[rootAddress, rootBump], [registryAddress, registryBump], [agentAddress, agentBump], [metadataAddress, metadataBump]] = await Promise.all([
  adapter.deriveRootConfig(), adapter.deriveRegistryConfig(), adapter.deriveAgentAccount(asset), adapter.deriveDisplayNameMetadata(asset),
]);
const rootData = new Uint8Array(73); rootData.set([42,216,8,82,19,209,223,246]); rootData.set(addressBytes(collection), 8); rootData.set(addressBytes(authority), 40); rootData[72] = rootBump;
const registryData = new Uint8Array(73); registryData.set([23,118,10,246,173,231,243,156]); registryData.set(addressBytes(collection), 8); registryData.set(addressBytes(authority), 40); registryData[72] = registryBump;
const root = decodeMimir8004RootConfig(rootData); const registry = decodeMimir8004RegistryConfig(registryData);
await verifyMimir8004ConfigPdas({ adapter, rootAddress, root, registryAddress, registry });

const writeString = (data: Uint8Array, offset: number, value: string) => {
  const encoded = new TextEncoder().encode(value); new DataView(data.buffer).setUint32(offset, encoded.length, true); data.set(encoded, offset + 4); return offset + 4 + encoded.length;
};
const agentData = new Uint8Array(748); agentData.set([241,119,69,140,233,9,112,50]);
agentData.set(addressBytes(collection), 8); agentData.set(addressBytes(authority), 40); agentData.set(addressBytes(addr(99)), 72); agentData.set(addressBytes(asset), 104); agentData[136] = agentBump;
let offset = 138; agentData[offset++] = 0; offset += 32 + 8 + 32 + 8 + 32 + 8; agentData[offset++] = 0; agentData[offset++] = 0; agentData[offset++] = 1;
offset = writeString(agentData, offset, "ipfs://agent"); offset = writeString(agentData, offset, "Agent"); writeString(agentData, offset, pointer);
const agent = decodeMimir8004AgentAccount(agentData);
assert.equal(agent.asset, asset); assert.equal(agent.collectionPointerLocked, true); assert.equal("owner" in agent, false);

const register = await adapter.buildRegister({ asset, authority, agentUri: "" });
const pointerIx = await adapter.buildSetCollectionPointer({ asset, authority });
const displayName = "Café Index";
const metadataIx = await adapter.buildSetImmutableDisplayName({ asset, authority, displayName });
const fixtureBytes = readFileSync(new URL("./fixtures/agent_registry_8004.bfb09ad.json", import.meta.url));
assert.equal(fixtureBytes.length, 65_772);
assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), "b5109accd8efb8bb8a35121fc9108a1aaefcd096401a9a65e6003720c99bdeb1");
const idl = JSON.parse(fixtureBytes.toString("utf8")) as Idl;
const coder = new BorshInstructionCoder(idl);
assert.deepEqual([...register.data], [...coder.encode("register_with_options", { agent_uri: "", atom_enabled: false })]);
assert.deepEqual([...pointerIx.data], [...coder.encode("set_collection_pointer", { col: pointer })]);
const keyHash = createHash("sha256").update(MIMIR_BETA_DISPLAY_NAME_METADATA_KEY).digest().subarray(0, 16);
assert.equal(hex(await sha256(utf8(MIMIR_BETA_DISPLAY_NAME_METADATA_KEY))), "326d370e8e02194b606f916fcf04e046a9a79e7576943414752a375d1b65cff4");
assert.deepEqual([...metadataIx.data], [...coder.encode("set_metadata_pda", {
  key_hash: [...keyHash], key: MIMIR_BETA_DISPLAY_NAME_METADATA_KEY, value: Buffer.from(utf8(displayName)), immutable: true,
})]);
for (const [built, name] of [[register, "register_with_options"], [pointerIx, "set_collection_pointer"], [metadataIx, "set_metadata_pda"]] as const) {
  const instruction = idl.instructions.find((entry) => entry.name === name)!;
  assert.equal(built.accounts.length, instruction.accounts.length);
  instruction.accounts.forEach((item, index) => {
    const meta = item as { readonly signer?: boolean; readonly writable?: boolean };
    assert.equal(built.accounts[index]!.isSigner, Boolean(meta.signer), `${name} signer ${index}`);
    assert.equal(built.accounts[index]!.isWritable, Boolean(meta.writable), `${name} writable ${index}`);
  });
}
assert.equal(register.programAddress, deployment.agentRegistryProgramId);
assert.equal(pointerIx.accounts[0]!.address, agentAddress);
assert.equal(metadataIx.accounts[0]!.address, metadataAddress);
assert.deepEqual(metadataIx.accounts.map(({ address, isSigner, isWritable }) => [address, isSigner, isWritable]), [
  [metadataAddress, false, true], [agentAddress, false, false], [asset, false, false],
  [authority, true, true], [MIMIR_BETA_SYSTEM_PROGRAM_ID, false, false],
]);
assert.equal("buildSetCollectionPointerWithOptions" in adapter, false);

const metadataData = (name: string, overrides: { asset?: ReturnType<typeof addr>; immutable?: number; bump?: number; key?: string } = {}) => {
  const data = new Uint8Array(332); data.set([48,145,12,249,176,141,197,187]);
  data.set(addressBytes(overrides.asset ?? asset), 8); data[40] = overrides.immutable ?? 1; data[41] = overrides.bump ?? metadataBump;
  let cursor = 42; cursor = writeString(data, cursor, overrides.key ?? MIMIR_BETA_DISPLAY_NAME_METADATA_KEY);
  const value = utf8(name); new DataView(data.buffer).setUint32(cursor, value.length, true); cursor += 4; data.set(value, cursor);
  return data;
};
assert.deepEqual(decodeMimir8004DisplayNameMetadata(metadataData(displayName)), {
  asset, immutable: true, bump: metadataBump, metadataKey: MIMIR_BETA_DISPLAY_NAME_METADATA_KEY, displayName,
});
assert.equal(validateMimirBetaDisplayName("a".repeat(250)), "a".repeat(250));
for (const invalid of ["", " name", "name ", "e\u0301", "a".repeat(251), "a\0b", "a\u0085b", "a\u2028b", "a\u202eb", "a\u2066b", "\ud800"]) {
  assert.throws(() => validateMimirBetaDisplayName(invalid));
}
for (const invalid of [metadataData(displayName).slice(0, 331), metadataData(displayName, { asset: addr(0) }),
  metadataData(displayName, { immutable: 0 }), metadataData(displayName, { key: "forged" }), metadataData("e\u0301")]) {
  assert.throws(() => decodeMimir8004DisplayNameMetadata(invalid));
}
const invalidUtf8 = metadataData("a"); invalidUtf8[70] = 0xff;
assert.throws(() => decodeMimir8004DisplayNameMetadata(invalidUtf8));
const paddedMetadata = metadataData("a"); paddedMetadata[331] = 1;
assert.throws(() => decodeMimir8004DisplayNameMetadata(paddedMetadata));

assert.throws(() => decodeMimir8004RootConfig(rootData.slice(0, 72)));
assert.throws(() => decodeMimir8004RegistryConfig(Uint8Array.from(registryData, (byte, index) => index === 0 ? byte ^ 1 : byte)));
const padded = agentData.slice(); padded[747] = 1; assert.throws(() => decodeMimir8004AgentAccount(padded));
const atom = agentData.slice(); atom[137] = 1; assert.equal(decodeMimir8004AgentAccount(atom).atomEnabled, true);
const badRoot = { ...root, bump: root.bump ^ 1 }; await assert.rejects(() => verifyMimir8004ConfigPdas({ adapter, rootAddress, root: badRoot, registryAddress, registry }));
assert.throws(() => createMimir8004IdentityAdapter({ ...deployment, collectionPointer: "https://not-canonical" }));
assert.throws(() => validateMimirBetaDeployment({ ...deployment, mplCoreProgramId: addr(88) }));
assert.throws(() => validateMimirBetaDeployment({ ...deployment, systemProgramId: addr(89) }));
assert.throws(() => validateMimirBetaDeployment({ ...deployment, physicalCollection: deployment.mimirProgramId }));
for (const cluster of ["localnet", "mainnet-beta"] as const) {
  assert.equal(validateMimirBetaDeployment({ ...deployment, cluster }).cluster, cluster);
}
assert.throws(() => validateMimirBetaDeployment({ ...deployment, cluster: "testnet" as never }));
assert.throws(() => validateMimirBetaDeployment({ ...deployment, cluster: undefined as never }));

console.log("beta 8004 identity and pinned-IDL tests passed");
