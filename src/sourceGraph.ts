import { createHash } from "./internal/sha256.js";
import { PublicKey } from "@solana/web3.js";
import { freshCanonicalAuthority } from "./internal/canonicalAuthority.js";
import {
  SPL_TOKEN_2022_PROGRAM_ID,
  sourceAdapterSupportsVersion,
  VERSION_V0,
  VERSION_V1,
} from "./constants.js";
import type { SourceConfigHeader } from "./types.js";

const {
  PUMPSWAP_FEE_PROGRAM_ID,
  PUMPSWAP_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID: CANONICAL_SPL_TOKEN_PROGRAM_ID,
  SourceAdapterType,
} = freshCanonicalAuthority(PublicKey);

export type PubkeyInput = PublicKey | Uint8Array;

export interface CpmmSourceAccountsHashInput {
  sourceConfigAddress: PubkeyInput;
  sourceConfig: Pick<
    SourceConfigHeader,
    | "feedId"
    | "sourceIndex"
    | "adapterType"
    | "direction"
    | "adapterVersion"
    | "programId"
    | "poolOrMarket"
    | "baseVault"
    | "quoteVault"
    | "baseMint"
    | "quoteMint"
    | "tokenProgram"
    | "vaultAuthority"
  >;
  poolOrMarket?: PubkeyInput;
  baseVault?: PubkeyInput;
  quoteVault?: PubkeyInput;
}

export interface OrcaWhirlpoolSourceAccountsHashInput
  extends CpmmSourceAccountsHashInput {
  whirlpoolsConfig: PubkeyInput;
}

export interface OrcaWhirlpoolRouteableSourceAccountsHashInput
  extends OrcaWhirlpoolSourceAccountsHashInput {
  lowerTickArray: PubkeyInput;
  activeTickArray: PubkeyInput;
  upperTickArray: PubkeyInput;
}

export interface MeteoraDlmmSourceAccountsHashInput
  extends CpmmSourceAccountsHashInput {
  activeBinArray: PubkeyInput;
  /** Required only for DLMM V1; omitted to preserve V0 hash bytes. */
  token2022Mint?: PubkeyInput;
}

export interface MeteoraDlmmRouteableSourceAccountsHashInput
  extends MeteoraDlmmSourceAccountsHashInput {
  lowerBinArray: PubkeyInput;
  upperBinArray: PubkeyInput;
}

export type MeteoraDammV2SourceAccountsHashInput = CpmmSourceAccountsHashInput;

export type RaydiumClmmSourceAccountsHashInput = CpmmSourceAccountsHashInput;

export type PumpSwapSourceAccountsHashInput = CpmmSourceAccountsHashInput;

export interface RaydiumClmmRouteableSourceAccountsHashInput
  extends RaydiumClmmSourceAccountsHashInput {
  lowerTickArray: PubkeyInput;
  activeTickArray: PubkeyInput;
  upperTickArray: PubkeyInput;
  /** Required for the CLMM Token-2022 V1 routeable policy. */
  token2022Mint?: PubkeyInput;
}

export type SourceAccountsHashInput =
  | CpmmSourceAccountsHashInput
  | OrcaWhirlpoolSourceAccountsHashInput
  | OrcaWhirlpoolRouteableSourceAccountsHashInput
  | MeteoraDlmmSourceAccountsHashInput
  | MeteoraDlmmRouteableSourceAccountsHashInput
  | MeteoraDammV2SourceAccountsHashInput
  | RaydiumClmmRouteableSourceAccountsHashInput;

function bytes32(value: PubkeyInput, name: string): Buffer {
  const bytes = value instanceof PublicKey ? value.toBuffer() : Buffer.from(value);
  if (bytes.length !== 32) throw new Error(`${name}Expected32Bytes`);
  return bytes;
}

function oneByte(value: number, name: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`Invalid${name}`);
  }
  return Buffer.from([value]);
}

function u16le(value: number, name: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error(`Invalid${name}`);
  }
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

