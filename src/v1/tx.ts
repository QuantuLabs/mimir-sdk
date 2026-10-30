import { address, type Address } from "@solana/kit";
import { AccountRole, type Instruction } from "@solana/instructions";
import { blockhash } from "@solana/rpc-types";
import { compileTransaction, getTransactionEncoder } from "@solana/transactions";
import { MimirBetaError } from "../beta/errors.js";
import { brand } from "../brand.js";
import type { MimirBetaAdminContext } from "../beta/context.js";
import type { MimirBetaInstruction } from "../beta/types.js";
import {
  MIMIR_BETA_TRANSACTION_V1_CONFIG, MIMIR_BETA_TRANSACTION_V1_MAX_ACCOUNTS, MIMIR_BETA_TRANSACTION_V1_MAX_BYTES,
  mimirBetaMinPriorityFeeLamports, normalizeMimirBetaComputeBudgetV1,
} from "../beta/transactionV1.js";
import {
  buildMimirV1CreateBeginInstruction, buildMimirV1CreateClassicInstruction, buildMimirV1CreateCompositeInstruction, buildMimirV1GrowInstruction,
  MIMIR_V1_CREATE_MODE, MIMIR_V1_MAX_CREATE_LEN,
  type MimirV1ClassicDefinition, type MimirV1CompositeParams, type MimirV1CreateClassicAccounts, type MimirV1CreateCompositeAccounts, type MimirV1CreateHead,
} from "./build.js";

/** A shape whose single creation transaction exceeds Transaction v1 (4,096 B or 64 keys). */
export class MimirV1CreationTooLargeError extends MimirBetaError {
  constructor(readonly bytes: number | undefined, readonly keys: number) {
    super("CREATION_TOO_LARGE", `V1 creation transaction is ${bytes ?? "unserializable"} B / ${keys} keys; Transaction v1 allows ${MIMIR_BETA_TRANSACTION_V1_MAX_BYTES} B / ${MIMIR_BETA_TRANSACTION_V1_MAX_ACCOUNTS} keys`);
    this.name = "MimirV1CreationTooLargeError";
  }
}
brand("@quantulabs/mimir-sdk/v1:MimirV1CreationTooLargeError", MimirV1CreationTooLargeError);

const MEASURE_BLOCKHASH = "11111111111111111111111111111111";

function kitInstruction(i: MimirBetaInstruction): Instruction {
  return { programAddress: address(i.programAddress), data: new Uint8Array(i.data), accounts: i.accounts.map((m) => ({
    address: address(m.address),
    role: m.isSigner ? (m.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER) : (m.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY),
  })) };
}

/** `bytes` is absent when the key count alone already exceeds 64 (Kit refuses to serialize it). */
export interface MimirV1TransactionSize { readonly bytes?: number; readonly keys: number; readonly fits: boolean }

/**
 * Exact Transaction v1 size: the same message `compileMimirBetaTransactionV1` signs (ComputeBudget folded into config,
 * floor priority fee, unsigned 64-B signature slots), serialized by Kit. Uncapped, so an oversized shape still measures.
 */
export function measureMimirV1Transaction(feePayer: Address, instructions: readonly MimirBetaInstruction[]): MimirV1TransactionSize {
  const budget = normalizeMimirBetaComputeBudgetV1(instructions);
  const keys = new Set<string>([feePayer]);
  for (const i of budget.instructions) { keys.add(i.programAddress); for (const m of i.accounts) keys.add(m.address); }
  if (keys.size > MIMIR_BETA_TRANSACTION_V1_MAX_ACCOUNTS) return { keys: keys.size, fits: false };
  const computeUnitLimit = budget.computeUnitLimit ?? MIMIR_BETA_TRANSACTION_V1_CONFIG.computeUnitLimit;
  const floor = mimirBetaMinPriorityFeeLamports(computeUnitLimit);
  const fee = budget.priorityFeeLamports !== undefined && budget.priorityFeeLamports > floor ? budget.priorityFeeLamports : floor;
  const transaction = compileTransaction({
    version: 1, feePayer: { address: address(feePayer) },
    lifetimeConstraint: { blockhash: blockhash(MEASURE_BLOCKHASH), lastValidBlockHeight: 0n },
    instructions: budget.instructions.map(kitInstruction),
    config: { computeUnitLimit,
      loadedAccountsDataSizeLimit: budget.loadedAccountsDataSizeLimit ?? MIMIR_BETA_TRANSACTION_V1_CONFIG.loadedAccountsDataSizeLimit,
      ...(budget.heapSize !== undefined ? { heapSize: budget.heapSize } : {}), priorityFeeLamports: fee },
  } as Parameters<typeof compileTransaction>[0]);
  const bytes = getTransactionEncoder().encode(transaction).length;
  return { bytes, keys: keys.size, fits: bytes <= MIMIR_BETA_TRANSACTION_V1_MAX_BYTES && keys.size <= MIMIR_BETA_TRANSACTION_V1_MAX_ACCOUNTS };
}

