import { address, type Address } from "@solana/kit";
import { addressBytes, canonicalJson, domainHash } from "./beta/bytes.js";
import { MIMIR_COND, MIMIR_POWER } from "./liveness.js";

const SPL_TOKEN_PROGRAM_ID = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const SPL_NATIVE_MINT = address("So11111111111111111111111111111111111111112");

const MINT_BASE_LEN = 82;
const TOKEN_ACCOUNT_BASE_LEN = 165;
const MAX_MINT_LEN = 1024;
const MAX_TOKEN_ACCOUNT_LEN = 512;
const MAX_MINT_EXTENSIONS = 16;
const MAX_TOKEN_ACCOUNT_EXTENSIONS = 8;

const EXT_CONFIDENTIAL_TRANSFER_MINT = 4;
const EXT_CONFIDENTIAL_TRANSFER_ACCOUNT = 5;
const EXT_DEFAULT_ACCOUNT_STATE = 6;
const EXT_IMMUTABLE_OWNER = 7;
const EXT_TRANSFER_FEE_AMOUNT = 2;
const EXT_PERMANENT_DELEGATE = 12;
const EXT_TRANSFER_HOOK = 14;
const EXT_TRANSFER_HOOK_ACCOUNT = 15;
const EXT_METADATA_POINTER = 18;
const EXT_TOKEN_METADATA = 19;
const EXT_SCALED_UI_AMOUNT = 25;
const EXT_PAUSABLE_CONFIG = 26;
const EXT_PAUSABLE_ACCOUNT = 27;

const U52_MASK = (1n << 52n) - 1n;

export interface Token2022ClmmAccount {
  readonly address: Address;
  readonly owner: Address;
  readonly executable?: boolean;
  readonly data: Uint8Array;
}

export class Token2022ClmmPolicyError extends Error {
  readonly code: "TOKEN_2022_POLICY_UNSUPPORTED" | "TOKEN_PROGRAM_PAIR_UNSUPPORTED";

  constructor(message: string, code: "TOKEN_2022_POLICY_UNSUPPORTED" | "TOKEN_PROGRAM_PAIR_UNSUPPORTED" = "TOKEN_2022_POLICY_UNSUPPORTED") {
    super(message);
    this.name = "Token2022ClmmPolicyError";
    this.code = code;
  }
}

export class Token2022ClmmAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Token2022ClmmAccountError";
  }
}

export function isToken2022ClmmPolicyError(value: unknown): value is Token2022ClmmPolicyError {
  return value instanceof Token2022ClmmPolicyError;
}

export function isToken2022ClmmAccountError(value: unknown): value is Token2022ClmmAccountError {
  return value instanceof Token2022ClmmAccountError;
}

export interface Token2022ClmmPairClassification {
  readonly adapterVersion: 0 | 1;
  readonly tokenProgramId: Address;
  readonly token2022Mint: Address | null;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
  readonly baseAmount: bigint;
  readonly quoteAmount: bigint;
  readonly conditions: number;
  readonly mask: number;
}

function reject(message: string, code: "TOKEN_2022_POLICY_UNSUPPORTED" | "TOKEN_PROGRAM_PAIR_UNSUPPORTED" = "TOKEN_2022_POLICY_UNSUPPORTED"): never {
  throw new Token2022ClmmPolicyError(message, code);
}

function malformed(message: string): never {
  throw new Token2022ClmmAccountError(message);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function allZero(value: Uint8Array): boolean {
  return value.every((byte) => byte === 0);
}

function canonical(value: Address): Address {
  try {
    return address(value);
  } catch {
    return reject("non-canonical account address");
  }
}

function ensureAccount(account: Token2022ClmmAccount, expected: Address, owner: Address, lengths: readonly number[], label: string,
  malformed: (message: string) => never = reject): Uint8Array {
  if (canonical(account.address) !== canonical(expected) || canonical(account.owner) !== owner || account.executable === true || !lengths.includes(account.data.length)) {
    malformed(`${label} envelope is invalid`);
  }
  return account.data;
}

function u16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) reject("extension header is truncated");
  return data[offset]! | (data[offset + 1]! << 8);
}