export function computeCpmmSourceAccountsHash(
  input: CpmmSourceAccountsHashInput,
): Buffer {
  const source = input.sourceConfig;
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("MIMIR_ACCOUNTS_V1", "ascii"));
  hasher.update(bytes32(source.feedId, "FeedId"));
  hasher.update(oneByte(source.sourceIndex, "SourceIndex"));
  hasher.update(oneByte(source.adapterType, "AdapterType"));
  hasher.update(oneByte(source.direction, "Direction"));
  hasher.update(u16le(source.adapterVersion, "AdapterVersion"));
  hasher.update(bytes32(input.sourceConfigAddress, "SourceConfigAddress"));
  hasher.update(bytes32(source.programId, "ProgramId"));
  hasher.update(bytes32(input.poolOrMarket ?? source.poolOrMarket, "PoolOrMarket"));
  hasher.update(bytes32(input.baseVault ?? source.baseVault, "BaseVault"));
  hasher.update(bytes32(input.quoteVault ?? source.quoteVault, "QuoteVault"));
  hasher.update(bytes32(source.baseMint, "BaseMint"));
  hasher.update(bytes32(source.quoteMint, "QuoteMint"));
  hasher.update(bytes32(source.tokenProgram, "TokenProgram"));
  hasher.update(bytes32(source.vaultAuthority, "VaultAuthority"));
  return hasher.digest();
}

export function computePumpSwapSourceAccountsHash(
  input: PumpSwapSourceAccountsHashInput,
): Buffer {
  const source = input.sourceConfig;
  const [globalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    PUMPSWAP_PROGRAM_ID,
  );
  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMPSWAP_PROGRAM_ID.toBuffer()],
    PUMPSWAP_FEE_PROGRAM_ID,
  );
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("MIMIR_PUMPSWAP_ACCOUNTS_V1", "ascii"));
  hasher.update(bytes32(source.feedId, "FeedId"));
  hasher.update(oneByte(source.sourceIndex, "SourceIndex"));
  hasher.update(oneByte(source.adapterType, "AdapterType"));
  hasher.update(u16le(source.adapterVersion, "AdapterVersion"));
  hasher.update(oneByte(source.direction, "Direction"));
  hasher.update(bytes32(input.sourceConfigAddress, "SourceConfigAddress"));
  hasher.update(bytes32(source.programId, "ProgramId"));
  hasher.update(bytes32(input.poolOrMarket ?? source.poolOrMarket, "PoolOrMarket"));
  hasher.update(bytes32(source.baseMint, "BaseMint"));
  hasher.update(bytes32(source.quoteMint, "QuoteMint"));
  hasher.update(bytes32(input.baseVault ?? source.baseVault, "BaseVault"));
  hasher.update(bytes32(input.quoteVault ?? source.quoteVault, "QuoteVault"));
  hasher.update(globalConfig.toBuffer());
  hasher.update(feeConfig.toBuffer());
  hasher.update(bytes32(source.tokenProgram, "BaseTokenProgram"));
  hasher.update(CANONICAL_SPL_TOKEN_PROGRAM_ID.toBuffer());
  hasher.update(bytes32(source.vaultAuthority, "VaultAuthority"));
  return hasher.digest();
}

export function computeOrcaWhirlpoolSourceAccountsHash(
  input: OrcaWhirlpoolSourceAccountsHashInput,
): Buffer {
  const source = input.sourceConfig;
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("MIMIR_ACCOUNTS_ORCA_WHIRLPOOL_V1", "ascii"));
  hasher.update(bytes32(source.feedId, "FeedId"));
  hasher.update(oneByte(source.sourceIndex, "SourceIndex"));
  hasher.update(oneByte(source.adapterType, "AdapterType"));
  hasher.update(oneByte(source.direction, "Direction"));
  hasher.update(u16le(source.adapterVersion, "AdapterVersion"));
  hasher.update(bytes32(input.sourceConfigAddress, "SourceConfigAddress"));
  hasher.update(bytes32(source.programId, "ProgramId"));
  hasher.update(bytes32(input.poolOrMarket ?? source.poolOrMarket, "PoolOrMarket"));
  hasher.update(bytes32(input.whirlpoolsConfig, "WhirlpoolsConfig"));
  hasher.update(bytes32(input.baseVault ?? source.baseVault, "BaseVault"));
  hasher.update(bytes32(input.quoteVault ?? source.quoteVault, "QuoteVault"));
  hasher.update(bytes32(source.baseMint, "BaseMint"));
  hasher.update(bytes32(source.quoteMint, "QuoteMint"));
  hasher.update(bytes32(source.tokenProgram, "TokenProgram"));
  hasher.update(bytes32(source.vaultAuthority, "VaultAuthority"));
  return hasher.digest();
}

