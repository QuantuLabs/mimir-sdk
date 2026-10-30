import { InsufficientSolError } from './errors.js';
import { SolCreationContext, type MimirBetaFundingCosts } from './creation-context.js';
import { compileMimirBetaTransactionV1 } from '../beta/transactionV1.js';
import { FinalizedRpcReader } from '../beta/rpc.js';
import { quoteTxV1Fee } from './txv1-fee.js';
import { MimirBetaError } from '../beta/errors.js';
import { buildMimirBetaComputeUnitLimitInstruction as mimirComputeUnitLimitInstruction } from '../beta/liveAbi.js';
import type { MimirBetaPlanningRpc } from '../beta/client.js';
import { address, type Address } from '@solana/kit';
import { decodeMimirBetaSplTokenAccount } from '../beta/context.js';
import type { MimirBetaAccount } from '../beta/types.js';
import { PURCHASE_COMPUTE_UNIT_LIMIT, readRentExemptLamports, SOL_QUOTE_MINT, tightComputeUnitLimit } from './helpers.js';
import { validateJupiterCollateralBuild } from './collateral-funding.js';
import { assertMessageInput, associatedTokenAddress, base64, confirmedFrom, JUPITER_PROGRAM, object, PROBE_LAMPORTS, rpcContext, simulationAccount,
  sizeCollateralPurchaseQuote, SLIPPAGE_BPS, TOKEN_PROGRAM, U64_MAX, uint, type BuildSwap, type EstimateCollateralRoute, type MimirCluster,
  type PreparedCollateralPurchase, type SizedCollateralRoute } from './collateral-quote.js';

function tokenAmount(
  accountValue: MimirBetaAccount | null,
  authority: Address,
  mint: Address,
  name: string
): bigint {
  if (!accountValue) return 0n;
  const token = decodeMimirBetaSplTokenAccount(accountValue, TOKEN_PROGRAM);
  if (token.owner !== authority || token.mint !== mint) throw new Error(`${name} is not the expected wallet token account`);
  return token.amount;
}

function littleEndian(bytes: Uint8Array, offset: number, length: number): bigint {
  let value = 0n;
  for (let i = length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[offset + i]!);
  return value;
}

export function sameInstructions(
  left: PreparedCollateralPurchase['transaction']['instructions'],
  right: PreparedCollateralPurchase['transaction']['instructions']
): boolean {
  return left.length === right.length && left.every((instruction, index) => {
    const other = right[index];
    return other !== undefined && instruction.programAddress === other.programAddress &&
      instruction.accounts.length === other.accounts.length &&
      instruction.accounts.every((account, accountIndex) => {
        const otherAccount = other.accounts[accountIndex];
        return otherAccount !== undefined && account.address === otherAccount.address &&
          account.isSigner === otherAccount.isSigner && account.isWritable === otherAccount.isWritable;
      }) && instruction.data.length === other.data.length &&
      instruction.data.every((byte, byteIndex) => byte === other.data[byteIndex]);
  });
}

async function validatePreparedRoute(args: {
  readonly prepared: PreparedCollateralPurchase;
  readonly authority: Address;
  readonly collateralMint: Address;
  readonly collateralTokenAccount: Address;
  readonly sourceTokenAccount: Address;
  readonly shortfallRaw: bigint;
  readonly maxInputLamports: bigint;
}): Promise<SizedCollateralRoute> {
  const transaction = args.prepared.transaction;
  if (transaction.feePayer !== args.authority || transaction.requiredSigners.length !== 1 ||
      transaction.requiredSigners[0] !== args.authority || args.prepared.sourceTokenAccount !== args.sourceTokenAccount ||
      args.prepared.collateralTokenAccount !== args.collateralTokenAccount || transaction.instructions.length !== 5) {
    throw new Error('Automatic purchase renewal instructions are invalid; prepare an ordinary fresh review');
  }
  const route = transaction.instructions[4]!;
  if (route.programAddress !== JUPITER_PROGRAM || route.data.length < 30) {
    throw new Error('Automatic purchase renewal route is invalid; prepare an ordinary fresh review');
  }
  const inputLamports = littleEndian(route.data, 8, 8);
  const quotedOutputRaw = littleEndian(route.data, 16, 8);
  const slippageBps = Number(littleEndian(route.data, 24, 2));
  const threshold = quotedOutputRaw * BigInt(10_000 - slippageBps) / 10_000n;
  const validated = await validateJupiterCollateralBuild({
    inputMint: SOL_QUOTE_MINT,
    outputMint: args.collateralMint,
    inAmount: inputLamports.toString(),
    outAmount: quotedOutputRaw.toString(),
    otherAmountThreshold: threshold.toString(),
    slippageBps,
    otherInstructions: [],
    tipInstruction: null,
    swapInstruction: {
      programId: route.programAddress,
      accounts: route.accounts.map((account) => ({ pubkey: account.address,
        isSigner: account.isSigner, isWritable: account.isWritable })),
      data: base64(route.data)
    }
  }, {
    authority: args.authority,
    collateralMint: args.collateralMint,
    collateralTokenAccount: args.collateralTokenAccount,
    requiredOutputRaw: args.shortfallRaw,
    maxInputLamports: args.maxInputLamports,
    slippageBps: SLIPPAGE_BPS
  });
  if (validated.inputLamports !== args.prepared.inputLamports ||
      validated.minimumOutputRaw !== args.prepared.minimumOutputRaw ||
      validated.minimumOutputRaw < args.shortfallRaw ||
      !sameInstructions(transaction.instructions, validated.instructions)) {
    throw new Error('Automatic purchase renewal instructions changed; prepare an ordinary fresh review');
  }
  assertMessageInput(transaction, args.authority, args.sourceTokenAccount, validated.inputLamports);
  return Object.freeze({ instructions: transaction.instructions, inputLamports: validated.inputLamports,
    minimumOutputRaw: validated.minimumOutputRaw });
}