function u32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) reject("metadata field is truncated");
  return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0;
}

function i64(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.length) reject("scaled amount timestamp is truncated");
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(data[offset + index]!);
  return BigInt.asIntN(64, value);
}

function u64(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.length) reject("token amount is truncated");
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(data[offset + index]!);
  return value;
}

function key(data: Uint8Array, offset: number): Uint8Array {
  if (offset < 0 || offset + 32 > data.length) reject("account key is truncated");
  return data.slice(offset, offset + 32);
}

interface ExtensionRows {
  readonly rows: ReadonlyMap<number, Uint8Array>;
}

function parseExtensions(data: Uint8Array, baseLength: number, maxLength: number, maxCount: number, accountType: number, label: string): ExtensionRows {
  if (data.length === baseLength) return { rows: new Map() };
  if (data.length < 166 || data.length > maxLength || data.slice(baseLength, 165).some((byte) => byte !== 0) || data[165] !== accountType) {
    reject(`${label} extension envelope is invalid`);
  }
  const rows = new Map<number, Uint8Array>();
  let offset = 166;
  while (offset < data.length) {
    if (offset + 4 > data.length) reject(`${label} extension header is truncated`);
    const type = u16(data, offset);
    const length = u16(data, offset + 2);
    offset += 4;
    if (offset + length > data.length || rows.has(type)) reject(`${label} extension table is malformed`);
    rows.set(type, data.slice(offset, offset + length));
    offset += length;
    if (rows.size > maxCount) reject(`${label} has too many extensions`);
  }
  if (offset !== data.length) reject(`${label} extension table has trailing bytes`);
  return { rows };
}

function validateFiniteScaledQ64(bits: bigint): bigint {
  const magnitude = bits & ((1n << 63n) - 1n);
  if ((bits >> 63n) !== 0n || magnitude < (991n << 52n) || magnitude > (1055n << 52n)) {
    reject("scaled UI amount multiplier is outside policy bounds");
  }
  const exponent = Number((magnitude >> 52n) & 0x7ffn);
  const fraction = magnitude & U52_MASK;
  if (exponent === 0 || exponent === 0x7ff) reject("scaled UI amount multiplier is not normalized");
  const significand = (1n << 52n) | fraction;
  const shift = exponent - 1023 - 52 + 64;
  let q64: bigint;
  if (shift >= 0) q64 = significand << BigInt(shift);
  else {
    const divisor = 1n << BigInt(-shift);
    const quotient = significand / divisor;
    const remainder = significand % divisor;
    const half = divisor >> 1n;
    q64 = quotient + (remainder > half || (remainder === half && (quotient & 1n) !== 0n) ? 1n : 0n);
  }
  if (q64 < (1n << 32n) || q64 > (1n << 96n)) reject("scaled UI amount multiplier is outside Q64 bounds");
  return q64;
}

function validateTokenMetadata(value: Uint8Array, expectedMint: Address): void {
  if (value.length < 64 || !sameBytes(value.slice(32, 64), addressBytes(expectedMint))) reject("token metadata mint mismatch");
  let offset = 64;
  const readString = (): void => {
    const length = u32(value, offset);
    offset += 4;
    if (offset + length > value.length) reject("token metadata string is truncated");
    offset += length;
  };
  readString();
  readString();
  readString();
  const count = u32(value, offset);
  offset += 4;
  for (let index = 0; index < count; index += 1) {
    readString();
    readString();
  }
  if (offset !== value.length) reject("token metadata has trailing bytes");
}