export function computeOrcaWhirlpoolRouteableSourceAccountsHash(
  input: OrcaWhirlpoolRouteableSourceAccountsHashInput,
): Buffer {
  const source = input.sourceConfig;
  const hasher = createHash("sha256");
  hasher.update(
    Buffer.from("MIMIR_ACCOUNTS_ORCA_WHIRLPOOL_ROUTEABLE_V1", "ascii"),
  );
  hasher.update(bytes32(source.feedId, "FeedId"));
  hasher.update(oneByte(source.sourceIndex, "SourceIndex"));
  hasher.update(oneByte(source.adapterType, "AdapterType"));
  hasher.update(oneByte(source.direction, "Direction"));
  hasher.update(u16le(source.adapterVersion, "AdapterVersion"));
  hasher.update(bytes32(input.sourceConfigAddress, "SourceConfigAddress"));
  hasher.update(bytes32(source.programId, "ProgramId"));
  hasher.update(bytes32(input.poolOrMarket ?? source.poolOrMarket, "PoolOrMarket"));
  hasher.update(bytes32(input.whirlpoolsConfig, "WhirlpoolsConfig"));
  hasher.update(bytes32(input.lowerTickArray, "LowerTickArray"));
  hasher.update(bytes32(input.activeTickArray, "ActiveTickArray"));
  hasher.update(bytes32(input.upperTickArray, "UpperTickArray"));
  hasher.update(bytes32(input.baseVault ?? source.baseVault, "BaseVault"));
  hasher.update(bytes32(input.quoteVault ?? source.quoteVault, "QuoteVault"));
  hasher.update(bytes32(source.baseMint, "BaseMint"));
  hasher.update(bytes32(source.quoteMint, "QuoteMint"));
  hasher.update(bytes32(source.tokenProgram, "TokenProgram"));
  hasher.update(bytes32(source.vaultAuthority, "VaultAuthority"));
  return hasher.digest();
}

export function computeMeteoraDlmmSourceAccountsHash(
  input: MeteoraDlmmSourceAccountsHashInput,
): Buffer {
  const source = input.sourceConfig;
  const token2022Mint = meteoraDlmmToken2022Mint(input);
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("MIMIR_ACCOUNTS_METEORA_DLMM_V1", "ascii"));
  hasher.update(bytes32(source.feedId, "FeedId"));
  hasher.update(oneByte(source.sourceIndex, "SourceIndex"));
  hasher.update(oneByte(source.adapterType, "AdapterType"));
  hasher.update(oneByte(source.direction, "Direction"));
  hasher.update(u16le(source.adapterVersion, "AdapterVersion"));
  hasher.update(bytes32(input.sourceConfigAddress, "SourceConfigAddress"));
  hasher.update(bytes32(source.programId, "ProgramId"));
  hasher.update(bytes32(input.poolOrMarket ?? source.poolOrMarket, "LbPair"));
  if (token2022Mint !== null) hasher.update(token2022Mint);
  hasher.update(bytes32(input.activeBinArray, "ActiveBinArray"));
  hasher.update(bytes32(input.baseVault ?? source.baseVault, "BaseVault"));
  hasher.update(bytes32(input.quoteVault ?? source.quoteVault, "QuoteVault"));
  hasher.update(bytes32(source.baseMint, "BaseMint"));
  hasher.update(bytes32(source.quoteMint, "QuoteMint"));
  hasher.update(bytes32(source.tokenProgram, "TokenProgram"));
  hasher.update(bytes32(source.vaultAuthority, "VaultAuthority"));
  return hasher.digest();
}

