import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type MessageV0,
} from "@solana/web3.js";
import {
  profileUnsignedPacket,
  shortvecLength,
} from "./internal/packetProfileCore.js";

export const MIMIR_PACKET_LIMIT_BYTES = 1232;
export const MIMIR_SYNTHETIC_BLOCKHASH =
  "11111111111111111111111111111111";

export interface MimirV0AltLookupAddressPlan {
  lookupAddresses: readonly PublicKey[];
  staticAddresses: readonly PublicKey[];
  signerAddresses: readonly PublicKey[];
}

export interface MimirV0AltPacketProfile {
  packetLimitBytes: number;
  serializedBytes: number | null;
  fitsPacketLimit: boolean;
  error: string | null;
  instructionCount: number;
  instructionDataBytes: number;
  staticAccountKeys: number | null;
  lookupTableCount: number | null;
  loadedWritableIndexes: number | null;
  loadedReadonlyIndexes: number | null;
  loadedAddressCount: number | null;
  requiredSignatureCount: number | null;
  usesAddressLookupTable: boolean;
}

export type SizeAwareV0AltDecision =
  | "fits_without_alt"
  | "allowed_without_alt"
  | "fits_with_provided_alt"
  | "fits_with_resolved_alt";

export interface SizeAwareV0TransactionPlan {
  message: MessageV0;
  transaction: VersionedTransaction;
  profile: MimirV0AltPacketProfile;
  noAltProfile: MimirV0AltPacketProfile;
  addressLookupTables: readonly AddressLookupTableAccount[];
  altDecision: SizeAwareV0AltDecision;
}

export interface SizeAwareV0LookupTableResolverArgs {
  feePayer: PublicKey;
  recentBlockhash: string;
  instructions: readonly TransactionInstruction[];
  noAltProfile: MimirV0AltPacketProfile;
  providedLookupTables: readonly AddressLookupTableAccount[];
  packetLimitBytes: number;
  forceAddressLookupTable: boolean;
}

export type SizeAwareV0LookupTableResolver = (
  args: SizeAwareV0LookupTableResolverArgs,
) =>
  | readonly AddressLookupTableAccount[]
  | Promise<readonly AddressLookupTableAccount[]>;

export interface BuildSizeAwareV0TransactionArgs {
  feePayer: PublicKey;
  recentBlockhash: string;
  instructions: readonly TransactionInstruction[];
  lookupTables?: readonly AddressLookupTableAccount[];
  packetLimitBytes?: number;
  forceAddressLookupTable?: boolean;
  requirePacketFit?: boolean;
  label?: string;
}

export interface BuildSizeAwareV0TransactionWithResolverArgs
  extends BuildSizeAwareV0TransactionArgs {
  resolveLookupTables?: SizeAwareV0LookupTableResolver;
}

export interface SizeAwareV0InstructionChunk {
  instructions: readonly TransactionInstruction[];
  labels: readonly string[];
  profile: MimirV0AltPacketProfile;
}

export interface BuildMimirV0AltTransactionArgs {
  feePayer: PublicKey;
  recentBlockhash: string;
  instructions: readonly TransactionInstruction[];
  lookupTables: readonly AddressLookupTableAccount[];
  packetLimitBytes?: number;
  requireAddressLookupTable?: boolean;
  requirePacketFit?: boolean;
}

export interface BuildMimirV0AltTransactionResult {
  message: MessageV0;
  transaction: VersionedTransaction;
  profile: MimirV0AltPacketProfile;
}

function samePubkey(a: PublicKey, b: PublicKey): boolean {
  return a.equals(b);
}

function pushUnique(out: PublicKey[], seen: Set<string>, pubkey: PublicKey): void {
  const key = pubkey.toBase58();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(pubkey);
}

function shortVecByteLength(value: number): number {
  return shortvecLength(value);
}

function compiledInstructionByteLength(instruction: {
  accountKeyIndexes: number[];
  data: Uint8Array;
}): number {
  return (
    1 +
    shortVecByteLength(instruction.accountKeyIndexes.length) +
    instruction.accountKeyIndexes.length +
    shortVecByteLength(instruction.data.length) +
    instruction.data.length
  );
}

function v0MessageByteLength(message: MessageV0): number {
  return (
    1 +
    3 +
    shortVecByteLength(message.staticAccountKeys.length) +
    message.staticAccountKeys.length * 32 +
    32 +
    shortVecByteLength(message.compiledInstructions.length) +
    message.compiledInstructions.reduce(
      (sum, instruction) => sum + compiledInstructionByteLength(instruction),
      0,
    ) +
    shortVecByteLength(message.addressTableLookups.length) +
    message.addressTableLookups.reduce(
      (sum, lookup) =>
        sum +
        32 +
        shortVecByteLength(lookup.writableIndexes.length) +
        lookup.writableIndexes.length +
        shortVecByteLength(lookup.readonlyIndexes.length) +
        lookup.readonlyIndexes.length,
      0,
    )
  );
}

