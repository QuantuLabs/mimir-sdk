export const SOLANA_PACKET_LIMIT_BYTES = 1232;

export function shortvecLength(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("InvalidShortvecValue");
  let remaining = value;
  let length = 0;
  do {
    remaining = Math.floor(remaining / 128);
    length += 1;
  } while (remaining > 0);
  return length;
}

export interface PurePacketProfile {
  readonly signerCount: number;
  readonly serializedMessageBytes: number;
  readonly serializedTransactionBytes: number;
  readonly packetLimitBytes: number;
  readonly fitsPacketLimit: boolean;
}

export function profileUnsignedPacket(args: {
  readonly serializedMessageBytes: number;
  readonly signerCount: number;
  readonly packetLimitBytes?: number;
}): PurePacketProfile {
  if (!Number.isSafeInteger(args.serializedMessageBytes) || args.serializedMessageBytes < 1) {
    throw new RangeError("InvalidSerializedMessageLength");
  }
  if (!Number.isSafeInteger(args.signerCount) || args.signerCount < 1 || args.signerCount > 255) {
    throw new RangeError("InvalidSignerCount");
  }
  const packetLimitBytes = args.packetLimitBytes ?? SOLANA_PACKET_LIMIT_BYTES;
  const serializedTransactionBytes = shortvecLength(args.signerCount) + args.signerCount * 64 + args.serializedMessageBytes;
  return {
    signerCount: args.signerCount,
    serializedMessageBytes: args.serializedMessageBytes,
    serializedTransactionBytes,
    packetLimitBytes,
    fitsPacketLimit: serializedTransactionBytes <= packetLimitBytes,
  };
}

export function profileLookupLowerBound(args: {
  readonly noLookupMessageBytes: number;
  readonly lookupEligibleAddressCount: number;
  readonly lookupTableCount?: number;
  readonly signerCount: number;
}): PurePacketProfile {
  if (!Number.isSafeInteger(args.lookupEligibleAddressCount) || args.lookupEligibleAddressCount < 0 || args.lookupEligibleAddressCount > 256) {
    throw new RangeError("InvalidLookupEligibleAddressCount");
  }
  const tables = args.lookupTableCount ?? (args.lookupEligibleAddressCount === 0 ? 0 : 1);
  const savedStaticBytes = args.lookupEligibleAddressCount * 32;
  const lookupBytes = tables === 0 ? 0 : tables * 34 + args.lookupEligibleAddressCount;
  return profileUnsignedPacket({
    serializedMessageBytes: Math.max(1, args.noLookupMessageBytes - savedStaticBytes + lookupBytes),
    signerCount: args.signerCount,
  });
}
