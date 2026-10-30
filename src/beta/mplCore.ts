import {
  ExternalPluginAdapterType,
  Key,
  PluginType,
  deserializeAssetV1,
  deserializeCollectionV1,
  getExternalPluginAdapterSerializer,
  getExternalRegistryRecordSerializer,
  getKeySerializer,
  getPluginHeaderV1AccountDataSerializer,
  getPluginSerializer,
  getRegistryRecordSerializer,
  transferV1,
} from "@metaplex-foundation/mpl-core";
import {
  createNoopSigner,
  isSome,
  lamports,
  publicKey,
} from "@metaplex-foundation/umi";
import { address, type Address } from "@solana/kit";
import { betaError } from "./errors.js";
import { validateMimirBetaDeployment, type MimirBetaDeployment } from "./deployment.js";
import type { MimirBetaAccount, MimirBetaInstruction } from "./types.js";

type OffsetRecord = { readonly offset: bigint; readonly pluginType: PluginType };
type ExternalOffsetRecord = {
  readonly offset: bigint;
  readonly pluginType: ExternalPluginAdapterType;
  readonly dataOffset: { readonly __option: "Some"; readonly value: bigint } | { readonly __option: "None" };
  readonly dataLen: { readonly __option: "Some"; readonly value: bigint } | { readonly __option: "None" };
};

const PLUGIN_KINDS = [
  "Royalties", "FreezeDelegate", "BurnDelegate", "TransferDelegate", "UpdateDelegate",
  "PermanentFreezeDelegate", "Attributes", "PermanentTransferDelegate", "PermanentBurnDelegate",
  "Edition", "MasterEdition", "AddBlocker", "ImmutableMetadata", "VerifiedCreators", "Autograph",
  "BubblegumV2", "FreezeExecute", "PermanentFreezeExecute", "Groups",
] as const;
const EXTERNAL_PLUGIN_KINDS = [
  "LifecycleHook", "Oracle", "AppData", "LinkedLifecycleHook", "LinkedAppData", "DataSection", "AgentIdentity",
] as const;

function safeOffset(value: bigint, data: Uint8Array, label: string): number {
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > data.length) {
    betaError("ACCOUNT_MALFORMED", `${label} is out of bounds`);
  }
  return offset;
}

function u32(data: Uint8Array, offset: number, label: string): readonly [number, number] {
  if (offset + 4 > data.length) betaError("ACCOUNT_MALFORMED", `${label} is truncated`);
  return [new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true), offset + 4];
}

function sizedStringEnd(data: Uint8Array, offset: number, label: string): number {
  const [length, start] = u32(data, offset, `${label} length`);
  const end = start + length;
  if (!Number.isSafeInteger(end) || end > data.length) betaError("ACCOUNT_MALFORMED", `${label} is truncated`);
  return end;
}

function assetBaseEnd(data: Uint8Array): number {
  if (data.length < 34) betaError("ACCOUNT_MALFORMED", "Core asset is truncated");
  const authorityKind = data[33]!;
  let offset = authorityKind === 0 ? 34 : authorityKind === 1 || authorityKind === 2 ? 66 : -1;
  if (offset < 0 || offset > data.length) betaError("ACCOUNT_MALFORMED", "Core update authority is malformed");
  offset = sizedStringEnd(data, offset, "Core asset name");
  offset = sizedStringEnd(data, offset, "Core asset URI");
  if (offset >= data.length) betaError("ACCOUNT_MALFORMED", "Core asset sequence option is truncated");
  const option = data[offset++]!;
  if (option === 1) offset += 8;
  else if (option !== 0) betaError("ACCOUNT_MALFORMED", "Core asset sequence option is malformed");
  if (offset > data.length) betaError("ACCOUNT_MALFORMED", "Core asset sequence is truncated");
  return offset;
}

export function collectionBaseEnd(data: Uint8Array): number {
  if (data.length < 33) betaError("ACCOUNT_MALFORMED", "Core collection is truncated");
  let offset = sizedStringEnd(data, 33, "Core collection name");
  offset = sizedStringEnd(data, offset, "Core collection URI");
  if (offset + 8 > data.length) betaError("ACCOUNT_MALFORMED", "Core collection counters are truncated");
  return offset + 8;
}

