import assert from "node:assert/strict";
import { base64 } from "../src/beta/bytes.js";
import { prepareReview } from "../src/beta/creation.js";
import { MimirBetaSimulationError, MimirBetaStalePreparationError } from "../src/beta/errors.js";
import type { MimirBetaAccount } from "../src/beta/types.js";
import { fixtureAddress, makeBetaCaptureFixture } from "./fixtures/betaCaptureFixtures.js";

const fixture = await makeBetaCaptureFixture("raydium-clmm", { seed: 611 });
const clmm = { ...fixture.poolAccount, lamports: 1n } as MimirBetaAccount, at = clmm.address;
const program = fixtureAddress(77), authority = fixtureAddress(78);
const tick = (shift: number) => { const data = clmm.data.slice(), v = new DataView(data.buffer); v.setInt32(269, v.getInt32(269, true) + shift * v.getUint16(235, true) * 60, true); return data; };
const rpcAccount = (data: Uint8Array) => ({ owner: clmm.owner, executable: false, lamports: 1, data: [base64(data), "base64"] });
const rpc = (data: Uint8Array) => ({
  getLatestBlockhash: () => ({ send: async () => ({ context: { slot: 100 }, value: { blockhash: fixtureAddress(80), lastValidBlockHeight: 10n } }) }),
  getMultipleAccounts: (addresses: readonly unknown[]) => ({ send: async () => ({ context: { slot: 100 }, value: addresses.map(() => rpcAccount(data)) }) }),
  simulateTransaction: () => ({ send: async () => ({ context: { slot: 100 }, value: { err: { InstructionError: [0, { Custom: 46 }] },
    logs: [`Program ${program} invoke [1]`, `Program ${program} failed: custom program error: 0x2e`], accounts: null } }) }),
});
const review = (data: Uint8Array) => prepareReview({
  dependencies: { rpc: rpc(data), deployment: { cluster: "devnet", mimirProgramId: program } } as never,
  contextSlot: 100n, draftHash: "00", plan: { authority, cluster: "devnet", programId: program } as never, step: { stepId: "s" } as never,
  instructions: [{ programAddress: program, accounts: [{ address: at, isSigner: false, isWritable: false }], data: Uint8Array.of(87) }] as never,
  specs: [{ kind: "account-unchanged", address: at }] as never, target: {} as never, observedRows: new Map([[at, clmm]]),
});
await assert.rejects(() => review(tick(1)), (error) => error instanceof MimirBetaStalePreparationError &&
  error.code === "PREPARATION_STALE" && error.reason === "source-drift" && error.address === at);
await assert.rejects(() => review(tick(0)), (error) => error instanceof MimirBetaSimulationError &&
  !(error instanceof MimirBetaStalePreparationError) && error.customCode === 46);
console.log("creationReviewCustom46: ok");