function validateMintExtensions(rows: ReadonlyMap<number, Uint8Array>, expectedMint: Address): Readonly<{ pausable: boolean; transferHookDisabled: boolean }> {
  let metadataPointer = false;
  let metadata = false;
  let pausable = false;
  let transferHookDisabled = false;
  for (const [type, value] of rows) {
    switch (type) {
      case EXT_METADATA_POINTER:
        if (value.length !== 64 || (!allZero(value.slice(32, 64)) && !sameBytes(value.slice(32, 64), addressBytes(expectedMint)))) reject("metadata pointer is invalid");
        metadataPointer = true;
        break;
      case EXT_PERMANENT_DELEGATE:
        if (value.length !== 32) reject("permanent delegate extension is invalid");
        break;
      case EXT_DEFAULT_ACCOUNT_STATE:
        if (value.length !== 1 || value[0] !== 1) reject("default account state is not initialized");
        break;
      case EXT_SCALED_UI_AMOUNT:
        if (value.length !== 56 || i64(value, 40) < 0n) reject("scaled UI amount extension is invalid");
        validateFiniteScaledQ64(u64(value, 32));
        validateFiniteScaledQ64(u64(value, 48));
        break;
      case EXT_PAUSABLE_CONFIG:
        if (value.length !== 33 || value[32] !== 0) reject("pausable config extension is invalid");
        pausable = true;
        break;
      case EXT_CONFIDENTIAL_TRANSFER_MINT:
        if (value.length !== 65) reject("confidential transfer mint extension is invalid");
        break;
      case EXT_TRANSFER_HOOK:
        if (value.length !== 64 || !allZero(value.slice(32, 64))) reject("transfer hook must be disabled");
        transferHookDisabled = true;
        break;
      case EXT_TOKEN_METADATA:
        validateTokenMetadata(value, expectedMint);
        metadata = true;
        break;
      default:
        reject(`unsupported Token-2022 mint extension ${type}`);
    }
  }
  if (metadata && (!metadataPointer || !rows.get(EXT_METADATA_POINTER) || !sameBytes(rows.get(EXT_METADATA_POINTER)!.slice(32, 64), addressBytes(expectedMint)))) {
    reject("token metadata requires an exact metadata pointer");
  }
  return { pausable, transferHookDisabled };
}

function validateVaultExtensions(rows: ReadonlyMap<number, Uint8Array>, mintPolicy: Readonly<{ pausable: boolean; transferHookDisabled: boolean }>): void {
  let pausable = false;
  let transferHook = false;
  for (const [type, value] of rows) {
    switch (type) {
      case EXT_IMMUTABLE_OWNER:
        if (value.length !== 0) reject("immutable owner extension is invalid");
        break;
      case EXT_PAUSABLE_ACCOUNT:
        if (value.length !== 0 || !mintPolicy.pausable) reject("pausable account extension is invalid");
        pausable = true;
        break;
      case EXT_TRANSFER_HOOK_ACCOUNT:
        if (value.length !== 1 || value[0] !== 0 || !mintPolicy.transferHookDisabled) reject("transfer hook account extension is invalid");
        transferHook = true;
        break;
      case EXT_CONFIDENTIAL_TRANSFER_ACCOUNT:
      case EXT_TRANSFER_FEE_AMOUNT:
      default:
        reject(`unsupported Token-2022 vault extension ${type}`);
    }
  }
  if (mintPolicy.pausable !== pausable || mintPolicy.transferHookDisabled !== transferHook) reject("vault extensions do not match mint policy");
}

function parseClassicMint(account: Token2022ClmmAccount, expectedMint: Address, expectedDecimals: number): number {
  const data = ensureAccount(account, expectedMint, SPL_TOKEN_PROGRAM_ID, [MINT_BASE_LEN], "classic mint", malformed);
  if (data[45] !== 1 || data[44] !== expectedDecimals || expectedDecimals > 18) malformed("classic mint policy is invalid");
  return data[44]!;
}

