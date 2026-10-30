// One TxV1 fee quote on every RPC: v0 base-only proxy + the TxV1's own priority fee.
import assert from 'node:assert/strict';
import { getAddressDecoder, type Address } from '@solana/kit';
import { getCompiledTransactionMessageDecoder } from '@solana/transaction-messages';
import { compileMimirBetaTransactionV1 } from '../../src/beta/transactionV1.js';
import { quoteTxV1Fee, txV1FeeProxyMessage } from '../../src/create/txv1-fee.js';
import bs58 from 'bs58';
import { purchaseNetworkFeeLamports } from '../../src/create/collateral-purchase.js';

const addr = (b: number) => getAddressDecoder().decode(new Uint8Array(32).fill(b)) as Address;
const payer = addr(1), cosigner = addr(2), program = addr(3);
const ED25519 = 'Ed25519SigVerify111111111111111111111111111' as Address, SYSTEM = '11111111111111111111111111111111' as Address;
const blockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
const ix = (signers: Address[] = []) => ({ programAddress: program, accounts: [{ address: payer, isSigner: true, isWritable: true },
  ...signers.map((address) => ({ address, isSigner: true, isWritable: false }))], data: Uint8Array.of(1) });
const compile = (instructions: never[], priorityFeeLamports = 2_000n) =>
  compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: blockhash, lastValidBlockHeight: 9n, priorityFeeLamports,
    instructions: [{ programAddress: 'ComputeBudget111111111111111111111111111111' as Address, accounts: [], data: Uint8Array.of(2, 0x40, 0x0d, 3, 0) }, ...instructions] as never });

/** Solana's base fee of a legacy/v0 message: 5,000 per header signature plus every precompile signature. */
const baseFee = (message: Uint8Array) => {
  const m = getCompiledTransactionMessageDecoder().decode(message) as never as { version: number; header: { numSignerAccounts: number };
    staticAccounts: string[]; lifetimeToken: string; instructions: { programAddressIndex: number; data?: Uint8Array }[] };
  assert.equal(m.version, 0);
  const pre = m.instructions.filter((i) => m.staticAccounts[i.programAddressIndex] === ED25519).reduce((s, i) => s + (i.data?.[0] ?? 0), 0);
  assert.ok(m.instructions.every((i) => m.staticAccounts[i.programAddressIndex] !== 'ComputeBudget111111111111111111111111111111'));
  return { fee: 5_000n * BigInt(m.header.numSignerAccounts + pre), message: m };
};
type Call = { message: Uint8Array; config: unknown };
/** Flux-like: refuses TxV1 (-32602) and ignores any v0 priority. Alchemy-like answers v0 the same. */
const fakeRpc = (opts: { slot?: bigint; value?: (fee: bigint) => unknown; error?: Error } = {}) => {
  const calls: Call[] = [];
  return { calls, rpc: { getFeeForMessage: (b64: string, config: unknown) => ({ send: async () => {
    const message = new Uint8Array(Buffer.from(b64, 'base64'));
    calls.push({ message, config });
    if (opts.error) throw opts.error;
    if (message[0] === 0x81) throw Object.assign(new Error('Invalid params: invalid param'), { code: -32602 });
    const { fee } = baseFee(message);
    return { context: { slot: opts.slot ?? 100n }, value: opts.value ? opts.value(fee) : fee };
  } }) } };
};

