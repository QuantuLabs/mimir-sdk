import {
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import {
  addressBytes,
  assertZeroBytes,
  bytesAddress,
  bytesEqual,
  concatBytes,
  decodeUtf8,
  isZeroBytes,
  utf8,
} from "./bytes.js";
import { betaError } from "./errors.js";
import {
  validateMimirBetaDeployment,
  type MimirBetaDeployment,
} from "./deployment.js";
import type { MimirBetaInstruction } from "./types.js";

const ROOT_DISCRIMINATOR = Uint8Array.of(42, 216, 8, 82, 19, 209, 223, 246);
const REGISTRY_DISCRIMINATOR = Uint8Array.of(23, 118, 10, 246, 173, 231, 243, 156);
const AGENT_DISCRIMINATOR = Uint8Array.of(241, 119, 69, 140, 233, 9, 112, 50);
const METADATA_DISCRIMINATOR = Uint8Array.of(48, 145, 12, 249, 176, 141, 197, 187);
const REGISTER_DISCRIMINATOR = Uint8Array.of(177, 175, 96, 41, 59, 166, 13, 6);
const POINTER_DISCRIMINATOR = Uint8Array.of(14, 56, 210, 16, 123, 165, 157, 124);
const SET_METADATA_DISCRIMINATOR = Uint8Array.of(236, 60, 23, 48, 138, 69, 196, 153);

export const MIMIR_BETA_DISPLAY_NAME_METADATA_KEY = "mimir.display_name.v1";
export const MIMIR_BETA_DISPLAY_NAME_MAX_UTF8_BYTES = 250;
const DISPLAY_NAME_KEY_HASH = Uint8Array.of(
  0x32, 0x6d, 0x37, 0x0e, 0x8e, 0x02, 0x19, 0x4b,
  0x60, 0x6f, 0x91, 0x6f, 0xcf, 0x04, 0xe0, 0x46,
);
const DISPLAY_NAME_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

export function validateMimirBetaDisplayName(value: string): string {
  const encoded = typeof value === "string" ? utf8(value) : new Uint8Array();
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value !== value.normalize("NFC") ||
    encoded.length === 0 || encoded.length > MIMIR_BETA_DISPLAY_NAME_MAX_UTF8_BYTES || decodeUtf8(encoded) !== value || DISPLAY_NAME_FORBIDDEN.test(value)) {
    betaError("INVALID_ARGUMENT", `display name must be canonical NFC UTF-8 of 1..${MIMIR_BETA_DISPLAY_NAME_MAX_UTF8_BYTES} bytes without controls`);
  }
  return value;
}

export interface Mimir8004RootConfig {
  readonly baseCollection: Address;
  readonly authority: Address;
  readonly bump: number;
}

export interface Mimir8004RegistryConfig {
  readonly collection: Address;
  readonly authority: Address;
  readonly bump: number;
}

export interface Mimir8004AgentAccount {
  readonly collection: Address;
  readonly creator: Address;
  readonly asset: Address;
  readonly bump: number;
  readonly atomEnabled: boolean;
  readonly agentWallet: Address | null;
  readonly parentAsset: Address | null;
  readonly parentLocked: boolean;
  readonly collectionPointerLocked: boolean;
  readonly agentUri: string;
  readonly nftName: string;
  readonly collectionPointer: string;
}

export interface Mimir8004DisplayNameMetadata {
  readonly asset: Address;
  readonly immutable: true;
  readonly bump: number;
  readonly metadataKey: typeof MIMIR_BETA_DISPLAY_NAME_METADATA_KEY;
  readonly displayName: string;
}

function exact(data: Uint8Array, length: number, discriminator: Uint8Array): void {
  if (data.length !== length || !bytesEqual(data.subarray(0, 8), discriminator)) {
    betaError("ACCOUNT_MALFORMED", "wrong 8004 discriminator or allocation length");
  }
}

function nonzeroAddress(data: Uint8Array, offset: number, label: string): Address {
  const value = data.subarray(offset, offset + 32);
  if (value.length !== 32 || isZeroBytes(value)) betaError("ACCOUNT_MALFORMED", `${label} is zero`);
  return bytesAddress(value);
}

export function decodeMimir8004RootConfig(data: Uint8Array): Mimir8004RootConfig {
  exact(data, 73, ROOT_DISCRIMINATOR);
  return {
    baseCollection: nonzeroAddress(data, 8, "root collection"),
    authority: nonzeroAddress(data, 40, "root authority"),
    bump: data[72]!,
  };
}

export function decodeMimir8004RegistryConfig(data: Uint8Array): Mimir8004RegistryConfig {
  exact(data, 73, REGISTRY_DISCRIMINATOR);
  return {
    collection: nonzeroAddress(data, 8, "registry collection"),
    authority: nonzeroAddress(data, 40, "registry authority"),
    bump: data[72]!,
  };
}