function serializedV0MessageByteLength(message: MessageV0): number {
  return profileUnsignedPacket({
    serializedMessageBytes: v0MessageByteLength(message),
    signerCount: message.header.numRequiredSignatures,
  }).serializedTransactionBytes;
}

function serializeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sizeAwareV0TransactionLabel(label: string | undefined): string {
  return label && label.trim().length > 0 ? label.trim() : "V0 transaction";
}

function sizeAwarePacketError(args: {
  label?: string;
  profile: MimirV0AltPacketProfile;
  lookupTableCount: number;
  noLookupTableAvailable?: boolean;
}): Error {
  const label = sizeAwareV0TransactionLabel(args.label);
  const serializedBytes =
    args.profile.serializedBytes == null
      ? "unknown"
      : args.profile.serializedBytes.toString();
  const lookupDetail =
    args.lookupTableCount > 0
      ? ` after ${args.lookupTableCount} address lookup table(s)`
      : args.noLookupTableAvailable
        ? " and no address lookup table is available"
        : "";
  const reason = args.profile.error
    ? `: ${args.profile.error}`
    : `: ${serializedBytes} bytes > ${args.profile.packetLimitBytes}`;
  return new Error(
    `${label} exceeds the ${args.profile.packetLimitBytes}-byte packet limit${lookupDetail}${reason}`,
  );
}

function compileV0Message(args: {
  feePayer: PublicKey;
  recentBlockhash: string;
  instructions: readonly TransactionInstruction[];
  lookupTables: readonly AddressLookupTableAccount[];
}): MessageV0 {
  return new TransactionMessage({
    payerKey: args.feePayer,
    recentBlockhash: args.recentBlockhash,
    instructions: [...args.instructions],
  }).compileToV0Message([...args.lookupTables]);
}

function profileCompiledV0Message(args: {
  message: MessageV0;
  instructionCount: number;
  instructionDataBytes: number;
  packetLimitBytes: number;
}): MimirV0AltPacketProfile {
  const serializedBytes = serializedV0MessageByteLength(args.message);
  const loadedWritableIndexes = args.message.addressTableLookups.reduce(
    (sum, lookup) => sum + lookup.writableIndexes.length,
    0,
  );
  const loadedReadonlyIndexes = args.message.addressTableLookups.reduce(
    (sum, lookup) => sum + lookup.readonlyIndexes.length,
    0,
  );
  return {
    packetLimitBytes: args.packetLimitBytes,
    serializedBytes,
    fitsPacketLimit: serializedBytes <= args.packetLimitBytes,
    error: null,
    instructionCount: args.instructionCount,
    instructionDataBytes: args.instructionDataBytes,
    staticAccountKeys: args.message.staticAccountKeys.length,
    lookupTableCount: args.message.addressTableLookups.length,
    loadedWritableIndexes,
    loadedReadonlyIndexes,
    loadedAddressCount: loadedWritableIndexes + loadedReadonlyIndexes,
    requiredSignatureCount: args.message.header.numRequiredSignatures,
    usesAddressLookupTable: args.message.addressTableLookups.length > 0,
  };
}

function compileAndProfileMimirV0AltTransaction(args: {
  feePayer: PublicKey;
  recentBlockhash?: string;
  instructions: readonly TransactionInstruction[];
  lookupTables: readonly AddressLookupTableAccount[];
  packetLimitBytes?: number;
  requireAddressLookupTable?: boolean;
}): { message: MessageV0 | null; profile: MimirV0AltPacketProfile } {
  const packetLimitBytes = args.packetLimitBytes ?? MIMIR_PACKET_LIMIT_BYTES;
  const instructionDataBytes = args.instructions.reduce(
    (sum, instruction) => sum + instruction.data.length,
    0,
  );
  try {
    if (args.requireAddressLookupTable !== false && args.lookupTables.length === 0) {
      throw new Error("MissingAddressLookupTable");
    }
    const message = compileV0Message({
      feePayer: args.feePayer,
      recentBlockhash: args.recentBlockhash ?? MIMIR_SYNTHETIC_BLOCKHASH,
      instructions: args.instructions,
      lookupTables: args.lookupTables,
    });
    if (
      args.requireAddressLookupTable !== false &&
      message.addressTableLookups.length === 0
    ) {
      throw new Error("AddressLookupTableNotUsed");
    }
    return {
      message,
      profile: profileCompiledV0Message({
        message,
        instructionCount: args.instructions.length,
        instructionDataBytes,
        packetLimitBytes,
      }),
    };
  } catch (error) {
    return {
      message: null,
      profile: {
        packetLimitBytes,
        serializedBytes: null,
        fitsPacketLimit: false,
        error: serializeErrorMessage(error),
        instructionCount: args.instructions.length,
        instructionDataBytes,
        staticAccountKeys: null,
        lookupTableCount: null,
        loadedWritableIndexes: null,
        loadedReadonlyIndexes: null,
        loadedAddressCount: null,
        requiredSignatureCount: null,
        usesAddressLookupTable: false,
      },
    };
  }
}