// Flux-like and Alchemy-like: 5,000 + 2,000 = 7,000; the TxV1 is never sent to getFeeForMessage.
{
  const tx = await compile([ix()] as never);
  const { rpc, calls } = fakeRpc();
  const quote = await quoteTxV1Fee(rpc, tx, { commitment: 'confirmed', minContextSlot: 42n });
  assert.deepEqual(quote, { context: { slot: 100n }, value: 7_000n });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.config, { commitment: 'confirmed', minContextSlot: 42n });
  const { message } = baseFee(calls[0]!.message);
  assert.equal(message.staticAccounts[0], payer);
  assert.equal(message.lifetimeToken, blockhash);
}
// Two signers: 10,000 + priority. An Ed25519 precompile with 3 signatures is charged verbatim.
{
  const two = await compile([ix([cosigner])] as never);
  assert.equal((await quoteTxV1Fee(fakeRpc().rpc, two, { commitment: 'confirmed' })).value, 12_000n);
  const pre = await compile([ix(), { programAddress: ED25519, accounts: [], data: Uint8Array.of(3, 0, 9, 9) }] as never, 3_000n);
  const { rpc, calls } = fakeRpc();
  assert.equal((await quoteTxV1Fee(rpc, pre, { commitment: 'confirmed' })).value, 5_000n * 4n + 3_000n);
  const proxied = baseFee(calls[0]!.message).message;
  assert.deepEqual([...proxied.instructions[0]!.data!], [3, 0, 9, 9]);
}
// Unrepresentable: a precompile carrying accounts; a message that is not the reviewed one.
{
  const bad = await compile([ix(), { programAddress: ED25519, accounts: [{ address: SYSTEM, isSigner: false, isWritable: false }], data: Uint8Array.of(1) }] as never);
  await assert.rejects(quoteTxV1Fee(fakeRpc().rpc, bad, { commitment: 'confirmed' }), /cannot represent/);
  const tx = await compile([ix()] as never);
  await assert.rejects(quoteTxV1Fee(fakeRpc().rpc, { ...tx, feePayer: cosigner }, { commitment: 'confirmed' }), /cannot represent/);
}
// Edges: null (expired blockhash) keeps null; overflow; transport error propagates; malformed value refused.
{
  const tx = await compile([ix()] as never);
  assert.deepEqual(await quoteTxV1Fee(fakeRpc({ value: () => null }).rpc, tx, { commitment: 'confirmed' }), { context: { slot: 100n }, value: null });
  await assert.rejects(quoteTxV1Fee(fakeRpc({ value: () => (1n << 64n) - 1_000n }).rpc, tx, { commitment: 'confirmed' }), /overflows u64/);
  await assert.rejects(quoteTxV1Fee(fakeRpc({ error: new Error('socket hang up') }).rpc, tx, { commitment: 'confirmed' }), /socket hang up/);
  await assert.rejects(quoteTxV1Fee(fakeRpc({ value: () => -1 }).rpc, tx, { commitment: 'confirmed' }), /malformed/);
  await assert.rejects(quoteTxV1Fee({}, tx, { commitment: 'confirmed' }), /unavailable/);
}
// Call site: the collateral purchase fee on a Flux-like RPC = base + the purchase TxV1's own priority.
{
  const { rpc } = fakeRpc();
  const full = { ...rpc, getLatestBlockhash: () => ({ send: async () => ({ context: { slot: 100n }, value: { blockhash, lastValidBlockHeight: 9n } }) }) };
  const fee = await purchaseNetworkFeeLamports(full as never, payer, [ix()] as never);
  const tx = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: blockhash, lastValidBlockHeight: 9n,
    instructions: [{ programAddress: 'ComputeBudget111111111111111111111111111111' as Address, accounts: [], data: Uint8Array.of(2, 0x68, 0xbf, 0, 0) }, ix()] as never });
  assert.equal(fee, 5_000n + tx.config.priorityFeeLamports!);
  await assert.rejects(purchaseNetworkFeeLamports({ ...full, ...fakeRpc({ value: () => null }).rpc } as never, payer, [ix()] as never), /unavailable/);
}
// The codec-built proxy is byte-identical to the former hand-built v0 encoding.
{
  const compactU16 = (n: number) => n < 0x80 ? [n] : n < 0x4000 ? [n & 0x7f | 0x80, n >> 7] : [n & 0x7f | 0x80, (n >> 7) & 0x7f | 0x80, n >> 14];
  const handBuilt = (tx: { serializedMessage: Uint8Array; recentBlockhash: string }) => {
    const m = getCompiledTransactionMessageDecoder().decode(tx.serializedMessage) as never as { header: { numSignerAccounts: number }; staticAccounts: string[];
      instructionHeaders: { programAccountIndex: number }[]; instructionPayloads: { instructionData: Uint8Array }[] };
    const signers = m.staticAccounts.slice(0, m.header.numSignerAccounts), keys = [...signers], ixs: number[] = [];
    let count = 0;
    for (const [i, h] of m.instructionHeaders.entries()) {
      const p = m.staticAccounts[h.programAccountIndex]!;
      if (p !== ED25519) continue;
      if (!keys.includes(p)) keys.push(p);
      const data = m.instructionPayloads[i]!.instructionData;
      ixs.push(keys.indexOf(p), 0, ...compactU16(data.length), ...data); count++;
    }
    return new Uint8Array([0x80, signers.length, 0, keys.length - signers.length, ...compactU16(keys.length), ...keys.flatMap((k) => [...bs58.decode(k)]),
      ...bs58.decode(tx.recentBlockhash), ...compactU16(count), ...ixs, 0]);
  };
  for (const tx of [await compile([ix()] as never), await compile([ix([cosigner])] as never),
    await compile([ix(), { programAddress: ED25519, accounts: [], data: Uint8Array.of(3, 0, 9, 9) }] as never, 3_000n),
    await compile([ix([cosigner]), { programAddress: ED25519, accounts: [], data: new Uint8Array(200).fill(1) }, { programAddress: ED25519, accounts: [], data: Uint8Array.of(1) }] as never)]) {
    assert.deepEqual(txV1FeeProxyMessage(tx), handBuilt(tx));
  }
}
console.log('txv1 fee: ok');