export function parseToken2022ClmmMint(args: { readonly account: Token2022ClmmAccount; readonly expectedMint: Address; readonly expectedDecimals: number }): { readonly decimals: number; readonly policy: Readonly<{ pausable: boolean; transferHookDisabled: boolean }> } {
  const data = ensureAccount(args.account, args.expectedMint, TOKEN_2022_PROGRAM_ID, [MINT_BASE_LEN, ...Array.from({ length: MAX_MINT_LEN - 165 }, (_, index) => 166 + index)], "Token-2022 mint", malformed);
  if (data[45] !== 1 || data[44] !== args.expectedDecimals || args.expectedDecimals > 18) reject("Token-2022 mint policy is invalid");
  const { rows } = parseExtensions(data, MINT_BASE_LEN, MAX_MINT_LEN, MAX_MINT_EXTENSIONS, 1, "mint");
  return { decimals: data[44]!, policy: validateMintExtensions(rows, args.expectedMint) };
}

export function parseToken2022PumpSwapMetadataMint(args: { readonly account: Token2022ClmmAccount; readonly expectedMint: Address; readonly expectedDecimals: number }): { readonly decimals: number } {
  const data = ensureAccount(args.account, args.expectedMint, TOKEN_2022_PROGRAM_ID,
    [MINT_BASE_LEN, ...Array.from({ length: MAX_MINT_LEN - 165 }, (_, index) => 166 + index)], "Token-2022 mint", malformed);
  if (data[45] !== 1 || data[44] !== args.expectedDecimals || args.expectedDecimals > 18) reject("Token-2022 mint policy is invalid");
  const { rows } = parseExtensions(data, MINT_BASE_LEN, MAX_MINT_LEN, MAX_MINT_EXTENSIONS, 1, "mint");
  if (rows.size !== 2 || !rows.has(EXT_METADATA_POINTER) || !rows.has(EXT_TOKEN_METADATA)) {
    reject("PumpSwap Token-2022 mint must contain only metadata extensions");
  }
  validateMintExtensions(rows, args.expectedMint);
  return { decimals: data[44]! };
}

export function parseToken2022ClmmVault(args: { readonly account: Token2022ClmmAccount; readonly expectedVault: Address; readonly expectedMint: Address; readonly expectedAuthority: Address; readonly mintPolicy: Readonly<{ pausable: boolean; transferHookDisabled: boolean }> }): { readonly amount: bigint } {
  const data = ensureAccount(args.account, args.expectedVault, TOKEN_2022_PROGRAM_ID, [TOKEN_ACCOUNT_BASE_LEN, ...Array.from({ length: MAX_TOKEN_ACCOUNT_LEN - 165 }, (_, index) => 166 + index)], "Token-2022 vault", malformed);
  if (!sameBytes(key(data, 0), addressBytes(args.expectedMint)) || !sameBytes(key(data, 32), addressBytes(args.expectedAuthority)) || u32(data, 72) !== 0 || data[108] !== 1 || u32(data, 109) !== 0 || u64(data, 121) !== 0n || u32(data, 129) !== 0) reject("Token-2022 vault policy is invalid");
  const amount = u64(data, 64);
  if (amount === 0n) reject("zero Token-2022 vault reserve");
  const { rows } = parseExtensions(data, TOKEN_ACCOUNT_BASE_LEN, MAX_TOKEN_ACCOUNT_LEN, MAX_TOKEN_ACCOUNT_EXTENSIONS, 2, "vault");
  validateVaultExtensions(rows, args.mintPolicy);
  return { amount };
}

export function parseToken2022PumpSwapVault(args: { readonly account: Token2022ClmmAccount; readonly expectedVault: Address; readonly expectedMint: Address; readonly expectedAuthority: Address }): { readonly amount: bigint } {
  if (args.account.data.length !== TOKEN_ACCOUNT_BASE_LEN && args.account.data.length !== TOKEN_ACCOUNT_BASE_LEN + 5) {
    malformed("PumpSwap Token-2022 vault allocation is invalid");
  }
  return parseToken2022ClmmVault({ ...args, mintPolicy: { pausable: false, transferHookDisabled: false } });
}