class Cursor {
  offset = 0;
  constructor(readonly data: Uint8Array) {}
  take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.data.length) {
      betaError("ACCOUNT_MALFORMED", "bounded 8004 decode exceeded allocation");
    }
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  u8(): number { return this.take(1)[0]!; }
  u32(): number {
    const value = new DataView(this.take(4).buffer, this.data.byteOffset + this.offset - 4, 4);
    return value.getUint32(0, true);
  }
  optionAddress(label: string): Address | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag !== 1) betaError("ACCOUNT_MALFORMED", `${label} option tag invalid`);
    const bytes = this.take(32);
    if (isZeroBytes(bytes)) betaError("ACCOUNT_MALFORMED", `${label} is zero`);
    return bytesAddress(bytes);
  }
  string(max: number, label: string): string {
    const length = this.u32();
    if (length > max) betaError("ACCOUNT_MALFORMED", `${label} too long`);
    try { return decodeUtf8(this.take(length)); } catch { return betaError("ACCOUNT_MALFORMED", `${label} invalid UTF-8`); }
  }
  bytes(max: number, label: string): Uint8Array {
    const length = this.u32();
    if (length > max) betaError("ACCOUNT_MALFORMED", `${label} too long`);
    return this.take(length);
  }
}

export function decodeMimir8004AgentAccount(data: Uint8Array): Mimir8004AgentAccount {
  exact(data, 748, AGENT_DISCRIMINATOR);
  const cursor = new Cursor(data);
  cursor.take(8);
  const collection = nonzeroAddress(cursor.take(32), 0, "agent collection");
  const creator = nonzeroAddress(cursor.take(32), 0, "agent creator");
  cursor.take(32); // Cached owner is deliberately parsed past and never returned.
  const asset = nonzeroAddress(cursor.take(32), 0, "agent asset");
  const bump = cursor.u8();
  const atom = cursor.u8();
  if (atom > 1) betaError("ACCOUNT_MALFORMED", "ATOM bool invalid");
  const agentWallet = cursor.optionAddress("agent wallet");
  cursor.take(32 + 8 + 32 + 8 + 32 + 8);
  const parentAsset = cursor.optionAddress("parent asset");
  const parentLocked = cursor.u8();
  const collectionPointerLocked = cursor.u8();
  if (parentLocked > 1 || collectionPointerLocked > 1) betaError("ACCOUNT_MALFORMED", "lock bool invalid");
  const agentUri = cursor.string(250, "agent URI");
  const nftName = cursor.string(32, "NFT name");
  const collectionPointer = cursor.string(128, "collection pointer");
  assertZeroBytes(data.subarray(cursor.offset), "AgentAccount allocation padding");
  return {
    collection,
    creator,
    asset,
    bump,
    atomEnabled: atom === 1,
    agentWallet,
    parentAsset,
    parentLocked: parentLocked === 1,
    collectionPointerLocked: collectionPointerLocked === 1,
    agentUri,
    nftName,
    collectionPointer,
  };
}

export function decodeMimir8004DisplayNameMetadata(data: Uint8Array): Mimir8004DisplayNameMetadata {
  exact(data, 332, METADATA_DISCRIMINATOR);
  const cursor = new Cursor(data);
  cursor.take(8);
  const asset = nonzeroAddress(cursor.take(32), 0, "metadata asset");
  const immutable = cursor.u8();
  const bump = cursor.u8();
  const metadataKey = cursor.string(32, "metadata key");
  let displayName: string;
  try { displayName = decodeUtf8(cursor.bytes(MIMIR_BETA_DISPLAY_NAME_MAX_UTF8_BYTES, "metadata value")); }
  catch { return betaError("ACCOUNT_MALFORMED", "metadata value invalid UTF-8"); }
  if (immutable !== 1 || metadataKey !== MIMIR_BETA_DISPLAY_NAME_METADATA_KEY) {
    betaError("IDENTITY_UNVERIFIED", "display-name metadata key or immutability mismatch");
  }
  try { validateMimirBetaDisplayName(displayName); }
  catch { return betaError("ACCOUNT_MALFORMED", "metadata display name is not canonical"); }
  assertZeroBytes(data.subarray(cursor.offset), "MetadataEntryPda allocation padding");
  return { asset, immutable: true, bump, metadataKey: MIMIR_BETA_DISPLAY_NAME_METADATA_KEY, displayName };
}

export interface Mimir8004IdentityAdapter extends MimirBetaDeployment {
  deriveRootConfig(): Promise<readonly [Address, number]>;
  deriveRegistryConfig(): Promise<readonly [Address, number]>;
  deriveAgentAccount(asset: Address): Promise<readonly [Address, number]>;
  deriveDisplayNameMetadata(asset: Address): Promise<readonly [Address, number]>;
  buildRegister(args: { readonly asset: Address; readonly authority: Address; readonly agentUri: string }): Promise<MimirBetaInstruction>;
  buildSetCollectionPointer(args: { readonly asset: Address; readonly authority: Address }): Promise<MimirBetaInstruction>;
  buildSetImmutableDisplayName(args: { readonly asset: Address; readonly authority: Address; readonly displayName: string }): Promise<MimirBetaInstruction>;
}