export function computeMeteoraDlmmRouteableSourceAccountsHash(
  input: MeteoraDlmmRouteableSourceAccountsHashInput,
): Buffer {
  const source = input.sourceConfig;
  const token2022Mint = meteoraDlmmToken2022Mint(input);
  const hasher = createHash("sha256");
  hasher.update(
    Buffer.from("MIMIR_ACCOUNTS_METEORA_DLMM_ROUTEABLE_V1", "ascii"),
  );
  hasher.update(bytes32(source.feedId, "FeedId"));
  hasher.update(oneByte(source.sourceIndex, "SourceIndex"));
  hasher.update(oneByte(source.adapterType, "AdapterType"));
  hasher.update(oneByte(source.direction, "Direction"));
  hasher.update(u16le(source.adapterVersion, "AdapterVersion"));
  hasher.update(bytes32(input.sourceConfigAddress, "SourceConfigAddress"));
  hasher.update(bytes32(source.programId, "ProgramId"));
  hasher.update(bytes32(input.poolOrMarket ?? source.poolOrMarket, "LbPair"));
  if (token2022Mint !== null) hasher.update(token2022Mint);
  hasher.update(bytes32(input.lowerBinArray, "LowerBinArray"));
  hasher.update(bytes32(input.activeBinArray, "ActiveBinArray"));
  hasher.update(bytes32(input.upperBinArray, "UpperBinArray"));
  hasher.update(bytes32(input.baseVault ?? source.baseVault, "BaseVault"));
  hasher.update(bytes32(input.quoteVault ?? source.quoteVault, "QuoteVault"));
  hasher.update(bytes32(source.baseMint, "BaseMint"));
  hasher.update(bytes32(source.quoteMint, "QuoteMint"));
  hasher.update(bytes32(source.tokenProgram, "TokenProgram"));
  hasher.update(bytes32(source.vaultAuthority, "VaultAuthority"));
  return hasher.digest();
}

function meteoraDlmmToken2022Mint(input: MeteoraDlmmSourceAccountsHashInput): Buffer | null {
  const source = input.sourceConfig;
  if (!sourceAdapterSupportsVersion(source.adapterType, source.adapterVersion) || source.adapterType !== SourceAdapterType.MeteoraDlmm) {
    throw new Error("UnsupportedMeteoraDlmmAdapterVersion");
  }
  if (source.adapterVersion === VERSION_V0) {
    if (input.token2022Mint !== undefined) throw new Error("UnexpectedToken2022Mint");
    return null;
  }
  if (input.token2022Mint === undefined) throw new Error("MissingToken2022Mint");
  const mint = bytes32(input.token2022Mint, "Token2022Mint");
  const base = bytes32(source.baseMint, "BaseMint"), quote = bytes32(source.quoteMint, "QuoteMint");
  if (base.equals(mint) === quote.equals(mint) || !bytes32(source.tokenProgram, "TokenProgram").equals(SPL_TOKEN_2022_PROGRAM_ID.toBuffer())) {
    throw new Error("InvalidToken2022Mint");
  }
  return mint;
}

export function computeMeteoraDammV2SourceAccountsHash(
  input: MeteoraDammV2SourceAccountsHashInput,
): Buffer {
  const source = input.sourceConfig;
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("MIMIR_ACCOUNTS_METEORA_DAMM_V2_V1", "ascii"));
  hasher.update(bytes32(source.feedId, "FeedId"));
  hasher.update(oneByte(source.sourceIndex, "SourceIndex"));
  hasher.update(oneByte(source.adapterType, "AdapterType"));
  hasher.update(oneByte(source.direction, "Direction"));
  hasher.update(u16le(source.adapterVersion, "AdapterVersion"));
  hasher.update(bytes32(input.sourceConfigAddress, "SourceConfigAddress"));
  hasher.update(bytes32(source.programId, "ProgramId"));
  hasher.update(bytes32(input.poolOrMarket ?? source.poolOrMarket, "Pool"));
  hasher.update(bytes32(input.baseVault ?? source.baseVault, "BaseVault"));
  hasher.update(bytes32(input.quoteVault ?? source.quoteVault, "QuoteVault"));
  hasher.update(bytes32(source.baseMint, "BaseMint"));
  hasher.update(bytes32(source.quoteMint, "QuoteMint"));
  hasher.update(bytes32(source.tokenProgram, "TokenProgram"));
  hasher.update(bytes32(source.vaultAuthority, "VaultAuthority"));
  return hasher.digest();
}