export function classifyToken2022ClmmPair(args: {
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly baseMintAccount: Token2022ClmmAccount;
  readonly quoteMintAccount: Token2022ClmmAccount;
  readonly baseVaultAccount: Token2022ClmmAccount;
  readonly quoteVaultAccount: Token2022ClmmAccount;
  readonly authority: Address;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
  readonly nowUnix?: bigint;
}): Token2022ClmmPairClassification {
  const baseMintOwner = canonical(args.baseMintAccount.owner);
  const quoteMintOwner = canonical(args.quoteMintAccount.owner);
  const baseClassic = baseMintOwner === SPL_TOKEN_PROGRAM_ID;
  const quoteClassic = quoteMintOwner === SPL_TOKEN_PROGRAM_ID;
  const baseToken2022 = baseMintOwner === TOKEN_2022_PROGRAM_ID;
  const quoteToken2022 = quoteMintOwner === TOKEN_2022_PROGRAM_ID;
  if ((!baseClassic && !baseToken2022) || (!quoteClassic && !quoteToken2022) || (baseToken2022 && quoteToken2022)) reject("CLMM token-program pair is unsupported", "TOKEN_PROGRAM_PAIR_UNSUPPORTED");
  const nowUnix = args.nowUnix ?? BigInt(Math.floor(Date.now() / 1000));
  let conditions = 0;
  let mask = 0;
  const side = (mint: Address, mintAccount: Token2022ClmmAccount, vaultAccount: Token2022ClmmAccount, decimals: number) => {
    if (mintAccount === (baseToken2022 ? args.baseMintAccount : quoteToken2022 ? args.quoteMintAccount : null)) {
      const parsed = classifyToken2022Mint({ account: mintAccount, expectedMint: mint, expectedDecimals: decimals, nowUnix });
      const vault = classifyToken2022Vault({ account: vaultAccount, expectedVault: vaultAccount.address, expectedMint: mint, expectedAuthority: args.authority, mintPolicy: parsed.policy });
      conditions |= parsed.conditions | vault.conditions;
      mask |= parsed.mask;
      return { decimals: parsed.decimals, amount: vault.amount };
    }
    const parsedDecimals = parseClassicMint(mintAccount, mint, decimals);
    const vault = classifyClassicVault({ account: vaultAccount, expectedVault: vaultAccount.address, expectedMint: mint, expectedAuthority: args.authority });
    conditions |= vault.conditions;
    return { decimals: parsedDecimals, amount: vault.amount };
  };
  const base = side(args.baseMint, args.baseMintAccount, args.baseVaultAccount, args.baseDecimals);
  const quote = side(args.quoteMint, args.quoteMintAccount, args.quoteVaultAccount, args.quoteDecimals);
  const token2022 = baseToken2022 || quoteToken2022;
  return {
    adapterVersion: token2022 ? 1 : 0,
    tokenProgramId: token2022 ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID,
    token2022Mint: baseToken2022 ? args.baseMint : quoteToken2022 ? args.quoteMint : null,
    baseDecimals: base.decimals,
    quoteDecimals: quote.decimals,
    baseAmount: base.amount,
    quoteAmount: quote.amount,
    conditions,
    mask,
  };
}

export async function computeToken2022ClmmPolicyHash(args: {
  readonly mint: Token2022ClmmAccount;
  readonly vault: Token2022ClmmAccount;
}): Promise<string> {
  const mint = args.mint.data;
  const vault = args.vault.data;
  return domainHash("MIMIR_TOKEN2022_CLMM_POLICY_V1\0", canonicalJson({
    mint: {
      address: canonical(args.mint.address), owner: canonical(args.mint.owner), dataLength: mint.length,
      initializedDecimals: mint.slice(44, 46), extensionEnvelope: mint.slice(82),
    },
    vault: {
      address: canonical(args.vault.address), owner: canonical(args.vault.owner), dataLength: vault.length,
      mint: vault.slice(0, 32), authority: vault.slice(32, 64), delegateTag: vault.slice(72, 76),
      state: vault.slice(108, 109), nativeTag: vault.slice(109, 113), delegatedAmount: vault.slice(121, 129),
      closeAuthorityTag: vault.slice(129, 133), extensionEnvelope: vault.slice(165),
    },
  }));
}

