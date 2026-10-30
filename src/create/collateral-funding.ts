import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import type { MimirBetaInstruction } from '../beta/types.js';

const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const WSOL_MINT = address('So11111111111111111111111111111111111111112');
const JUPITER_PROGRAM = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const EVENT_AUTHORITY = address('D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf');
const ROUTE_V2 = Uint8Array.of(0xbb, 0x64, 0xfa, 0xcc, 0x31, 0xc4, 0xaf, 0x14);
const SHARED_ROUTE_V2 = Uint8Array.of(0xd1, 0x98, 0x53, 0x93, 0x7c, 0xfe, 0xd8, 0xe9);
const U64_MAX = (1n << 64n) - 1n;
const BPS = 10_000n;
const MAX_ACCOUNTS = 64;
const MAX_DATA_BYTES = 4096;

type RawAccount = { address: Address; isSigner: boolean; isWritable: boolean };

function fail(message: string): never {
  throw new Error(`Invalid Jupiter collateral build: ${message}`);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function parseAddress(value: unknown, name: string): Address {
  if (typeof value !== 'string') fail(`${name} must be an address`);
  try {
    return address(value);
  } catch {
    return fail(`${name} is not a valid address`);
  }
}

function parseU64(value: unknown, name: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) fail(`${name} must be a canonical decimal u64 string`);
  const parsed = BigInt(value);
  if (parsed > U64_MAX) fail(`${name} exceeds u64`);
  return parsed;
}

function parseBps(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10_000) fail(`${name} must be an integer from 0 to 10000`);
  return value;
}

function parseBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length > 5464 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail('swapInstruction.data must be canonical base64');
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return fail('swapInstruction.data is not valid base64');
  }
  if (binary.length > MAX_DATA_BYTES || btoa(binary) !== value) fail('swapInstruction.data must be canonical base64 of at most 4096 bytes');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function u64le(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[offset + i]!);
  return value;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export async function associatedTokenAddress(owner: Address, mint: Address): Promise<Address> {
  const encode = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [encode.encode(owner), encode.encode(TOKEN_PROGRAM), encode.encode(mint)]
  });
  return ata;
}

function account(addressValue: Address, isSigner = false, isWritable = false): RawAccount {
  return Object.freeze({ address: addressValue, isSigner, isWritable });
}

function instruction(programAddress: Address, accounts: readonly RawAccount[], data: Uint8Array): MimirBetaInstruction {
  return Object.freeze({
    programAddress,
    accounts: Object.freeze(accounts.map((meta) => Object.freeze({ ...meta }))),
    data: new Uint8Array(data)
  });
}

function leBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = Number((value >> BigInt(i * 8)) & 0xffn);
  return bytes;
}

function requireMeta(
  accounts: readonly RawAccount[],
  index: number,
  expectedAddress: Address,
  expectedSigner: boolean,
  expectedWritable: boolean,
  name: string
): void {
  const meta = accounts[index]!;
  if (meta.address !== expectedAddress || meta.isSigner !== expectedSigner || meta.isWritable !== expectedWritable) fail(`swap account ${index} must be ${name}`);
}