/** Domain rule: a shape is creatable iff its single creation tx fits Transaction v1; else `CREATION_TOO_LARGE`. */
export function assertMimirV1Creatable(feePayer: Address, instructions: readonly MimirBetaInstruction[]): MimirV1TransactionSize {
  const size = measureMimirV1Transaction(feePayer, instructions);
  if (!size.fits) throw new MimirV1CreationTooLargeError(size.bytes, size.keys);
  return size;
}

export interface MimirV1CreationPlan {
  readonly instructions: readonly MimirBetaInstruction[];
  readonly grows: number;
  readonly size: MimirV1TransactionSize;
}

/**
 * The one creation transaction: final len ≤ 10,240 → SINGLE; otherwise BEGIN (10,240) + GROW × k + SEAL, all in one tx
 * so a CONSTRUCTING account never outlives it. `prefix` (e.g. a ComputeBudget ix) leads the tx. Refuses `CREATION_TOO_LARGE`.
 */
function planCreation(a: Readonly<{
  tag: 93 | 95; programId: Address; payer: Address; target: Address; adminConfig: Address; registry: Address;
  head: MimirV1CreateHead; finalLen: number; feedId: Address; prefix?: readonly MimirBetaInstruction[];
  build: (mode: typeof MIMIR_V1_CREATE_MODE.SINGLE | typeof MIMIR_V1_CREATE_MODE.SEAL) => MimirBetaInstruction;
}>): MimirV1CreationPlan {
  const body: MimirBetaInstruction[] = [];
  if (a.finalLen <= MIMIR_V1_MAX_CREATE_LEN) {
    body.push(a.build(MIMIR_V1_CREATE_MODE.SINGLE));
  } else {
    body.push(buildMimirV1CreateBeginInstruction({ ...a, targetLen: a.finalLen }));
    for (let len = MIMIR_V1_MAX_CREATE_LEN; len < a.finalLen;) {
      len = Math.min(len + MIMIR_V1_MAX_CREATE_LEN, a.finalLen);
      body.push(buildMimirV1GrowInstruction({ programId: a.programId, payer: a.payer, target: a.target, newLen: len }));
    }
    body.push(a.build(MIMIR_V1_CREATE_MODE.SEAL));
  }
  const instructions = [...(a.prefix ?? []), ...body];
  return { instructions, grows: body.length === 1 ? 0 : body.length - 2, size: assertMimirV1Creatable(a.payer, instructions) };
}

type PlanArgs = Readonly<{ head: MimirV1CreateHead; colaAmountRaw: bigint; finalLen: number; feedId: Address; prefix?: readonly MimirBetaInstruction[] }>;

export function planMimirV1ClassicCreation(a: MimirV1CreateClassicAccounts & PlanArgs & Readonly<{ definition: MimirV1ClassicDefinition }>): MimirV1CreationPlan {
  return planCreation({ ...a, tag: 93, target: a.feed, build: (mode) => buildMimirV1CreateClassicInstruction({ ...a, mode }) });
}

/** `admin`: the decoded AdminConfig `colaAmountRaw` and the activation fees were priced from; its revision is signed into the data. */
export function planMimirV1CompositeCreation(a: MimirV1CreateCompositeAccounts & PlanArgs & Readonly<{
  params: MimirV1CompositeParams; admin: Pick<MimirBetaAdminContext, "configRevision">;
}>): MimirV1CreationPlan {
  return planCreation({ ...a, tag: 95, target: a.composite,
    build: (mode) => buildMimirV1CreateCompositeInstruction({ ...a, mode, expectedAdminConfigRevision: a.admin.configRevision }) });
}

/** All-new composites (I-7): each child is its own creation tx, then the composite; every tx must fit on its own. */
export function planMimirV1StagedCompositeCreation(a: Readonly<{
  feePayer: Address; childTransactions: readonly (readonly MimirBetaInstruction[])[]; compositeTransaction: readonly MimirBetaInstruction[];
}>): readonly (readonly MimirBetaInstruction[])[] {
  const txs = [...a.childTransactions, a.compositeTransaction];
  for (const tx of txs) assertMimirV1Creatable(a.feePayer, tx);
  return txs;
}