/** The confirmed network fee of a purchase message, priced as `prepareCollateralPurchase` prices it. */
export async function purchaseNetworkFeeLamports(rpc: MimirBetaPlanningRpc, authority: Address,
  instructions: PreparedCollateralPurchase['transaction']['instructions']): Promise<bigint> {
  if (rpc.getFeeForMessage === undefined) throw new Error('Exact purchase fee lookup is unavailable');
  const block = object(rpcContext(await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value, 'Confirmed blockhash');
  if (typeof block.blockhash !== 'string') throw new Error('Confirmed blockhash is malformed');
  const transaction = await compileMimirBetaTransactionV1({ feePayer: authority, recentBlockhash: block.blockhash,
    lastValidBlockHeight: uint(block.lastValidBlockHeight, 'last valid block height'),
    instructions: [mimirComputeUnitLimitInstruction(PURCHASE_COMPUTE_UNIT_LIMIT), ...instructions] });
  const fee = (await quoteTxV1Fee(rpc as never, transaction, { commitment: 'confirmed' })).value;
  if (fee === null) throw new Error('Confirmed purchase fee is unavailable');
  return uint(fee, 'network fee');
}

export async function prepareCollateralPurchase(args: {
  readonly cluster: MimirCluster;
  readonly rpc: MimirBetaPlanningRpc;
  readonly authority: Address;
  readonly collateralMint: Address;
  readonly collateralTokenAccount: Address;
  readonly decimals: number;
  readonly shortfallRaw: bigint;
  readonly draftHash: string;
  readonly observedBalanceRaw: bigint;
  readonly accountMissing: boolean;
  readonly costs: MimirBetaFundingCosts;
  /** The automatic first price after CREATE, kept with the payer's rent-exempt minimum. */
  readonly firstPriceLamports?: bigint;
  readonly fundingContext?: SolCreationContext;
  readonly fingerprints: unknown;
  readonly buildSwap?: BuildSwap;
  readonly existingPreparedPurchase?: PreparedCollateralPurchase;
  readonly estimateRoute?: EstimateCollateralRoute | undefined;
}): Promise<PreparedCollateralPurchase> {
  const context = args.fundingContext ?? new SolCreationContext();
  context.costs(args.costs);
  args = { ...args, rpc: context.rpc(args.rpc) };
  if (args.rpc.getFeeForMessage === undefined) {
    throw new Error('Exact purchase fee or account rent lookup is unavailable');
  }
  if (!args.buildSwap || args.shortfallRaw <= 0n || args.collateralMint === SOL_QUOTE_MINT) {
    throw new Error('SOL collateral purchase context is invalid');
  }
  const sourceTokenAccount = await associatedTokenAddress(args.authority, SOL_QUOTE_MINT);
  const expectedCollateral = await associatedTokenAddress(args.authority, args.collateralMint);
  if (expectedCollateral !== args.collateralTokenAccount) throw new Error('SDK collateral account differs from the canonical wallet ATA');

  const accountContext = await new FinalizedRpcReader(args.rpc, 'confirmed').accounts(
    [args.authority, sourceTokenAccount, expectedCollateral], args.costs.observedSlot
  );
  const [payerBefore, sourceBeforeAccount, collateralBeforeAccount] = accountContext.value;
  if (accountContext.value.length === 3 && !payerBefore) throw new InsufficientSolError(args.costs.totalLamports + PROBE_LAMPORTS, 0n);
  if (accountContext.value.length !== 3 || accountContext.slot < args.costs.observedSlot || !payerBefore || payerBefore.executable || payerBefore.data.length !== 0 ||
      payerBefore.owner !== address('11111111111111111111111111111111')) throw new Error('Confirmed wallet evidence is invalid');
  const sourceBefore = tokenAmount(sourceBeforeAccount, args.authority, SOL_QUOTE_MINT, 'WSOL account');
  const collateralBefore = tokenAmount(collateralBeforeAccount, args.authority, args.collateralMint, 'COLA account');
  if (collateralBefore !== args.observedBalanceRaw || (collateralBeforeAccount === null) !== args.accountMissing ||
      args.shortfallRaw <= 0n || args.costs.totalLamports > U64_MAX) {
    throw new Error('Confirmed COLA balance differs from the SDK funding facts');
  }
  const [rentValue, baseRent] = await Promise.all([
    sourceBeforeAccount && collateralBeforeAccount ? 0n : readRentExemptLamports(args.rpc, 165n),
    readRentExemptLamports(args.rpc, 0n)
  ]);
  const ataRentLamports = rentValue * BigInt(Number(sourceBeforeAccount === null) + Number(collateralBeforeAccount === null));
  const remainingCreationLamports = args.costs.totalLamports;
  const keptLamports = baseRent + (args.firstPriceLamports ?? 0n);
  const maxInputLamports = payerBefore.lamports - remainingCreationLamports - keptLamports - ataRentLamports;
  if (maxInputLamports < PROBE_LAMPORTS) throw new InsufficientSolError(remainingCreationLamports + keptLamports + ataRentLamports + PROBE_LAMPORTS, payerBefore.lamports);

  const existing = args.existingPreparedPurchase;
  if (existing && (
    existing.cluster !== args.cluster || existing.authority !== args.authority ||
    existing.collateralMint !== args.collateralMint || existing.collateralTokenAccount !== expectedCollateral ||
    existing.decimals !== args.decimals || existing.shortfallRaw !== args.shortfallRaw ||
    existing.draftHash !== args.draftHash || existing.observedBalanceRaw !== args.observedBalanceRaw ||
    existing.accountMissing !== args.accountMissing ||
    JSON.stringify(existing.fingerprints) !== JSON.stringify(args.fingerprints) ||
    existing.remainingCreationLamports !== remainingCreationLamports || existing.ataRentLamports !== ataRentLamports
  )) throw new Error('Automatic purchase renewal facts changed; prepare an ordinary fresh review');

  const estimate = existing ? undefined : args.estimateRoute;
  const rate = estimate && estimate.expiresAt > Date.now() && estimate.authority === args.authority &&
    estimate.collateralMint === args.collateralMint && estimate.collateralTokenAccount === expectedCollateral &&
    estimate.inputLamports <= maxInputLamports ? estimate : undefined;
  const fresh = rate && rate.shortfallRaw === args.shortfallRaw && rate.minimumOutputRaw >= args.shortfallRaw
    ? () => prepareCollateralPurchase({ ...args, estimateRoute: undefined }) : undefined;
  const route = existing
    ? await validatePreparedRoute({ prepared: existing, authority: args.authority, collateralMint: args.collateralMint,
        collateralTokenAccount: expectedCollateral, sourceTokenAccount, shortfallRaw: args.shortfallRaw, maxInputLamports })
    : fresh ? estimate! : await sizeCollateralPurchaseQuote({ buildSwap: args.buildSwap, authority: args.authority, collateralMint: args.collateralMint,
        collateralTokenAccount: expectedCollateral, shortfallRaw: args.shortfallRaw, maxInputLamports, rate });
  if (!route) throw new Error('COLA purchase route is unavailable');

  const blockhashResponse = rpcContext(await args.rpc.getLatestBlockhash(confirmedFrom(accountContext.slot)).send());
  const blockhashValue = object(blockhashResponse.value, 'Confirmed blockhash');
  if (typeof blockhashValue.blockhash !== 'string') throw new Error('Confirmed blockhash is malformed');
  const recentBlockhash = blockhashValue.blockhash;
  const lastValidBlockHeight = uint(blockhashValue.lastValidBlockHeight, 'last valid block height');
  if (blockhashResponse.slot < accountContext.slot) throw new MimirBetaError('RPC_CONTEXT_MISMATCH', 'Confirmed blockhash context regressed');
  const priced = async (computeUnitLimit?: number, simulated?: { simulationSlot: bigint }) => {
    const transaction = await compileMimirBetaTransactionV1({ feePayer: args.authority, recentBlockhash, lastValidBlockHeight,
      instructions: computeUnitLimit === undefined ? route.instructions : [mimirComputeUnitLimitInstruction(computeUnitLimit), ...route.instructions] });
    assertMessageInput(transaction, args.authority, sourceTokenAccount, route.inputLamports);
    if (transaction.feePayer !== args.authority || transaction.requiredSigners.length !== 1 ||
        transaction.requiredSigners[0] !== args.authority) throw new Error('Purchase transaction admits an unsupported signer');

    const feeQuote = await quoteTxV1Fee(args.rpc as never, transaction, confirmedFrom(blockhashResponse.slot) as never);
    const feeResponse = { slot: feeQuote.context.slot, value: feeQuote.value };
    if (feeResponse.slot < blockhashResponse.slot) throw new MimirBetaError('RPC_CONTEXT_MISMATCH', 'Confirmed purchase fee context regressed');
    if (feeResponse.value === null) throw new Error('Confirmed purchase fee is unavailable');
    const networkFeeLamports = uint(feeResponse.value, 'network fee');
    if (existing && networkFeeLamports !== existing.networkFeeLamports) {
      throw new Error('Automatic purchase renewal fee changed; prepare an ordinary fresh review');
    }
    if (route.inputLamports + networkFeeLamports + ataRentLamports + remainingCreationLamports + keptLamports > payerBefore.lamports) {
      throw new InsufficientSolError(route.inputLamports + networkFeeLamports + ataRentLamports + remainingCreationLamports + keptLamports, payerBefore.lamports);
    }
    if (simulated) return { transaction, networkFeeLamports, simulationSlot: simulated.simulationSlot, unitsConsumed: null };

    const simulation = object(await args.rpc.simulateTransaction(base64(transaction.serializedTransaction), {
      commitment: 'confirmed', encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false,
      minContextSlot: feeResponse.slot, accounts: { addresses: [args.authority, sourceTokenAccount, expectedCollateral], encoding: 'base64' }
    }).send(), 'Purchase simulation');
    const simulationContext = object(simulation.context, 'Simulation context');
    const simulationSlot = uint(simulationContext.slot, 'simulation slot');
    const value = object(simulation.value, 'Simulation result');
    if (value.err !== null && fresh) return undefined;
    if (value.err !== null || simulationSlot < feeResponse.slot || !Array.isArray(value.accounts) || value.accounts.length !== 3) {
      throw new Error('Exact purchase simulation failed or returned incomplete accounts');
    }
    const payerAfter = simulationAccount(args.authority, value.accounts[0]);
    const sourceAfterAccount = simulationAccount(sourceTokenAccount, value.accounts[1]);
    const collateralAfterAccount = simulationAccount(expectedCollateral, value.accounts[2]);
    if (!payerAfter || payerAfter.lamports < remainingCreationLamports + keptLamports || !sourceAfterAccount || !collateralAfterAccount) {
      throw new Error('Purchase simulation does not preserve the creation reserve and token accounts');
    }
    const sourceAfter = tokenAmount(sourceAfterAccount, args.authority, SOL_QUOTE_MINT, 'Simulated WSOL account');
    const collateralAfter = tokenAmount(collateralAfterAccount, args.authority, args.collateralMint, 'Simulated COLA account');
    const sourceKept = sourceBeforeAccount
      ? sourceAfterAccount.lamports === sourceBeforeAccount.lamports && sourceAfter >= sourceBefore : sourceAfter === 0n;
    if (sourceKept && collateralAfter - collateralBefore < route.minimumOutputRaw && fresh) return undefined;
    if (!sourceKept || collateralAfter - collateralBefore < route.minimumOutputRaw) {
      throw new Error('Purchase simulation does not guarantee the reviewed COLA minimum');
    }
    return { transaction, networkFeeLamports, simulationSlot,
      unitsConsumed: value.unitsConsumed == null ? null : uint(value.unitsConsumed, 'simulated compute units') };
  };
  const ceiling = await priced(existing?.transaction.config.computeUnitLimit);
  const limit = ceiling && !existing ? tightComputeUnitLimit(ceiling.unitsConsumed, ceiling.transaction.config.computeUnitLimit) : undefined;
  const exact = limit === undefined || limit === ceiling!.transaction.config.computeUnitLimit ? ceiling : await priced(limit, ceiling!);
  if (!exact) return fresh!();
  const { transaction, networkFeeLamports, simulationSlot } = exact;
  return Object.freeze({ transaction, cluster: args.cluster, authority: args.authority, collateralMint: args.collateralMint,
    collateralTokenAccount: expectedCollateral, sourceTokenAccount, decimals: args.decimals,
    shortfallRaw: args.shortfallRaw, draftHash: args.draftHash, inputLamports: route.inputLamports, minimumOutputRaw: route.minimumOutputRaw,
    observedBalanceRaw: args.observedBalanceRaw, accountMissing: args.accountMissing,
    networkFeeLamports, ataRentLamports, remainingCreationLamports, simulationSlot,
    fingerprints: args.fingerprints });
}