function borshString(value: string, max: number, label: string, allowEmpty = false): Uint8Array {
  const encoded = utf8(value);
  if ((!allowEmpty && encoded.length === 0) || encoded.length > max) betaError("INVALID_ARGUMENT", `${label} length invalid`);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, encoded.length, true);
  return concatBytes(length, encoded);
}

export function createMimir8004IdentityAdapter(
  input: MimirBetaDeployment,
): Mimir8004IdentityAdapter {
  const config = validateMimirBetaDeployment(input);
  const derive = (seeds: readonly Uint8Array[]) => getProgramDerivedAddress({
    programAddress: config.agentRegistryProgramId,
    seeds: [...seeds],
  });
  const adapter: Mimir8004IdentityAdapter = {
    ...config,
    deriveRootConfig: () => derive([utf8("root_config")]),
    deriveRegistryConfig: () => derive([utf8("registry_config"), addressBytes(config.physicalCollection)]),
    deriveAgentAccount: (asset) => derive([utf8("agent"), addressBytes(asset)]),
    deriveDisplayNameMetadata: (asset) => derive([utf8("agent_meta"), addressBytes(asset), DISPLAY_NAME_KEY_HASH]),
    async buildRegister(args) {
      const [[root], [registry], [agent]] = await Promise.all([
        adapter.deriveRootConfig(),
        adapter.deriveRegistryConfig(),
        adapter.deriveAgentAccount(args.asset),
      ]);
      return {
        programAddress: config.agentRegistryProgramId,
        accounts: [
          { address: root, isSigner: false, isWritable: false },
          { address: registry, isSigner: false, isWritable: false },
          { address: agent, isSigner: false, isWritable: true },
          { address: args.asset, isSigner: true, isWritable: true },
          { address: config.physicalCollection, isSigner: false, isWritable: true },
          { address: args.authority, isSigner: true, isWritable: true },
          { address: config.systemProgramId, isSigner: false, isWritable: false },
          { address: config.mplCoreProgramId, isSigner: false, isWritable: false },
        ],
        data: concatBytes(REGISTER_DISCRIMINATOR, borshString(args.agentUri, 250, "agent URI", true), Uint8Array.of(0)),
      };
    },
    async buildSetCollectionPointer(args) {
      const [agent] = await adapter.deriveAgentAccount(args.asset);
      return {
        programAddress: config.agentRegistryProgramId,
        accounts: [
          { address: agent, isSigner: false, isWritable: true },
          { address: args.asset, isSigner: false, isWritable: false },
          { address: args.authority, isSigner: true, isWritable: true },
        ],
        data: concatBytes(POINTER_DISCRIMINATOR, borshString(config.collectionPointer, 128, "collection pointer")),
      };
    },
    async buildSetImmutableDisplayName(args) {
      const displayName = validateMimirBetaDisplayName(args.displayName);
      const [[metadata], [agent]] = await Promise.all([
        adapter.deriveDisplayNameMetadata(args.asset),
        adapter.deriveAgentAccount(args.asset),
      ]);
      return {
        programAddress: config.agentRegistryProgramId,
        accounts: [
          { address: metadata, isSigner: false, isWritable: true },
          { address: agent, isSigner: false, isWritable: false },
          { address: args.asset, isSigner: false, isWritable: false },
          { address: args.authority, isSigner: true, isWritable: true },
          { address: config.systemProgramId, isSigner: false, isWritable: false },
        ],
        data: concatBytes(SET_METADATA_DISCRIMINATOR, DISPLAY_NAME_KEY_HASH,
          borshString(MIMIR_BETA_DISPLAY_NAME_METADATA_KEY, 32, "metadata key"),
          borshString(displayName, MIMIR_BETA_DISPLAY_NAME_MAX_UTF8_BYTES, "display name"), Uint8Array.of(1)),
      };
    },
  };
  return adapter;
}

export async function verifyMimir8004ConfigPdas(args: {
  readonly adapter: Mimir8004IdentityAdapter;
  readonly rootAddress: Address;
  readonly root: Mimir8004RootConfig;
  readonly registryAddress: Address;
  readonly registry: Mimir8004RegistryConfig;
}): Promise<void> {
  const [[root, rootBump], [registry, registryBump]] = await Promise.all([
    args.adapter.deriveRootConfig(),
    args.adapter.deriveRegistryConfig(),
  ]);
  if (
    root !== args.rootAddress || rootBump !== args.root.bump ||
    registry !== args.registryAddress || registryBump !== args.registry.bump ||
    args.root.baseCollection !== args.adapter.physicalCollection ||
    args.registry.collection !== args.adapter.physicalCollection ||
    args.root.authority !== args.registry.authority
  ) betaError("PDA_MISMATCH", "8004 canonical config mismatch");
}
