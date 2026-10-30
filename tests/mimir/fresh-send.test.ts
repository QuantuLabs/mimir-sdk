// 0.9.2: fresh-price step shape and sign path, createFeed needs rpc, devnet hint, custom signer type, error mapping, buildSwap failures; no network.
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { compileMimirBetaTransactionV1 } from '../../src/beta/transactionV1.js';
import { normaliseWallet } from '../../src/wallet.js';
import { sizeCollateralPurchaseQuote } from '../../src/create/collateral-quote.js';
import { unsignedFromWire } from '../../src/create/facade.js';
import { Mimir, MimirError } from '../../src/root.js';

globalThis.fetch = (() => { throw new Error('network used'); }) as typeof fetch;
const kp = Keypair.fromSeed(new Uint8Array(32).fill(9)), address = kp.publicKey.toBase58();
const OTHER = 'Vote111111111111111111111111111111111111111';
const tx = await compileMimirBetaTransactionV1({ feePayer: address as never, recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 9n,
  instructions: [{ programAddress: OTHER as never, accounts: [{ address: address as never, isSigner: true, isWritable: true }], data: Uint8Array.of(1) }] });
const wire = Buffer.from(tx.serializedTransaction).toString('base64');
const rejects = async (run: () => Promise<unknown>, code: string, re?: RegExp) => {
  const e = await run().then(() => null, (x) => x);
  assert.ok(e instanceof MimirError, `${code}: ${e}`); assert.equal(e.code, code); if (re) assert.match(`${e.message} ${e.hint}`, re);
};

// A fresh-price step may call any program; a creation step may not.
await rejects(() => unsignedFromWire({ transaction: wire, payer: address, lastValidBlockHeight: '9' }), 'INVALID_INPUT', /not a Mimir creation program/);
const step = { kind: 'fresh-price' as const, index: 1, of: 1, payer: address, feeds: ['SOL'], transaction: wire, lastValidBlockHeight: '9',
  review: { debitSol: '0.000005', networkFeeSol: '0.000005', firstPrice: false, reviewHash: tx.messageHash } };
const signed = Buffer.from(await new Mimir({ wallet: kp }).sign(step), 'base64');
assert.equal(signed.length, tx.serializedTransaction.length);
assert.ok(signed.subarray(tx.serializedMessage.length).some(Boolean));

// F5, F2.
await rejects(() => new Mimir().createFeed({ mint: 'So11111111111111111111111111111111111111112', dryRun: true }), 'INVALID_INPUT', /needs rpc/);
await rejects(() => new Mimir({ cluster: 'devnet', rpc: 'http://127.0.0.1:1' }).price('SOL'), 'NOT_SUPPORTED', /cluster: 'mainnet'/);
await rejects(() => new Mimir().sendWithFreshPrice('SOL', []), 'NO_WALLET');

// F6: a custom signer returning a string.
await rejects(() => normaliseWallet({ address, sign: async () => 'base64' }).sign(tx), 'WALLET_UNSUPPORTED', /Uint8Array/);

// F16, F17.
assert.equal(MimirError.from(new Error('Transaction simulation failed: AccountNotFound')).code, 'INSUFFICIENT_SOL');
const expired = MimirError.from(new Error('Blockhash not found'));
assert.deepEqual([expired.code, expired.retry], ['EXPIRED', 'now']);
const raw = MimirError.from({ InstructionError: [1, { Custom: 54 }] });
assert.doesNotMatch(raw.message, /object Object/); assert.match(raw.message, /Custom/);

// F18.
await rejects(() => sizeCollateralPurchaseQuote({ buildSwap: async () => { throw new Error('route down'); }, authority: address as never, collateralMint: OTHER as never,
  collateralTokenAccount: OTHER as never, shortfallRaw: 10n, maxInputLamports: 10n ** 9n }), 'SWAP_UNAVAILABLE', /route down/);

// N1, F4 wording.
assert.match(new MimirError('COMPOSITE_CHILD_MULTI_ROW', 'x', 'never').hint, /pools: \[onePool\]/);
assert.match(new MimirError('UNPRICEABLE', 'x', 'never').hint, /after: error\.signatures/);
console.log('fresh-send: ok');
