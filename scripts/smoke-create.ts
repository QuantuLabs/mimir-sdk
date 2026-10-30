// Opt-in mainnet simulate-only smoke of ./create: plan, then every step built and simulated (sigVerify false). Never signs or sends.
// npm run smoke:create -- --rpc-file <file holding the RPC URL> --mint <base mint> [--ticker T] [--payer <COLA holder>]
import { readFileSync } from 'node:fs';
import { createSolanaRpc, isOffCurveAddress, type Address } from '@solana/kit';
import { findMimirV1AssociatedTokenAddress } from '../src/v1/build.js';
import { prepareFeed } from '../src/create/index.js';
import { prepareStep } from '../src/create/facade.js';
import { MIMIR_MAINNET_COLLATERAL_MINT } from '../src/create/policy.js';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const rpcUrl = readFileSync(arg('rpc-file')!, 'utf8').trim(), rpc = createSolanaRpc(rpcUrl);
const json = (x: unknown) => JSON.stringify(x, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 1);

async function colaHolder(): Promise<string> {
  const largest = (await rpc.getTokenLargestAccounts(MIMIR_MAINNET_COLLATERAL_MINT).send()).value;
  for (const { address } of largest) {
    const info = (await rpc.getAccountInfo(address, { encoding: 'jsonParsed' }).send()).value as unknown as { data: { parsed: { info: { owner: string } } } } | null;
    const owner = info?.data.parsed.info.owner;
    if (!owner) continue;
    const sol = (await rpc.getBalance(owner as Address).send()).value;
    const [ata] = await findMimirV1AssociatedTokenAddress(owner as Address, MIMIR_MAINNET_COLLATERAL_MINT);
    if (!isOffCurveAddress(owner as Address) && ata === address && sol > 100_000_000n) return owner;
  }
  throw new Error('no COLA holder with SOL');
}

const payer = arg('payer') ?? await colaHolder();
const ticker = arg('ticker') ?? `ZQ${Date.now().toString(36).toUpperCase().slice(-6)}`;
const plan = await prepareFeed({ payer, ticker, baseMint: arg('mint')!, quote: 'USDC', rpc: rpcUrl });
console.log('PLAN', json({ ...plan, args: { ...plan.args, rpc: '<redacted>' } }));
for (let i = 0; i < plan.steps.length; i++) {
  const step = await prepareStep(plan, i);
  const wire = Buffer.from(step.transaction.serializedTransaction).toString('base64');
  const sim = await rpc.simulateTransaction(wire as never, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' } as never).send() as unknown as
    { value: { err: unknown; unitsConsumed?: bigint; logs?: string[] } };
  console.log('STEP', json({ kind: step.kind, bytes: step.transaction.serializedTransaction.length, instructions: step.transaction.packet.instructionCount,
    accounts: step.transaction.packet.accountCount, computeUnitLimit: step.transaction.config.computeUnitLimit, review: { ...step.review, writes: step.review.writes.length },
    simulate: { err: sim.value.err, unitsConsumed: sim.value.unitsConsumed, tail: sim.value.err ? sim.value.logs?.slice(-6) : undefined },
    sol: Number(step.review.debitLamports) / 1e9 }));
}