function verifyOfficialPluginTail(
  data: Uint8Array,
  baseEnd: number,
  decodedPluginHeader: { readonly pluginRegistryOffset: bigint } | undefined,
): void {
  if (!decodedPluginHeader) {
    if (baseEnd !== data.length) betaError("ACCOUNT_MALFORMED", "unconsumed Core account bytes");
    return;
  }
  const [header, headerEnd] = getPluginHeaderV1AccountDataSerializer().deserialize(data, baseEnd);
  if (header.key !== Key.PluginHeaderV1 || header.pluginRegistryOffset !== decodedPluginHeader.pluginRegistryOffset) {
    betaError("ACCOUNT_MALFORMED", "Core plugin header mismatch");
  }
  const registryStart = safeOffset(header.pluginRegistryOffset, data, "Core plugin registry offset");
  if (registryStart < headerEnd) betaError("ACCOUNT_MALFORMED", "Core plugin registry overlaps header");

  let offset = registryStart;
  const [registryKey, afterKey] = getKeySerializer().deserialize(data, offset);
  if (registryKey !== Key.PluginRegistryV1) betaError("ACCOUNT_MALFORMED", "Core plugin registry key mismatch");
  offset = afterKey;
  const [pluginCount, afterPluginCount] = u32(data, offset, "Core plugin count");
  offset = afterPluginCount;
  const plugins: OffsetRecord[] = [];
  for (let index = 0; index < pluginCount; index += 1) {
    const [record, next] = getRegistryRecordSerializer().deserialize(data, offset);
    plugins.push(record);
    offset = next;
  }
  const [externalCount, afterExternalCount] = u32(data, offset, "Core external plugin count");
  offset = afterExternalCount;
  const external: ExternalOffsetRecord[] = [];
  for (let index = 0; index < externalCount; index += 1) {
    const [record, next] = getExternalRegistryRecordSerializer().deserialize(data, offset);
    external.push(record as ExternalOffsetRecord);
    offset = next;
  }
  if (offset !== data.length) betaError("ACCOUNT_MALFORMED", "trailing Core plugin registry bytes");

  const segments: Array<{ readonly start: number; readonly kind: "plugin" | "external" | "data"; readonly length?: number; readonly registryKind?: string }> = [];
  for (const record of plugins) segments.push({
    start: safeOffset(record.offset, data, "Core plugin offset"),
    kind: "plugin",
    registryKind: PLUGIN_KINDS[record.pluginType],
  });
  for (const record of external) {
    segments.push({
      start: safeOffset(record.offset, data, "Core external plugin offset"),
      kind: "external",
      registryKind: EXTERNAL_PLUGIN_KINDS[record.pluginType],
    });
    if (isSome(record.dataOffset) !== isSome(record.dataLen)) betaError("ACCOUNT_MALFORMED", "Core external data range is incomplete");
    if (isSome(record.dataOffset) && isSome(record.dataLen)) {
      segments.push({
        start: safeOffset(record.dataOffset.value, data, "Core external data offset"),
        kind: "data",
        length: safeOffset(record.dataLen.value, data, "Core external data length"),
      });
    }
  }
  segments.sort((left, right) => left.start - right.start);
  let expected = headerEnd;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const end = index + 1 < segments.length ? segments[index + 1]!.start : registryStart;
    if (segment.start !== expected || end < segment.start) betaError("ACCOUNT_MALFORMED", "Core plugin tail has a gap or overlap");
    if (segment.kind === "data") {
      if (segment.start + segment.length! !== end) betaError("ACCOUNT_MALFORMED", "Core external data length mismatch");
    } else {
      const serializer = segment.kind === "plugin" ? getPluginSerializer() : getExternalPluginAdapterSerializer();
      const [decoded, consumed] = serializer.deserialize(data, segment.start);
      if (consumed !== end) betaError("ACCOUNT_MALFORMED", "Core plugin bytes were not fully consumed");
      if (!segment.registryKind || decoded.__kind !== segment.registryKind) {
        betaError("ACCOUNT_MALFORMED", "Core plugin registry type mismatch");
      }
    }
    expected = end;
  }
  if (expected !== registryStart) betaError("ACCOUNT_MALFORMED", "Core plugin tail was not fully consumed");
}