export interface Token2022MintClass {
  readonly decimals: number;
  readonly conditions: number;
  readonly mask: number;
  readonly policy: Readonly<{ pausable: boolean; transferHook: boolean }>;
  /** Scaled-UI multiplier selected at `nowUnix` (Q64; 1.0 without the extension). */
  readonly multiplierQ64?: bigint;
}

export interface MimirVaultClass {
  readonly amount: bigint;
  readonly conditions: number;
}

function classifyMultiplierBits(bits: bigint): bigint | null {
  const exponent = Number((bits >> 52n) & 0x7ffn);
  if ((bits >> 63n) !== 0n || exponent === 0 || exponent === 0x7ff) reject("scaled UI amount multiplier is not normalized");
  if (bits < (991n << 52n) || bits > (1055n << 52n)) return null;
  return validateFiniteScaledQ64(bits);
}

function metadataWellFormed(value: Uint8Array): boolean {
  try {
    let offset = 0;
    const skip = (): void => {
      const length = u32(value, offset);
      offset += 4;
      if (offset + length > value.length) reject("token metadata string is truncated");
      offset += length;
    };
    skip(); skip(); skip();
    const count = u32(value, offset);
    offset += 4;
    for (let index = 0; index < count; index += 1) { skip(); skip(); }
    return offset === value.length;
  } catch {
    return false;
  }
}

function classifyTlv(data: Uint8Array, start: number, maxCount: number): Map<number, Uint8Array> {
  const rows = new Map<number, Uint8Array>();
  let offset = start;
  while (offset < data.length) {
    if (offset + 4 > data.length) reject("extension header is truncated");
    const type = data[offset]! | (data[offset + 1]! << 8);
    const length = data[offset + 2]! | (data[offset + 3]! << 8);
    offset += 4;
    if (offset + length > data.length || rows.has(type) || rows.size >= maxCount) reject("extension table is malformed");
    rows.set(type, data.slice(offset, offset + length));
    offset += length;
  }
  return rows;
}

