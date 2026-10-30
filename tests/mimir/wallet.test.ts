// Each wallet input gives the right address and a valid Ed25519 signature over a TxV1 message; refusals and the reject mapping; no network.
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { createKeyPairSignerFromBytes } from '@solana/signers';
import { createKeyPairFromBytes } from '@solana/keys';
import { compileMimirBetaTransactionV1, admitMimirBetaWalletSignedTransactionV1 } from '../../src/beta/transactionV1.js';
import { normaliseWallet } from '../../src/wallet.js';
import { Mimir, MimirError } from '../../src/root.js';

const fetched = globalThis.fetch;
globalThis.fetch = (() => { throw new Error('network used'); }) as typeof fetch;
const kp = Keypair.fromSeed(new Uint8Array(32).fill(7)), secret = kp.secretKey, address = kp.publicKey.toBase58();
const tx = await compileMimirBetaTransactionV1({ feePayer: address as never, recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 9n,
  instructions: [{ programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as never, accounts: [{ address: address as never, isSigner: true, isWritable: true }], data: Uint8Array.of(1) }] });
const valid = async (wire: Uint8Array) => { await admitMimirBetaWalletSignedTransactionV1({ transaction: tx, walletAddress: address as never, walletSignedTransaction: wire }); return true; };
const local = normaliseWallet(secret);
const standard = (versions: unknown[] = ['legacy', 0, 1]) => ({ name: 'Mock', accounts: [{ address, publicKey: kp.publicKey.toBytes() }], features: {
  'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: versions,
    signTransaction: async ({ transaction }: { transaction: Uint8Array }) => { assert.deepEqual(transaction, tx.serializedTransaction); return [{ signedTransaction: await local.sign(tx) }]; } } } });
const inputs: [string, unknown][] = [
  ['id.json bytes', Array.from(secret)], ['Uint8Array', secret], ['base58', bs58.encode(secret)], ['web3 Keypair', kp],
  ['CryptoKeyPair', await createKeyPairFromBytes(secret)], ['kit KeyPairSigner', await createKeyPairSignerFromBytes(secret)],
  ['Wallet Standard', standard()], ['wallet-adapter useWallet()', { publicKey: kp.publicKey, wallet: { adapter: { wallet: standard() } } }],
  ['custom { address, sign }', { address, sign: async (step: { transaction: typeof tx }) => local.sign(step.transaction) }],
];
for (const [name, w] of inputs) {
  const s = normaliseWallet(w);
  for (let i = 0; i < 200 && s.address() === null; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(s.address(), address, name);
  assert.ok(await valid(await s.sign(tx)), name);
}
const refused = (w: unknown, re: RegExp) => assert.throws(() => normaliseWallet(w), (e: MimirError) => e.code === 'WALLET_UNSUPPORTED' && re.test(e.message) && /useWallet\(\)\.wallet/.test(e.hint));
refused(standard(['legacy', 0]), /Transaction v1/);
refused({ publicKey: kp.publicKey, signTransaction: async () => null }, /legacy adapter/);
refused({ foo: 1 }, /unknown wallet shape/);
refused(new Uint8Array(32), /64 bytes/);
const bad = Uint8Array.from(secret); bad[40] ^= 1;
await assert.rejects(normaliseWallet(bad).sign(tx), (e: MimirError) => e.code === 'WALLET_UNSUPPORTED');
for (const reason of [Object.assign(new Error('x'), { code: 4001 }), new Error('User rejected the request.')]) {
  const s = normaliseWallet({ ...standard(), features: { 'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: [1], signTransaction: async () => { throw reason; } } } });
  await assert.rejects(s.sign(tx), (e: MimirError) => e.code === 'WALLET_REJECTED' && e.retry === 'now');
}
const disconnected = new Mimir({ wallet: { ...standard(), accounts: [] } });
assert.equal(disconnected.address, null);
await assert.rejects(disconnected.createFeed({ mint: address }), (e: MimirError) => e.code === 'NO_WALLET');
const reader = new Mimir();
assert.deepEqual([reader.canWrite, reader.address, reader.mode], [false, null, 'api']);
await assert.rejects(reader.createFeed({ mint: address }), (e: MimirError) => e.code === 'NO_WALLET' && /new Mimir\(\{ wallet \}\)/.test(e.hint));
assert.throws(() => new Mimir({ wallet: { nope: true } }), (e: MimirError) => e.code === 'WALLET_UNSUPPORTED');
globalThis.fetch = fetched;
console.log('mimir wallet inputs: ok');