function withoutAltDecision(profile: MimirV0AltPacketProfile): SizeAwareV0AltDecision {
  return profile.fitsPacketLimit ? "fits_without_alt" : "allowed_without_alt";
}

function sameLookupTableKeys(
  a: readonly AddressLookupTableAccount[],
  b: readonly AddressLookupTableAccount[],
): boolean {
  return (
    a.length === b.length &&
    a.every((lookupTable, index) => lookupTable.key.equals(b[index]!.key))
  );
}

export function collectV0AltLookupAddresses(args: {
  instructions: readonly TransactionInstruction[];
  feePayer?: PublicKey;
  extraStaticAccounts?: readonly PublicKey[];
}): MimirV0AltLookupAddressPlan {
  const staticAddresses: PublicKey[] = [];
  const staticSeen = new Set<string>();
  if (args.feePayer) pushUnique(staticAddresses, staticSeen, args.feePayer);
  for (const pubkey of args.extraStaticAccounts ?? []) {
    pushUnique(staticAddresses, staticSeen, pubkey);
  }
  for (const instruction of args.instructions) {
    for (const meta of instruction.keys) {
      if (meta.isSigner) pushUnique(staticAddresses, staticSeen, meta.pubkey);
    }
  }

  const lookupAddresses: PublicKey[] = [];
  const lookupSeen = new Set<string>();
  for (const instruction of args.instructions) {
    for (const pubkey of [
      instruction.programId,
      ...instruction.keys.map((meta) => meta.pubkey),
    ]) {
      if (staticAddresses.some((staticPubkey) => samePubkey(staticPubkey, pubkey))) {
        continue;
      }
      pushUnique(lookupAddresses, lookupSeen, pubkey);
    }
  }

  return {
    lookupAddresses,
    staticAddresses,
    signerAddresses: staticAddresses,
  };
}

export function createSyntheticAddressLookupTable(args: {
  key: PublicKey;
  addresses: readonly PublicKey[];
  authority?: PublicKey;
}): AddressLookupTableAccount {
  return new AddressLookupTableAccount({
    key: args.key,
    state: {
      deactivationSlot: BigInt("18446744073709551615"),
      lastExtendedSlot: 1,
      lastExtendedSlotStartIndex: 0,
      authority: args.authority,
      addresses: [...args.addresses],
    },
  });
}

export function profileMimirV0AltTransaction(args: {
  feePayer: PublicKey;
  recentBlockhash?: string;
  instructions: readonly TransactionInstruction[];
  lookupTables: readonly AddressLookupTableAccount[];
  packetLimitBytes?: number;
  requireAddressLookupTable?: boolean;
}): MimirV0AltPacketProfile {
  return compileAndProfileMimirV0AltTransaction(args).profile;
}

export function buildMimirV0AltTransaction(
  args: BuildMimirV0AltTransactionArgs,
): BuildMimirV0AltTransactionResult {
  if (args.requireAddressLookupTable !== false && args.lookupTables.length === 0) {
    throw new Error("MissingAddressLookupTable");
  }
  const { message, profile } = compileAndProfileMimirV0AltTransaction({
    feePayer: args.feePayer,
    recentBlockhash: args.recentBlockhash,
    instructions: args.instructions,
    lookupTables: args.lookupTables,
    packetLimitBytes: args.packetLimitBytes,
    requireAddressLookupTable: args.requireAddressLookupTable,
  });
  if (message == null) {
    throw new Error(profile.error ?? "InvalidV0AltTransaction");
  }
  if (args.requirePacketFit !== false && !profile.fitsPacketLimit) {
    throw new Error(
      `V0AltPacketTooLarge:${profile.serializedBytes ?? "unknown"}>${profile.packetLimitBytes}`,
    );
  }
  return {
    message,
    transaction: new VersionedTransaction(message),
    profile,
  };
}