export function classifyToken2022Mint(args: { readonly account: Token2022ClmmAccount; readonly expectedMint: Address; readonly expectedDecimals: number; readonly nowUnix: bigint }): Token2022MintClass {
  const data = args.account.data;
  if (canonical(args.account.address) !== canonical(args.expectedMint) || canonical(args.account.owner) !== TOKEN_2022_PROGRAM_ID ||
      args.account.executable === true || (data.length !== MINT_BASE_LEN && data.length < 166)) malformed("Token-2022 mint envelope is invalid");
  if (args.expectedDecimals > 18 || data[44] !== args.expectedDecimals || data[45] !== 1) reject("Token-2022 mint policy is invalid");
  const mint = addressBytes(args.expectedMint);
  let conditions = 0;
  let mask = (u32(data, 0) === 1 ? MIMIR_POWER.MINT_AUTHORITY : 0) | (u32(data, 46) === 1 ? MIMIR_POWER.FREEZE_AUTHORITY : 0);
  const oversize = data.length > MAX_MINT_LEN;
  if (oversize) conditions |= MIMIR_COND.TOKEN_PROFILE;
  if (data.length !== MINT_BASE_LEN && (data.slice(MINT_BASE_LEN, 165).some((byte) => byte !== 0) || data[165] !== 1)) reject("mint extension envelope is invalid");
  const rows = data.length === MINT_BASE_LEN ? new Map<number, Uint8Array>() : classifyTlv(data, 166, MAX_MINT_EXTENSIONS);
  let pointer: Uint8Array | null = null;
  let metadata = false;
  let pausable = false;
  let transferHook = false;
  let multiplierQ64 = 1n << 64n;
  for (const [type, p] of rows) {
    switch (type) {
      case EXT_METADATA_POINTER:
        if (p.length !== 64) reject("metadata pointer is invalid");
        pointer = p.slice(32, 64);
        if (!allZero(pointer) && !sameBytes(pointer, mint)) conditions |= MIMIR_COND.TOKEN_PROFILE;
        break;
      case EXT_PERMANENT_DELEGATE:
        if (p.length !== 32) reject("permanent delegate extension is invalid");
        mask |= MIMIR_POWER.PERMANENT_DELEGATE;
        break;
      case EXT_DEFAULT_ACCOUNT_STATE:
        if (p.length !== 1 || (p[0] !== 1 && p[0] !== 2)) reject("default account state is invalid");
        if (p[0] === 2) { conditions |= MIMIR_COND.TOKEN_PROFILE; mask |= MIMIR_POWER.DEFAULT_FROZEN; }
        break;
      case EXT_SCALED_UI_AMOUNT: {
        if (p.length !== 56 || i64(p, 40) < 0n) reject("scaled UI amount extension is invalid");
        const current = classifyMultiplierBits(u64(p, 32));
        const next = classifyMultiplierBits(u64(p, 48));
        const [selected, other] = args.nowUnix >= i64(p, 40) ? [next, current] : [current, next];
        if (selected === null) conditions |= MIMIR_COND.SCALE_UNREPRESENTABLE;
        else { multiplierQ64 = selected; if (other === null) conditions |= MIMIR_COND.TOKEN_PROFILE; }
        mask |= MIMIR_POWER.SCALED_UI;
        break;
      }
      case EXT_PAUSABLE_CONFIG:
        if (p.length !== 33 || (p[32] !== 0 && p[32] !== 1)) reject("pausable config extension is invalid");
        if (p[32] === 1) conditions |= MIMIR_COND.PAUSED;
        pausable = true;
        mask |= MIMIR_POWER.PAUSABLE;
        break;
      case EXT_CONFIDENTIAL_TRANSFER_MINT:
        if (p.length !== 65) reject("confidential transfer mint extension is invalid");
        mask |= MIMIR_POWER.CONFIDENTIAL_MINT;
        break;
      case EXT_TRANSFER_HOOK:
        if (p.length !== 64) reject("transfer hook extension is invalid");
        if (!allZero(p.slice(0, 32))) mask |= MIMIR_POWER.HOOK_AUTHORITY;
        if (!allZero(p.slice(32, 64))) conditions |= MIMIR_COND.HOOK_ACTIVE;
        transferHook = true;
        break;
      case EXT_TOKEN_METADATA:
        if (p.length < 64 || !sameBytes(p.slice(32, 64), mint) || (!oversize && !metadataWellFormed(p.slice(64)))) reject("token metadata is invalid");
        metadata = true;
        break;
      default:
        reject(`unsupported Token-2022 mint extension ${type}`);
    }
  }
  if (metadata) {
    if (pointer === null) reject("token metadata requires a metadata pointer");
    if (!sameBytes(pointer, mint)) conditions |= MIMIR_COND.TOKEN_PROFILE;
  }
  return { decimals: data[44]!, conditions, mask, policy: { pausable, transferHook }, multiplierQ64 };
}

export function classifyToken2022PumpSwapMetadataMint(args: { readonly account: Token2022ClmmAccount; readonly expectedMint: Address; readonly expectedDecimals: number; readonly nowUnix: bigint }): Token2022MintClass {
  const parsed = classifyToken2022Mint(args);
  const rows = args.account.data.length === MINT_BASE_LEN ? new Map<number, Uint8Array>() : classifyTlv(args.account.data, 166, MAX_MINT_EXTENSIONS);
  if (rows.size !== 2 || !rows.has(EXT_METADATA_POINTER) || !rows.has(EXT_TOKEN_METADATA)) reject("PumpSwap Token-2022 mint must contain only metadata extensions");
  return parsed;
}