function assertCoreAccount(
  account: MimirBetaAccount,
  deployment: MimirBetaDeployment,
  expectedAddress: Address,
): void {
  if (account.address !== expectedAddress) betaError("IDENTITY_UNVERIFIED", "Core account address mismatch", account.address);
  if (account.owner !== deployment.mplCoreProgramId) betaError("ACCOUNT_OWNER_MISMATCH", "Core account owner mismatch", account.address);
  if (account.executable) betaError("ACCOUNT_MALFORMED", "Core data account must not be executable", account.address);
}

function rawAccount(account: MimirBetaAccount) {
  return {
    publicKey: publicKey(String(account.address)),
    owner: publicKey(String(account.owner)),
    executable: account.executable,
    lamports: lamports(account.lamports),
    data: account.data,
  };
}

export function decodeMimirBetaCoreCollection(
  account: MimirBetaAccount,
  deployment: MimirBetaDeployment,
): { readonly updateAuthority: Address; readonly numMinted: number; readonly currentSize: number } {
  const config = validateMimirBetaDeployment(deployment);
  assertCoreAccount(account, config, config.physicalCollection);
  const decoded = deserializeCollectionV1(rawAccount(account));
  verifyOfficialPluginTail(account.data, collectionBaseEnd(account.data), decoded.pluginHeader);
  return { updateAuthority: address(decoded.updateAuthority), numMinted: decoded.numMinted, currentSize: decoded.currentSize };
}

export function decodeMimirBetaCoreAsset(
  account: MimirBetaAccount,
  deployment: MimirBetaDeployment,
  expectedAsset: Address,
): { readonly liveOwner: Address; readonly collection: Address } {
  const config = validateMimirBetaDeployment(deployment);
  assertCoreAccount(account, config, expectedAsset);
  const decoded = deserializeAssetV1(rawAccount(account));
  verifyOfficialPluginTail(account.data, assetBaseEnd(account.data), decoded.pluginHeader);
  if (decoded.updateAuthority.type !== "Collection" || !decoded.updateAuthority.address) {
    betaError("IDENTITY_UNVERIFIED", "Core asset is not bound to a collection", account.address);
  }
  return {
    liveOwner: address(decoded.owner),
    collection: address(decoded.updateAuthority.address),
  };
}

export function buildMimirBetaCoreTransferV1(args: {
  readonly deployment: MimirBetaDeployment;
  readonly asset: Address;
  readonly authority: Address;
  readonly payer: Address;
  readonly newOwner: Address;
}): MimirBetaInstruction {
  const config = validateMimirBetaDeployment(args.deployment);
  const payer = createNoopSigner(publicKey(String(args.payer)));
  const authority = createNoopSigner(publicKey(String(args.authority)));
  const programs = {
    getPublicKey: (identifier: string) => {
      if (identifier !== "mplCore") betaError("INVALID_ARGUMENT", "unexpected Umi program lookup");
      return publicKey(String(config.mplCoreProgramId));
    },
  };
  const builder = transferV1({ payer, programs } as never, {
    asset: publicKey(String(args.asset)),
    collection: publicKey(String(config.physicalCollection)),
    payer,
    authority,
    newOwner: publicKey(String(args.newOwner)),
    systemProgram: publicKey(String(config.systemProgramId)),
  });
  const instructions = builder.getInstructions();
  if (instructions.length !== 1) betaError("INVALID_ARGUMENT", "MPL Core transfer must be one instruction");
  const instruction = instructions[0]!;
  if (String(instruction.programId) !== config.mplCoreProgramId) {
    betaError("INVALID_ARGUMENT", "MPL Core builder selected an unexpected program");
  }
  return {
    programAddress: address(instruction.programId),
    accounts: instruction.keys.map((meta) => ({
      address: address(meta.pubkey),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    data: Uint8Array.from(instruction.data),
  };
}
