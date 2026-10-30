import type { Address } from '@solana/kit';
import { createInjectedPoolDiscovery, type MimirBetaEligiblePool } from '../beta/discovery.js';
import { mimirBetaCapturePoolCoreLayout, mimirBetaCaptureScanDescriptors } from '../beta/capture.js';
import { decodeMimirBetaCaptureRpcAccount, readMimirBetaAccountCohort, type MimirBetaFinalizedRpc } from '../beta/rpc.js';
import { isMimirBetaCohortNotConverged } from '../chunkedAccounts.js';
import { MimirBetaError } from '../beta/errors.js';
import { MimirError } from '../easy/error.js';
import { MIMIR_MAINNET_EVIDENCE_TTL_SLOTS, MIMIR_MAINNET_MAX_SCAN_RESULTS_PER_FAMILY } from './policy.js';

type Rpc = { getMultipleAccounts(xs: readonly Address[], c: object): { send(): Promise<{ context: { slot: bigint }; value: readonly unknown[] }> };
  getAccountInfo(x: Address, c: object): { send(): Promise<{ context: { slot: bigint }; value: unknown }> } };

async function accounts(rpc: Rpc, xs: readonly Address[], minContextSlot?: bigint) {
  const read = await readMimirBetaAccountCohort(rpc as unknown as MimirBetaFinalizedRpc, xs, 'confirmed', minContextSlot, true);
  return { slot: read.slot, accounts: xs.map((x, i) => read.value[i] ?? decodeMimirBetaCaptureRpcAccount(x, null)) };
}

const CLOCK = 'SysvarC1ock11111111111111111111111111111111' as Address;
const SKEW_HINT = "Your RPC provider's clock stayed a slot out of step with the accounts it returned, over four paced reads. Retry in a few seconds, or use another RPC.";
const CLOCK_HINT = "Your RPC provider returned a malformed Clock account. Retry in a few seconds, or use another RPC.";
const skew = <T>(p: Promise<T>) => p.catch((e) => {
  if (isMimirBetaCohortNotConverged(e)) throw new MimirError('RPC', 'RPC clock out of step with its accounts', 'later', { hint: SKEW_HINT, cause: e });
  if (e instanceof MimirBetaError && e.message === 'RPC_CONTEXT_MISMATCH:cohort Clock is not authentic') throw new MimirError('RPC', 'RPC Clock account is not authentic', 'later', { hint: CLOCK_HINT, cause: e });
  throw e;
});

/** The SDK's own eligibility (captured layouts, read plans, evidence) over the given pool addresses, read from `rpc`. */
export async function resolveEligiblePools(rpc: Rpc, baseMint: Address, quoteMint: Address, pools: readonly Address[]): Promise<MimirBetaEligiblePool[]> {
  const descriptors = mimirBetaCaptureScanDescriptors('mainnet-beta');
  const families = [...new Set(descriptors.map((d) => d.family))];
  const scanned = (await skew(accounts(rpc, pools))).accounts;
  const discovery = createInjectedPoolDiscovery({ cluster: 'mainnet-beta', evidenceTtlSlots: MIMIR_MAINNET_EVIDENCE_TTL_SLOTS,
    maxScanResultsPerFamily: MIMIR_MAINNET_MAX_SCAN_RESULTS_PER_FAMILY,
    sources: families.map((family) => {
      const layouts = descriptors.filter((d) => d.family === family).map(mimirBetaCapturePoolCoreLayout);
      return { layouts,
        loadProgram: async () => ({ executable: (await accounts(rpc, [layouts[0]!.programId as Address])).accounts[0]!.executable }),
        scan: async () => scanned.filter((a) => layouts.some((l) => l.programId === a.owner)).map(({ address, owner, data }) => ({ address, owner, data })) };
    }),
    getContext: async () => {
      const clock = await skew(accounts(rpc, [CLOCK]));
      const data = clock.accounts[0]!.data;
      return { slot: clock.slot, unixTimestamp: new DataView(data.buffer, data.byteOffset).getBigInt64(32, true) };
    },
    loadCapturePlanAccounts: async ({ minContextSlot, plans }) => {
      const read = await skew(accounts(rpc, [...new Set(plans.flatMap(({ addresses }) => addresses))], minContextSlot));
      return { contextSlot: read.slot, accounts: read.accounts.map(({ address, owner, executable, data }) => ({ address, owner, executable, data })) };
    } });
  const result = await discovery.searchSpotPools({ baseMint, quoteMint, query: '', maxPools: 5 });
  const eligible = result.pools.filter((p): p is MimirBetaEligiblePool => p.eligibility === 'eligible');
  return pools.flatMap((x) => eligible.filter((p) => p.pool === x));
}

/** `resolveEligiblePools` in chunks of 4; a refused chunk (one missing account) splits in halves down to single pools, so one bad pool never hides the others. */
export async function resolveEligiblePoolsSplit(rpc: Rpc, baseMint: Address, quoteMint: Address, pools: readonly Address[]): Promise<MimirBetaEligiblePool[]> {
  const run = async (chunk: readonly Address[]): Promise<MimirBetaEligiblePool[]> => {
    try { return await resolveEligiblePools(rpc, baseMint, quoteMint, chunk); } catch (e) {
      if (e instanceof MimirError) throw e;
      if (chunk.length === 1) { if (/Minimum context slot|context regressed|RPC_CONTEXT_MISMATCH|fetch failed|HTTP error|Too many requests|ECONN|ETIMEDOUT/i.test(String((e as Error)?.message))) throw e; return []; }
      const half = chunk.length >> 1;
      return [...await run(chunk.slice(0, half)), ...await run(chunk.slice(half))];
    }
  };
  const chunks = Array.from({ length: Math.ceil(pools.length / 4) }, (_, i) => pools.slice(i * 4, i * 4 + 4));
  return (await Promise.all(chunks.map(run))).flat();
}
