import { getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder } from '@solana/transaction-messages';
import { base64 } from '../beta/bytes.js';
import { betaError } from '../beta/errors.js';
import type { MimirBetaUnsignedTransaction } from '../beta/review.js';

const PRECOMPILES = new Set(['Ed25519SigVerify111111111111111111111111111', 'KeccakSecp256k11111111111111111111111111111',
  'Secp256r1SigVerify1111111111111111111111111']);
const U64_MAX = (1n << 64n) - 1n;

type FeeRpc = { getFeeForMessage?: (message: never, config?: never) => { send(): Promise<unknown> } };
type Quote = { context: { slot: bigint }; value: bigint | null };

/** The v0 base-fee-only proxy of a TxV1 message: same payer, signers, blockhash and signature precompiles; no compute budget. */
export function txV1FeeProxyMessage(tx: Pick<MimirBetaUnsignedTransaction, 'serializedMessage' | 'requiredSigners' | 'feePayer' | 'recentBlockhash'>): Uint8Array {
  const compiled = getCompiledTransactionMessageDecoder().decode(tx.serializedMessage) as unknown as { version: number;
    header: { numSignerAccounts: number }; staticAccounts: readonly string[]; lifetimeToken: string;
    instructionHeaders: readonly { programAccountIndex: number; numInstructionAccounts: number }[];
    instructionPayloads: readonly { instructionData: Uint8Array }[] };
  const signers = compiled.staticAccounts.slice(0, compiled.header.numSignerAccounts);
  if (compiled.version !== 1 || signers[0] !== tx.feePayer || compiled.lifetimeToken !== tx.recentBlockhash ||
    signers.length !== tx.requiredSigners.length || signers.some((s, i) => s !== tx.requiredSigners[i])) throw new Error('TxV1 fee proxy cannot represent this message');
  const keys: string[] = [...signers];
  const ixs: { programAddressIndex: number; accountIndices: number[]; data: Uint8Array }[] = [];
  for (const [i, ix] of compiled.instructionHeaders.entries()) {
    const program = compiled.staticAccounts[ix.programAccountIndex]!;
    if (!PRECOMPILES.has(program)) continue;
    if (ix.numInstructionAccounts) throw new Error('TxV1 fee proxy cannot represent a precompile with accounts');
    if (!keys.includes(program)) keys.push(program);
    ixs.push({ programAddressIndex: keys.indexOf(program), accountIndices: [], data: compiled.instructionPayloads[i]!.instructionData });
  }
  return new Uint8Array(getCompiledTransactionMessageEncoder().encode({ version: 0, header: { numSignerAccounts: signers.length,
    numReadonlySignerAccounts: 0, numReadonlyNonSignerAccounts: keys.length - signers.length }, staticAccounts: keys,
    lifetimeToken: tx.recentBlockhash, instructions: ixs, addressTableLookups: [] } as never));
}

/** TxV1 fee on any RPC: `getFeeForMessage` of the v0 base-only proxy plus the TxV1's own absolute priority fee. Same response shape. */
export async function quoteTxV1Fee(rpc: FeeRpc, tx: Pick<MimirBetaUnsignedTransaction, 'serializedMessage' | 'requiredSigners' | 'feePayer' | 'recentBlockhash' | 'config'>,
  config: { commitment: 'confirmed'; minContextSlot?: bigint }): Promise<Quote> {
  if (!rpc.getFeeForMessage) throw new Error('Fee estimation is unavailable');
  const response = await rpc.getFeeForMessage(base64(txV1FeeProxyMessage(tx)) as never, config as never).send() as { context?: { slot?: unknown }; value?: unknown };
  if (!response || typeof response !== 'object' || !response.context || typeof response.context !== 'object') betaError('RPC_CONTEXT_MISMATCH', 'Message fee response is malformed');
  const slot = response.context.slot;
  if ((typeof slot !== 'bigint' && !Number.isSafeInteger(slot)) || BigInt(slot as bigint) < 0n) betaError('RPC_CONTEXT_MISMATCH', 'Message fee context is malformed');
  if (response.value === null) return { context: { slot: BigInt(slot as bigint) }, value: null };
  if ((typeof response.value !== 'bigint' && !Number.isSafeInteger(response.value)) || BigInt(response.value as bigint) < 0n) betaError('RPC_CONTEXT_MISMATCH', 'Message fee is malformed');
  const value = BigInt(response.value as bigint) + (tx.config.priorityFeeLamports ?? 0n);
  if (value > U64_MAX) betaError('RPC_CONTEXT_MISMATCH', 'Message fee overflows u64');
  return { context: { slot: BigInt(slot as bigint) }, value };
}