export function computeRaydiumClmmSourceAccountsHash(
  input: CpmmSourceAccountsHashInput,
): Buffer {
  const source = input.sourceConfig;
  if (source.adapterVersion !== VERSION_V0) {
    throw new Error("RaydiumClmmV1RequiresRouteableAccounts");
  }
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("MIMIR_ACCOUNTS_RAYDIUM_CLMM_V1", "ascii"));
  hasher.update(bytes32(source.feedId, "FeedId"));
  hasher.update(oneByte(source.sourceIndex, "SourceIndex"));
  hasher.update(oneByte(source.adapterType, "AdapterType"));
  hasher.update(oneByte(source.direction, "Direction"));
  hasher.update(u16le(source.adapterVersion, "AdapterVersion"));
  hasher.update(bytes32(input.sourceConfigAddress, "SourceConfigAddress"));
  hasher.update(bytes32(source.programId, "ProgramId"));
  hasher.update(bytes32(input.poolOrMarket ?? source.poolOrMarket, "PoolOrMarket"));
  hasher.update(bytes32(input.baseVault ?? source.baseVault, "BaseVault"));
  hasher.update(bytes32(input.quoteVault ?? source.quoteVault, "QuoteVault"));
  hasher.update(bytes32(source.baseMint, "BaseMint"));
  hasher.update(bytes32(source.quoteMint, "QuoteMint"));
  hasher.update(bytes32(source.tokenProgram, "TokenProgram"));
  hasher.update(bytes32(source.vaultAuthority, "VaultAuthority"));
  return hasher.digest();
}

export function computeRaydiumClmmRouteableSourceAccountsHash(
  input: RaydiumClmmRouteableSourceAccountsHashInput,
): Buffer {
  const source = input.sourceConfig;
  if (!sourceAdapterSupportsVersion(source.adapterType, source.adapterVersion)) {
    throw new Error("UnsupportedSourceAdapterVersion");
  }
  let token2022Mint: Buffer | null = null;
  if (source.adapterVersion === VERSION_V0) {
    if (input.token2022Mint !== undefined) {
      throw new Error("UnexpectedToken2022Mint");
    }
  } else if (source.adapterVersion === VERSION_V1) {
    if (input.token2022Mint === undefined) {
      throw new Error("MissingToken2022Mint");
    }
    token2022Mint = bytes32(input.token2022Mint, "Token2022Mint");
    const baseMint = bytes32(source.baseMint, "BaseMint");
    const quoteMint = bytes32(source.quoteMint, "QuoteMint");
    const baseMatches = baseMint.equals(token2022Mint);
    const quoteMatches = quoteMint.equals(token2022Mint);
    if (baseMatches === quoteMatches) {
      throw new Error("InvalidToken2022Mint");
    }
    if (!bytes32(source.tokenProgram, "TokenProgram").equals(SPL_TOKEN_2022_PROGRAM_ID.toBuffer())) {
      throw new Error("InvalidToken2022Program");
    }
  }
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("MIMIR_ACCOUNTS_RAYDIUM_CLMM_ROUTEABLE_V1", "ascii"));
  hasher.update(bytes32(source.feedId, "FeedId"));
  hasher.update(oneByte(source.sourceIndex, "SourceIndex"));
  hasher.update(oneByte(source.adapterType, "AdapterType"));
  hasher.update(oneByte(source.direction, "Direction"));
  hasher.update(u16le(source.adapterVersion, "AdapterVersion"));
  hasher.update(bytes32(input.sourceConfigAddress, "SourceConfigAddress"));
  hasher.update(bytes32(source.programId, "ProgramId"));
  hasher.update(bytes32(input.poolOrMarket ?? source.poolOrMarket, "PoolOrMarket"));
  if (token2022Mint !== null) hasher.update(token2022Mint);
  hasher.update(bytes32(input.lowerTickArray, "LowerTickArray"));
  hasher.update(bytes32(input.activeTickArray, "ActiveTickArray"));
  hasher.update(bytes32(input.upperTickArray, "UpperTickArray"));
  hasher.update(bytes32(input.baseVault ?? source.baseVault, "BaseVault"));
  hasher.update(bytes32(input.quoteVault ?? source.quoteVault, "QuoteVault"));
  hasher.update(bytes32(source.baseMint, "BaseMint"));
  hasher.update(bytes32(source.quoteMint, "QuoteMint"));
  hasher.update(bytes32(source.tokenProgram, "TokenProgram"));
  hasher.update(bytes32(source.vaultAuthority, "VaultAuthority"));
  return hasher.digest();
}