export function classifyToken2022Vault(args: { readonly account: Token2022ClmmAccount; readonly expectedVault: Address; readonly expectedMint: Address; readonly expectedAuthority: Address; readonly mintPolicy: Readonly<{ pausable: boolean; transferHook: boolean }> }): MimirVaultClass {
  const data = ensureAccount(args.account, args.expectedVault, TOKEN_2022_PROGRAM_ID, [TOKEN_ACCOUNT_BASE_LEN, ...Array.from({ length: MAX_TOKEN_ACCOUNT_LEN - 165 }, (_, index) => 166 + index)], "Token-2022 vault", malformed);
  if (!sameBytes(key(data, 0), addressBytes(args.expectedMint)) || !sameBytes(key(data, 32), addressBytes(args.expectedAuthority)) || u32(data, 72) !== 0 ||
      u32(data, 109) !== 0 || u64(data, 121) !== 0n || u32(data, 129) !== 0 || (data[108] !== 1 && data[108] !== 2)) reject("Token-2022 vault policy is invalid");
  if (data.length !== TOKEN_ACCOUNT_BASE_LEN && data[165] !== 2) reject("vault extension envelope is invalid");
  const rows = data.length === TOKEN_ACCOUNT_BASE_LEN ? new Map<number, Uint8Array>() : classifyTlv(data, 166, MAX_TOKEN_ACCOUNT_EXTENSIONS);
  let pausable = false;
  let transferHook = false;
  for (const [type, p] of rows) {
    if (type === EXT_IMMUTABLE_OWNER && p.length === 0) continue;
    if (type === EXT_PAUSABLE_ACCOUNT && p.length === 0 && args.mintPolicy.pausable) pausable = true;
    else if (type === EXT_TRANSFER_HOOK_ACCOUNT && p.length === 1 && p[0] === 0 && args.mintPolicy.transferHook) transferHook = true;
    else reject(`unsupported Token-2022 vault extension ${type}`);
  }
  if ((args.mintPolicy.pausable && !pausable) || (args.mintPolicy.transferHook && !transferHook)) reject("vault extensions do not match mint policy");
  return { amount: u64(data, 64), conditions: data[108] === 2 ? MIMIR_COND.VAULT_FROZEN : 0 };
}

export function classifyClassicVault(args: { readonly account: Token2022ClmmAccount; readonly expectedVault: Address; readonly expectedMint: Address; readonly expectedAuthority: Address }): MimirVaultClass {
  const data = ensureAccount(args.account, args.expectedVault, SPL_TOKEN_PROGRAM_ID, [TOKEN_ACCOUNT_BASE_LEN], "classic vault", malformed);
  const nativeTag = u32(data, 109);
  if ((data[108] !== 1 && data[108] !== 2) || !sameBytes(key(data, 0), addressBytes(args.expectedMint)) || !sameBytes(key(data, 32), addressBytes(args.expectedAuthority)) ||
      u32(data, 72) !== 0 || (nativeTag !== 0 && !(nativeTag === 1 && canonical(args.expectedMint) === SPL_NATIVE_MINT)) || u64(data, 121) !== 0n || u32(data, 129) !== 0) {
    malformed("classic vault policy is invalid");
  }
  return { amount: u64(data, 64), conditions: data[108] === 2 ? MIMIR_COND.VAULT_FROZEN : 0 };
}

export function token2022EconomicPriceTyped(raw: bigint, quoteQ64: bigint, baseQ64: bigint): bigint | null {
  if (baseQ64 === 0n) reject("base multiplier is zero");
  const product = raw * quoteQ64;
  if (product >> 256n !== 0n) return null;
  let quotient = product / baseQ64;
  const remainder = product % baseQ64;
  const half = baseQ64 / 2n;
  if (remainder > half || (remainder === half && (baseQ64 & 1n) === 0n && (quotient & 1n) === 1n)) quotient += 1n;
  if (quotient >> 128n !== 0n || (raw !== 0n && quotient === 0n)) return null;
  return quotient;
}
