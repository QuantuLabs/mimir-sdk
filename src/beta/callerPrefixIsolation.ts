import type { Address } from "@solana/addresses";
import type { MimirBetaCallerPrefixRefusal } from "./errors.js";
import { MIMIR_BETA_COMPUTE_BUDGET_PROGRAM_ID } from "./liveAbi.js";

export const LIGHTHOUSE_ASSERTION_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

type PrefixIsolationInstruction = Readonly<{ programAddress: Address; accounts: readonly Readonly<{ address: Address; isSigner: boolean; isWritable: boolean }>[] }>;

/**
 * First isolation breach of caller-prefix instructions against the core they lead, or null, with roles taken message-wide: a signer other
 * than the authority or any reference to a core signer, the Mimir, ComputeBudget or Lighthouse program as a prefix program or account, a
 * prefix-writable account the core references, or a read-only reference to an account the core writes; the authority, the declared funding
 * token account and the read-only burn mints excepted.
 */
export function mimirBetaCallerPrefixViolationV1(args: Readonly<{ authority: Address; programId: Address; fundingTokenAccount: Address | null;
  /** Core-written keys the prefix may still reference read-only: the burn mints. */
  readonlyCoreAccounts?: readonly Address[];
  prefix: readonly PrefixIsolationInstruction[]; core: readonly PrefixIsolationInstruction[] }>):
  Readonly<{ reason: Extract<MimirBetaCallerPrefixRefusal, "foreign-signer" | "reserved-program" | "core-account-overlap">; address: Address }> | null {
  const reserved = new Set<string>([args.programId, MIMIR_BETA_COMPUTE_BUDGET_PROGRAM_ID, LIGHTHOUSE_ASSERTION_PROGRAM]);
  const coreAccounts = args.core.flatMap((instruction) => instruction.accounts);
  const core = new Set<string>([...args.core.map(({ programAddress }) => programAddress), ...coreAccounts.map(({ address }) => address)]);
  const coreSigners = new Set<string>(coreAccounts.filter(({ isSigner }) => isSigner).map(({ address }) => address));
  const coreWritable = new Set<string>(coreAccounts.filter(({ isWritable }) => isWritable).map(({ address }) => address));
  for (const instruction of args.prefix) {
    const reservedKey = [instruction.programAddress, ...instruction.accounts.map(({ address }) => address)].find((key) => reserved.has(key));
    if (reservedKey) return { reason: "reserved-program", address: reservedKey };
    for (const account of instruction.accounts) {
      if (account.address === args.authority) continue;
      if (account.isSigner || coreSigners.has(account.address)) return { reason: "foreign-signer", address: account.address };
      if (account.address !== args.fundingTokenAccount && (account.isWritable ? core.has(account.address)
        : coreWritable.has(account.address) && !args.readonlyCoreAccounts?.includes(account.address))) {
        return { reason: "core-account-overlap", address: account.address };
      }
    }
  }
  return null;
}