export function computeSingleExecutableSourceAccountsHash(
  input: SourceAccountsHashInput,
): Buffer {
  const adapterType = input.sourceConfig.adapterType;
  if (adapterType === SourceAdapterType.OrcaWhirlpool) {
    if (!("whirlpoolsConfig" in input)) {
      throw new Error("MissingOrcaWhirlpoolAccountsHashInput");
    }
    return computeOrcaWhirlpoolSourceAccountsHash(input);
  }
  if (adapterType === SourceAdapterType.MeteoraDlmm) {
    if (!("activeBinArray" in input)) {
      throw new Error("MissingMeteoraDlmmAccountsHashInput");
    }
    return computeMeteoraDlmmSourceAccountsHash(input);
  }
  if (adapterType === SourceAdapterType.MeteoraDammV2) {
    return computeMeteoraDammV2SourceAccountsHash(
      input as MeteoraDammV2SourceAccountsHashInput,
    );
  }
  if (adapterType === SourceAdapterType.RaydiumClmm) {
    return "lowerTickArray" in input &&
      "activeTickArray" in input &&
      "upperTickArray" in input
      ? computeRaydiumClmmRouteableSourceAccountsHash(input)
      : computeRaydiumClmmSourceAccountsHash(
          input as RaydiumClmmSourceAccountsHashInput,
        );
  }
  if (adapterType === SourceAdapterType.RaydiumCpmm) {
    return computeCpmmSourceAccountsHash(input as CpmmSourceAccountsHashInput);
  }
  throw new Error("UnsupportedExecutableSourceAccountsHashInput");
}

export function computeRetainedRingSourcesAccountsHash(
  inputs: readonly SourceAccountsHashInput[],
): Buffer {
  if (inputs.length < 2 || inputs.length > 8) {
    throw new Error("InvalidRetainedRingSourceCount");
  }
  const sorted = [...inputs].sort(
    (a, b) => a.sourceConfig.sourceIndex - b.sourceConfig.sourceIndex,
  );
  const feedId = bytes32(sorted[0]!.sourceConfig.feedId, "FeedId");
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("MIMIR_ACCOUNTS_RETAINED_RINGS_V1", "ascii"));
  hasher.update(feedId);
  hasher.update(oneByte(sorted.length, "SourceCount"));
  let previous = -1;
  for (const input of sorted) {
    const source = input.sourceConfig;
    if (source.sourceIndex <= previous) {
      throw new Error("InvalidRetainedRingSourceOrder");
    }
    if (!bytes32(source.feedId, "FeedId").equals(feedId)) {
      throw new Error("MismatchedRetainedRingFeedId");
    }
    hasher.update(oneByte(source.sourceIndex, "SourceIndex"));
    hasher.update(oneByte(source.adapterType, "AdapterType"));
    hasher.update(computeSingleExecutableSourceAccountsHash(input));
    previous = source.sourceIndex;
  }
  return hasher.digest();
}
