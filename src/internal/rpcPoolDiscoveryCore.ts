export type PoolCoreFamily =
  | "orca-whirlpool"
  | "meteora-dlmm"
  | "meteora-damm-v2"
  | "raydium-clmm"
  | "raydium-cpmm"
  | "raydium-amm-v4"
  | "pumpswap";

export interface PoolCoreLayout {
  readonly family: PoolCoreFamily;
  readonly programId: string;
  readonly accountSize: number;
  readonly discriminatorOffset: number;
  readonly discriminator: Uint8Array | null;
  readonly mintAOffset: number;
  readonly mintBOffset: number;
  readonly vaultAOffset: number;
  readonly vaultBOffset: number;
  readonly status?: {
    readonly offset: number;
    readonly enabled?: number;
    readonly disabledMask?: number;
    readonly acceptedU64?: readonly bigint[];
  };
  readonly activation?: {
    readonly offset: number;
    readonly typeOffset?: number;
    readonly slotType?: number;
    readonly timestampType?: number;
  };
  readonly liquidityOffset?: number;
}

export interface PoolCoreAccount {
  readonly address: string;
  readonly owner: string;
  readonly data: Uint8Array;
}

export type PoolCoreExclusion =
  | "ACCOUNT_MALFORMED"
  | "WRONG_OWNER"
  | "NOT_ACTIVE"
  | "MINT_MISMATCH"
  | "ZERO_LIQUIDITY"
  | "DUPLICATE";

export function validatePoolCoreAccountEnvelope(
  account: PoolCoreAccount,
  expectedOwner: string,
  expectedLength: number,
): "WRONG_OWNER" | "ACCOUNT_MALFORMED" | null {
  if (account.owner !== expectedOwner) return "WRONG_OWNER";
  if (account.data.length !== expectedLength) return "ACCOUNT_MALFORMED";
  return null;
}

export interface PoolCoreCandidate {
  readonly family: PoolCoreFamily;
  readonly programId: string;
  readonly pool: string;
  readonly baseMint: Uint8Array;
  readonly quoteMint: Uint8Array;
  readonly baseVault: Uint8Array;
  readonly quoteVault: Uint8Array;
  readonly liquidity: bigint;
  readonly exclusion: PoolCoreExclusion | null;
}

function safeOffset(offset: number, length: number, size: number, label: string): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || offset + length > size) {
    throw new Error(`INVALID_LAYOUT:${label}`);
  }
}

export function validatePoolCoreLayouts(layouts: readonly PoolCoreLayout[]): void {
  if (layouts.length < 1 || layouts.length > 9) throw new Error("INVALID_LAYOUT:count");
  const identities = new Set<string>();
  for (const layout of layouts) {
    const identity = `${layout.family}:${layout.programId}:${layout.accountSize}`;
    if (identities.has(identity)) throw new Error("INVALID_LAYOUT:duplicate");
    identities.add(identity);
    if (!Number.isSafeInteger(layout.accountSize) || layout.accountSize < 1 ||
        (layout.discriminator !== null && layout.discriminator.length < 1)) {
      throw new Error("INVALID_LAYOUT:size");
    }
    if (layout.discriminator !== null) safeOffset(layout.discriminatorOffset, layout.discriminator.length, layout.accountSize, "discriminator");
    for (const [label, offset] of Object.entries({ mintA: layout.mintAOffset, mintB: layout.mintBOffset, vaultA: layout.vaultAOffset, vaultB: layout.vaultBOffset })) {
      safeOffset(offset, 32, layout.accountSize, label);
    }
    if (layout.status) {
      if ((layout.status.enabled !== undefined) === (layout.status.acceptedU64 !== undefined) ||
          (layout.status.disabledMask !== undefined && layout.status.enabled === undefined) || layout.status.acceptedU64?.length === 0) {
        throw new Error("INVALID_LAYOUT:status");
      }
      safeOffset(layout.status.offset, layout.status.acceptedU64 ? 8 : 1, layout.accountSize, "status");
    }
    if (layout.discriminator === null && (!layout.status?.acceptedU64 || layout.status.acceptedU64.length === 0)) {
      throw new Error("INVALID_LAYOUT:discriminator");
    }
    if (layout.activation) {
      safeOffset(layout.activation.offset, 8, layout.accountSize, "activation");
      if (layout.activation.typeOffset !== undefined) {
        safeOffset(layout.activation.typeOffset, 1, layout.accountSize, "activationType");
        if (layout.activation.slotType === undefined || layout.activation.timestampType === undefined ||
            layout.activation.slotType === layout.activation.timestampType) throw new Error("INVALID_LAYOUT:activationKinds");
      } else if (layout.activation.slotType !== undefined || layout.activation.timestampType !== undefined) {
        throw new Error("INVALID_LAYOUT:activationKinds");
      }
    }
    if (layout.liquidityOffset !== undefined) safeOffset(layout.liquidityOffset, 16, layout.accountSize, "liquidity");
  }
}