function buildSizeAwareV0TransactionFromLookupTables(args: {
  feePayer: PublicKey;
  recentBlockhash: string;
  instructions: readonly TransactionInstruction[];
  lookupTables: readonly AddressLookupTableAccount[];
  packetLimitBytes?: number;
  noAltProfile: MimirV0AltPacketProfile;
  altDecision: SizeAwareV0AltDecision;
  requirePacketFit?: boolean;
  label?: string;
}): SizeAwareV0TransactionPlan {
  const { message, profile } = compileAndProfileMimirV0AltTransaction({
    feePayer: args.feePayer,
    recentBlockhash: args.recentBlockhash,
    instructions: args.instructions,
    lookupTables: args.lookupTables,
    packetLimitBytes: args.packetLimitBytes,
    requireAddressLookupTable: false,
  });
  if (message == null) {
    throw new Error(profile.error ?? "InvalidV0AltTransaction");
  }
  if (args.requirePacketFit !== false && !profile.fitsPacketLimit) {
    throw sizeAwarePacketError({
      label: args.label,
      profile,
      lookupTableCount: args.lookupTables.length,
      noLookupTableAvailable: args.lookupTables.length === 0,
    });
  }
  return {
    message,
    transaction: new VersionedTransaction(message),
    profile,
    noAltProfile: args.noAltProfile,
    addressLookupTables: [...args.lookupTables],
    altDecision: args.altDecision,
  };
}

export function buildSizeAwareV0Transaction(
  args: BuildSizeAwareV0TransactionArgs,
): SizeAwareV0TransactionPlan {
  if (args.instructions.length === 0) {
    throw new Error("size-aware v0 transaction requires at least one instruction");
  }
  const packetLimitBytes = args.packetLimitBytes ?? MIMIR_PACKET_LIMIT_BYTES;
  const providedLookupTables = [...(args.lookupTables ?? [])].filter(
    (lookupTable) => lookupTable.state.addresses.length > 0,
  );
  const noAltProfile = profileMimirV0AltTransaction({
    feePayer: args.feePayer,
    recentBlockhash: args.recentBlockhash,
    instructions: args.instructions,
    lookupTables: [],
    packetLimitBytes,
    requireAddressLookupTable: false,
  });
  if (args.forceAddressLookupTable !== true && noAltProfile.fitsPacketLimit) {
    return buildSizeAwareV0TransactionFromLookupTables({
      feePayer: args.feePayer,
      recentBlockhash: args.recentBlockhash,
      instructions: args.instructions,
      lookupTables: [],
      packetLimitBytes,
      noAltProfile,
      altDecision: "fits_without_alt",
      requirePacketFit: args.requirePacketFit,
      label: args.label,
    });
  }
  if (providedLookupTables.length === 0) {
    if (args.requirePacketFit === false) {
      return buildSizeAwareV0TransactionFromLookupTables({
        feePayer: args.feePayer,
        recentBlockhash: args.recentBlockhash,
        instructions: args.instructions,
        lookupTables: [],
        packetLimitBytes,
        noAltProfile,
        altDecision: withoutAltDecision(noAltProfile),
        requirePacketFit: false,
        label: args.label,
      });
    }
    throw sizeAwarePacketError({
      label: args.label,
      profile: noAltProfile,
      lookupTableCount: 0,
      noLookupTableAvailable: true,
    });
  }
  return buildSizeAwareV0TransactionFromLookupTables({
    feePayer: args.feePayer,
    recentBlockhash: args.recentBlockhash,
    instructions: args.instructions,
    lookupTables: providedLookupTables,
    packetLimitBytes,
    noAltProfile,
    altDecision: "fits_with_provided_alt",
    requirePacketFit: args.requirePacketFit,
    label: args.label,
  });
}

