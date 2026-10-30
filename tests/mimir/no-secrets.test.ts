// The client, its errors and the plans never hold a secret key or the rpc URL.
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { fakeRpc } from './fixtures.js';
import { Mimir } from '../../src/root.js';

const kp = Keypair.fromSeed(new Uint8Array(32).fill(5)), secret58 = bs58.encode(kp.secretKey), bytes = Array.from(kp.secretKey).join(',');
const rpc = await fakeRpc(() => ['status', 500, {}]);
const url = `${rpc.url}/?api-key=SEKRET`;
const clean = (text: string, what: string) => { for (const bad of ['SEKRET', secret58, bytes, rpc.url]) assert.ok(!text.includes(bad), `${what} leaks ${bad.slice(0, 12)}`); };
try {
  for (const wallet of [kp, secret58, Array.from(kp.secretKey)]) {
    const mimir = new Mimir({ wallet, rpc: url });
    assert.deepEqual(JSON.parse(JSON.stringify(mimir)), { mode: 'rpc', cluster: 'mainnet', address: kp.publicKey.toBase58() });
    clean(JSON.stringify(mimir), 'JSON'); clean(inspect(mimir, { depth: 5, showHidden: true }), 'inspect'); clean(Object.keys(mimir).join(), 'keys');
    for (const run of [() => mimir.price('SOL'), () => mimir.createFeed({ mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', dryRun: true })]) {
      const e = await run().then(() => assert.fail('expected the failing RPC to throw'), (x) => x);
      clean(`${e.message} ${e.hint} ${JSON.stringify(e)} ${inspect(e, { depth: 3 })}`, `error ${e.code}`);
    }
  }
  console.log('mimir no secrets: ok');
} finally { await rpc.close(); }