function eq(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function u64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true);
}

function u128(data: Uint8Array, offset: number): bigint {
  return u64(data, offset) | (u64(data, offset + 8) << 64n);
}

export function decodePoolCoreCandidate(args: {
  readonly layout: PoolCoreLayout;
  readonly account: PoolCoreAccount;
  readonly baseMint: Uint8Array;
  readonly quoteMint: Uint8Array;
  readonly observedSlot: bigint;
  readonly observedUnixTimestamp: bigint;
}): PoolCoreCandidate {
  const { layout, account } = args;
  const envelope = validatePoolCoreAccountEnvelope(account, layout.programId, layout.accountSize);
  if (envelope === "ACCOUNT_MALFORMED") {
    return {
      family: layout.family,
      programId: layout.programId,
      pool: account.address,
      baseMint: args.baseMint.slice(),
      quoteMint: args.quoteMint.slice(),
      baseVault: new Uint8Array(32),
      quoteVault: new Uint8Array(32),
      liquidity: 0n,
      exclusion: "ACCOUNT_MALFORMED",
    };
  }
  const malformed = layout.discriminator !== null && !eq(
    account.data.subarray(layout.discriminatorOffset, layout.discriminatorOffset + layout.discriminator.length),
    layout.discriminator,
  );
  const mintA = account.data.subarray(layout.mintAOffset, layout.mintAOffset + 32);
  const mintB = account.data.subarray(layout.mintBOffset, layout.mintBOffset + 32);
  const direct = eq(mintA, args.baseMint) && eq(mintB, args.quoteMint);
  const reverse = eq(mintB, args.baseMint) && eq(mintA, args.quoteMint);
  let exclusion: PoolCoreExclusion | null = malformed ? "ACCOUNT_MALFORMED" : null;
  if (!exclusion && envelope === "WRONG_OWNER") exclusion = "WRONG_OWNER";
  if (!exclusion && !direct && !reverse) exclusion = "MINT_MISMATCH";
  if (!exclusion && layout.status) {
    const status = layout.status.acceptedU64 ? u64(account.data, layout.status.offset) : account.data[layout.status.offset]!;
    if (layout.status.acceptedU64 ? !layout.status.acceptedU64.includes(status as bigint) :
      layout.status.disabledMask !== undefined ? ((status as number) & layout.status.disabledMask) !== 0 : status !== layout.status.enabled) {
      exclusion = "NOT_ACTIVE";
    }
  }
  if (!exclusion && layout.activation) {
    const point = u64(account.data, layout.activation.offset);
    if (layout.activation.typeOffset === undefined) {
      if (args.observedUnixTimestamp < point) exclusion = "NOT_ACTIVE";
    } else {
      const type = account.data[layout.activation.typeOffset]!;
      if ((type === layout.activation.slotType && args.observedSlot < point) ||
        (type === layout.activation.timestampType && args.observedUnixTimestamp < point) ||
        (type !== layout.activation.slotType && type !== layout.activation.timestampType)) exclusion = "NOT_ACTIVE";
    }
  }
  const liquidity = layout.liquidityOffset === undefined ? 1n : u128(account.data, layout.liquidityOffset);
  if (!exclusion && liquidity === 0n) exclusion = "ZERO_LIQUIDITY";
  const baseVaultOffset = direct ? layout.vaultAOffset : layout.vaultBOffset;
  const quoteVaultOffset = direct ? layout.vaultBOffset : layout.vaultAOffset;
  return {
    family: layout.family,
    programId: layout.programId,
    pool: account.address,
    baseMint: args.baseMint.slice(),
    quoteMint: args.quoteMint.slice(),
    baseVault: account.data.slice(baseVaultOffset, baseVaultOffset + 32),
    quoteVault: account.data.slice(quoteVaultOffset, quoteVaultOffset + 32),
    liquidity,
    exclusion,
  };
}

export function classifyPoolCoreDuplicates(candidates: readonly PoolCoreCandidate[]): readonly PoolCoreCandidate[] {
  const pools = new Set<string>();
  const vaults = new Set<string>();
  return candidates.map((candidate) => {
    if (candidate.exclusion !== null) return candidate;
    const vaultKey = `${Array.from(candidate.baseVault)}:${Array.from(candidate.quoteVault)}`;
    if (pools.has(candidate.pool) || vaults.has(vaultKey)) return { ...candidate, exclusion: "DUPLICATE" };
    pools.add(candidate.pool);
    vaults.add(vaultKey);
    return candidate;
  });
}

export function comparePoolCoreCandidates(a: PoolCoreCandidate, b: PoolCoreCandidate): number {
  if ((a.exclusion === null) !== (b.exclusion === null)) return a.exclusion === null ? -1 : 1;
  if (a.liquidity !== b.liquidity) return a.liquidity > b.liquidity ? -1 : 1;
  return `${a.family}:${a.programId}:${a.pool}`.localeCompare(`${b.family}:${b.programId}:${b.pool}`);
}