export async function validateJupiterCollateralBuild(
  raw: unknown,
  expected: {
    authority: Address;
    collateralMint: Address;
    collateralTokenAccount: Address;
    requiredOutputRaw: bigint;
    maxInputLamports: bigint;
    slippageBps: number;
  }
): Promise<{
  instructions: readonly MimirBetaInstruction[];
  inputLamports: bigint;
  quotedOutputRaw: bigint;
  minimumOutputRaw: bigint;
  sourceTokenAccount: Address;
  collateralTokenAccount: Address;
}> {
  const authority = parseAddress(expected.authority, 'expected.authority');
  const collateralMint = parseAddress(expected.collateralMint, 'expected.collateralMint');
  const expectedCollateralAta = parseAddress(expected.collateralTokenAccount, 'expected.collateralTokenAccount');
  if (collateralMint === WSOL_MINT) fail('collateral output must not be WSOL');
  if (typeof expected.requiredOutputRaw !== 'bigint' || expected.requiredOutputRaw <= 0n || expected.requiredOutputRaw > U64_MAX) fail('requiredOutputRaw must be a positive u64 bigint');
  if (typeof expected.maxInputLamports !== 'bigint' || expected.maxInputLamports <= 0n || expected.maxInputLamports > U64_MAX) fail('maxInputLamports must be a positive u64 bigint');
  const expectedSlippage = parseBps(expected.slippageBps, 'expected.slippageBps');

  const sourceTokenAccount = await associatedTokenAddress(authority, WSOL_MINT);
  const collateralTokenAccount = await associatedTokenAddress(authority, collateralMint);
  if (expectedCollateralAta !== collateralTokenAccount) fail('expected collateral token account is not the authority ATA');

  const response = record(raw, 'response');
  if ('otherInstructions' in response && (!Array.isArray(response.otherInstructions) || response.otherInstructions.length !== 0)) fail('otherInstructions must be empty');
  if (response.tipInstruction !== undefined && response.tipInstruction !== null) fail('tipInstruction is unsupported');

  const inputMint = parseAddress(response.inputMint, 'inputMint');
  const outputMint = parseAddress(response.outputMint, 'outputMint');
  if (inputMint !== WSOL_MINT || outputMint !== collateralMint) fail('metadata mints do not match WSOL and expected collateral');
  const inputLamports = parseU64(response.inAmount, 'inAmount');
  const quotedOutputRaw = parseU64(response.outAmount, 'outAmount');
  const reportedThreshold = parseU64(response.otherAmountThreshold, 'otherAmountThreshold');
  const metadataSlippage = parseBps(response.slippageBps, 'slippageBps');
  if (metadataSlippage !== expectedSlippage) fail('metadata slippage does not match reviewed slippage');
  if (inputLamports === 0n || inputLamports > expected.maxInputLamports) fail('input amount is zero or exceeds the reviewed SOL cap');

  const swap = record(response.swapInstruction, 'swapInstruction');
  if (parseAddress(swap.programId, 'swapInstruction.programId') !== JUPITER_PROGRAM) fail('swap program is not Jupiter v6');
  const data = parseBase64(swap.data);
  if (data.length > MAX_DATA_BYTES || data.length < 8) fail('swap instruction data length is invalid');
  if (sameBytes(data.subarray(0, 8), SHARED_ROUTE_V2)) fail('shared_accounts_route_v2 is unsupported: authoritative program-authority PDA seed encoding is not available locally');
  if (!sameBytes(data.subarray(0, 8), ROUTE_V2)) fail('unsupported Jupiter instruction discriminator');

  const prefixLength = 30;
  if (data.length < prefixLength + 4 + 5) fail('route_v2 prefix or nonempty route vector is truncated');
  const encodedInput = u64le(data, 8);
  const encodedOutput = u64le(data, 16);
  const encodedSlippage = u16le(data, 24);
  const platformFeeBps = u16le(data, 26);
  const positiveSlippageFeeBps = u16le(data, 28);
  const routeCount = u32le(data, prefixLength);
  if (encodedInput !== inputLamports || encodedOutput !== quotedOutputRaw || encodedSlippage !== expectedSlippage) fail('encoded financial prefix does not match reviewed metadata');
  if (platformFeeBps !== 0 || positiveSlippageFeeBps !== 0) fail('Jupiter platform and positive-slippage fees must be zero');
  if (routeCount === 0 || routeCount > Math.floor((data.length - prefixLength - 4) / 5)) fail('route_v2 route vector is empty or truncated');

  const minimumOutputRaw = (quotedOutputRaw * BigInt(10_000 - expectedSlippage)) / BPS;
  const roundedUpMinimum = (quotedOutputRaw * BigInt(10_000 - expectedSlippage) + BPS - 1n) / BPS;
  if (reportedThreshold !== minimumOutputRaw && reportedThreshold !== roundedUpMinimum) fail('reported minimum output is inconsistent with the encoded quote and slippage');
  if (minimumOutputRaw < expected.requiredOutputRaw) fail('conservative guaranteed output is below the required collateral shortfall');

  if (!Array.isArray(swap.accounts) || swap.accounts.length < 10 || swap.accounts.length > MAX_ACCOUNTS) fail('swap account count must be between 10 and 64');
  const accounts: RawAccount[] = swap.accounts.map((rawMeta, index) => {
    const meta = record(rawMeta, `swap.accounts[${index}]`);
    if (typeof meta.isSigner !== 'boolean' || typeof meta.isWritable !== 'boolean') fail(`swap.accounts[${index}] flags must be booleans`);
    return account(parseAddress(meta.pubkey, `swap.accounts[${index}].pubkey`), meta.isSigner, meta.isWritable);
  });
  if (accounts.some((meta, index) => meta.isSigner !== (index === 0) || (meta.isSigner && meta.address !== authority))) fail('the only swap signer must be the expected authority at account 0');
  requireMeta(accounts, 0, authority, true, false, 'the expected authority signer');
  requireMeta(accounts, 1, sourceTokenAccount, false, true, 'the authority WSOL ATA');
  requireMeta(accounts, 2, collateralTokenAccount, false, true, 'the authority collateral ATA');
  requireMeta(accounts, 3, WSOL_MINT, false, false, 'the WSOL mint');
  requireMeta(accounts, 4, collateralMint, false, false, 'the expected collateral mint');
  requireMeta(accounts, 5, TOKEN_PROGRAM, false, false, 'the source SPL Token program');
  requireMeta(accounts, 6, TOKEN_PROGRAM, false, false, 'the destination SPL Token program');
  const optionalDestination = accounts[7]!;
  const optionalIsOutputAta = optionalDestination.address === collateralTokenAccount;
  if ((!optionalIsOutputAta && optionalDestination.address !== JUPITER_PROGRAM) || optionalDestination.isSigner || optionalDestination.isWritable !== optionalIsOutputAta) {
    fail('swap account 7 must be the readonly Jupiter placeholder or writable collateral ATA');
  }
  requireMeta(accounts, 8, EVENT_AUTHORITY, false, false, 'the Jupiter event authority');
  requireMeta(accounts, 9, JUPITER_PROGRAM, false, false, 'the Jupiter program');

  const preparation = [
    instruction(ASSOCIATED_TOKEN_PROGRAM, [
      account(authority, true, true), account(sourceTokenAccount, false, true), account(authority), account(WSOL_MINT), account(SYSTEM_PROGRAM), account(TOKEN_PROGRAM)
    ], Uint8Array.of(1)),
    instruction(ASSOCIATED_TOKEN_PROGRAM, [
      account(authority, true, true), account(collateralTokenAccount, false, true), account(authority), account(collateralMint), account(SYSTEM_PROGRAM), account(TOKEN_PROGRAM)
    ], Uint8Array.of(1)),
    instruction(SYSTEM_PROGRAM, [account(authority, true, true), account(sourceTokenAccount, false, true)], Uint8Array.of(2, 0, 0, 0, ...leBytes(inputLamports, 8))),
    instruction(TOKEN_PROGRAM, [account(sourceTokenAccount, false, true)], Uint8Array.of(17))
  ];
  const instructions = Object.freeze([...preparation, instruction(JUPITER_PROGRAM, accounts, data)]);

  return Object.freeze({ instructions, inputLamports, quotedOutputRaw, minimumOutputRaw, sourceTokenAccount, collateralTokenAccount });
}