export async function buildSizeAwareV0TransactionWithResolver(
  args: BuildSizeAwareV0TransactionWithResolverArgs,
): Promise<SizeAwareV0TransactionPlan> {
  if (args.instructions.length === 0) {
    throw new Error("size-aware v0 transaction requires at least one instruction");
  }
  const packetLimitBytes = args.packetLimitBytes ?? MIMIR_PACKET_LIMIT_BYTES;
  const providedLookupTables = [...(args.lookupTables ?? [])].filter(
    (lookupTable) => lookupTable.state.addresses.length > 0,
  );
  const noAltProfile = profileMimirV0AltTransaction({
    feePayer: args.feePayer,
    recentBlockhash: args.recentBlockhash,
    instructions: args.instructions,
    lookupTables: [],
    packetLimitBytes,
    requireAddressLookupTable: false,
  });
  if (args.forceAddressLookupTable !== true && noAltProfile.fitsPacketLimit) {
    return buildSizeAwareV0TransactionFromLookupTables({
      feePayer: args.feePayer,
      recentBlockhash: args.recentBlockhash,
      instructions: args.instructions,
      lookupTables: [],
      packetLimitBytes,
      noAltProfile,
      altDecision: "fits_without_alt",
      requirePacketFit: args.requirePacketFit,
      label: args.label,
    });
  }

  let lookupTables = providedLookupTables;
  let altDecision: SizeAwareV0AltDecision = "fits_with_provided_alt";
  if (args.resolveLookupTables) {
    const resolvedLookupTables = [
      ...(await args.resolveLookupTables({
        feePayer: args.feePayer,
        recentBlockhash: args.recentBlockhash,
        instructions: args.instructions,
        noAltProfile,
        providedLookupTables,
        packetLimitBytes,
        forceAddressLookupTable: args.forceAddressLookupTable === true,
      })),
    ].filter((lookupTable) => lookupTable.state.addresses.length > 0);
    lookupTables = resolvedLookupTables;
    altDecision = sameLookupTableKeys(resolvedLookupTables, providedLookupTables)
      ? "fits_with_provided_alt"
      : "fits_with_resolved_alt";
  }

  if (lookupTables.length === 0) {
    if (args.requirePacketFit === false) {
      return buildSizeAwareV0TransactionFromLookupTables({
        feePayer: args.feePayer,
        recentBlockhash: args.recentBlockhash,
        instructions: args.instructions,
        lookupTables: [],
        packetLimitBytes,
        noAltProfile,
        altDecision: withoutAltDecision(noAltProfile),
        requirePacketFit: false,
        label: args.label,
      });
    }
    throw sizeAwarePacketError({
      label: args.label,
      profile: noAltProfile,
      lookupTableCount: 0,
      noLookupTableAvailable: true,
    });
  }

  return buildSizeAwareV0TransactionFromLookupTables({
    feePayer: args.feePayer,
    recentBlockhash: args.recentBlockhash,
    instructions: args.instructions,
    lookupTables,
    packetLimitBytes,
    noAltProfile,
    altDecision,
    requirePacketFit: args.requirePacketFit,
    label: args.label,
  });
}

export function chunkSizeAwareV0InstructionsByPacket(args: {
  feePayer: PublicKey;
  recentBlockhash?: string;
  instructions: readonly TransactionInstruction[];
  lookupTables?: readonly AddressLookupTableAccount[];
  packetLimitBytes?: number;
  labels?: readonly string[];
  label?: string;
}): SizeAwareV0InstructionChunk[] {
  const chunks: SizeAwareV0InstructionChunk[] = [];
  let currentInstructions: TransactionInstruction[] = [];
  let currentLabels: string[] = [];
  let currentProfile: MimirV0AltPacketProfile | null = null;
  const lookupTables = args.lookupTables ?? [];
  const recentBlockhash = args.recentBlockhash ?? MIMIR_SYNTHETIC_BLOCKHASH;
  const packetLimitBytes = args.packetLimitBytes ?? MIMIR_PACKET_LIMIT_BYTES;
  const profile = (instructions: readonly TransactionInstruction[]) =>
    profileMimirV0AltTransaction({
      feePayer: args.feePayer,
      recentBlockhash,
      instructions,
      lookupTables,
      packetLimitBytes,
      requireAddressLookupTable: false,
    });
  const flush = (): void => {
    if (currentInstructions.length === 0) return;
    chunks.push({
      instructions: currentInstructions,
      labels: currentLabels,
      profile: currentProfile ?? profile(currentInstructions),
    });
    currentInstructions = [];
    currentLabels = [];
    currentProfile = null;
  };

  for (let index = 0; index < args.instructions.length; index += 1) {
    const instruction = args.instructions[index]!;
    const label = args.labels?.[index] ?? `instruction_${index}`;
    const candidate = [...currentInstructions, instruction];
    const candidateProfile = profile(candidate);
    if (candidateProfile.fitsPacketLimit) {
      currentInstructions = candidate;
      currentLabels = [...currentLabels, label];
      currentProfile = candidateProfile;
      continue;
    }
    flush();
    const singleProfile = profile([instruction]);
    if (!singleProfile.fitsPacketLimit) {
      throw sizeAwarePacketError({
        label: `${sizeAwareV0TransactionLabel(args.label)} chunk ${label}`,
        profile: singleProfile,
        lookupTableCount: lookupTables.length,
        noLookupTableAvailable: lookupTables.length === 0,
      });
    }
    currentInstructions = [instruction];
    currentLabels = [label];
  }
  flush();
  return chunks;
}
