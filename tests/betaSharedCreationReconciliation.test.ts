import assert from "node:assert/strict";
import fs from "node:fs";
import bs58 from "bs58";
import { observeMimirBetaConfirmedReceipt, observeMimirBetaReceipt } from "../src/beta/reconciliation.js";
import type { MimirBetaStageReceipt } from "../src/beta/review.js";

type Run = { receipt: MimirBetaStageReceipt; transaction: any; accounts: any };

const revive = (_key: string, value: any) => value?.$mimir === "bigint" ? BigInt(value.value)
  : value?.$mimir === "bytes" ? Uint8Array.from(value.value) : value;
// Shared fixture has synthetic 12-byte ticker postconditions/hash bindings; not a new transaction capture.
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/sharedCreationReconciliation.json", import.meta.url), "utf8"), revive) as Record<string, Run>;
const collection = "DbjsWo7iUs7QZyJxLgNyVxvAAjQZCXroJHoGok8h8Umg";
const mint = "CoLAyH8CRuBLyr2BRDozka3dJ5XH97BSa6WpZL9NAqWL";
const feedOf = (run: Run) => run.receipt.reviewedStep.step.expectedWrites
  .find((write: any) => write.proof.kind === "account" && write.proof.after.data?.codec === "classic-feed-v1")!.address;
const burnPerCreation = 10_000_000_000_000n;
const liveSupply = 1010142043503199018n;

type Tamper = {
  creations?: number;
  accounts?: (address: string, entry: any, data: Buffer) => Buffer | void;
  transaction?: (transaction: any) => void;
};

function observe(name: string, tamper: Tamper = {}, confirmed = false) {
  const run = fixture[name]!;
  const creations = tamper.creations ?? 2;
  const transaction = structuredClone(run.transaction);
  tamper.transaction?.(transaction);
  const rpc = {
    getTransaction: () => ({ send: async () => structuredClone(transaction) }),
    getMultipleAccounts: (addresses: readonly string[]) => ({ send: async () => {
      const response = structuredClone(run.accounts);
      response.value.forEach((entry: any, index: number) => {
        const data = Buffer.from(entry.data[0], "base64");
        if (addresses[index] === collection) {
          data.writeUInt32LE(1509 + creations, 60); data.writeUInt32LE(1431 + creations, 64);
        }
        if (addresses[index] === mint) data.writeBigUInt64LE(liveSupply + BigInt(2 - creations) * burnPerCreation, 36);
        entry.data = [(tamper.accounts?.(addresses[index]!, entry, data) ?? data).toString("base64"), "base64"];
      });
      return response;
    } }),
  };
  return (confirmed ? observeMimirBetaConfirmedReceipt : observeMimirBetaReceipt)({ rpc: rpc as never, receipt: run.receipt });
}

for (const name of ["qa2", "qa3"]) {
  for (const creations of [1, 2, 3]) {
    const observation = await observe(name, { creations });
    assert.equal(observation.state, "finalized", `${name} after ${creations} creations`);
  }
}

const burnOuter = (transaction: any) => transaction.meta.innerInstructions.find((group: any) => group.index === 4);
await assert.rejects(() => observe("qa2", { transaction: (transaction) => {
  const group = burnOuter(transaction); group.instructions = group.instructions.filter((entry: any) => entry.programIdIndex !== 27);
} }), /BurnChecked CPI proof/);
await assert.rejects(() => observe("qa2", { transaction: (transaction) => {
  const burn = burnOuter(transaction).instructions.find((entry: any) => entry.programIdIndex === 27);
  const data = Buffer.from(bs58.decode(burn.data)); data.writeBigUInt64LE(burnPerCreation - 1n, 1);
  burn.data = bs58.encode(data);
} }), /BurnChecked CPI proof/);
await assert.rejects(() => observe("qa2", { transaction: (transaction) => {
  const group = transaction.meta.innerInstructions.find((entry: any) => entry.index === 0);
  group.instructions = group.instructions.filter((entry: any) => entry.programIdIndex !== 22);
} }), /Core asset creation/);
await assert.rejects(() => observe("qa2", { accounts: (address, entry) => {
  if (address === collection) entry.owner = "11111111111111111111111111111111";
} }), /shared account owner\/layout/);
await assert.rejects(() => observe("qa2", { accounts: (address, entry) => {
  if (address === mint) entry.owner = "11111111111111111111111111111111";
} }), /shared account owner\/layout/);
await assert.rejects(() => observe("qa2", { accounts: (address, _entry, data) => {
  if (address === collection) return Buffer.concat([data, Buffer.of(0)]);
} }), /shared account owner\/layout/);
await assert.rejects(() => observe("qa2", { accounts: (address, _entry, data) => {
  if (address === collection) data[0] = 1;
} }), /shared account owner\/layout/);
await assert.rejects(() => observe("qa2", { accounts: (address, _entry, data) => {
  if (address === mint) data[44] = 6;
} }), /shared burn mint layout/);
for (const name of ["qa2", "qa3"]) {
  const feed = feedOf(fixture[name]!);
  await assert.rejects(() => observe(name, { accounts: (address, _entry, data) => {
    if (address === feed) data[data.length - 1] ^= 1;
  } }), /postcondition|SDK codec rejected/);
}

const creatorOf = (run: Run) => run.receipt.reviewedStep.step.expectedWrites.find((write: any) => write.proof.kind === "spl-token-burn-checked")!.proof as any;
const sameWalletLater = (name: string) => {
  const burn = creatorOf(fixture[name]!);
  return { accounts: (address: string, entry: any, data: Buffer) => {
    if (address === burn.sourceTokenAccount) data.writeBigUInt64LE(data.readBigUInt64LE(64) - burnPerCreation, 64);
    if (address === burn.authority) entry.lamports -= 30_000_000;
  } } satisfies Tamper;
};
const sameWalletEarlier = (transaction: any) => {
  for (const balances of [transaction.meta.preTokenBalances, transaction.meta.postTokenBalances]) {
    const entry = balances.find((balance: any) => balance.mint === mint);
    entry.uiTokenAmount.amount = (BigInt(entry.uiTokenAmount.amount) + burnPerCreation).toString();
  }
};
for (const name of ["qa2", "qa3"]) {
  assert.equal((await observe(name, sameWalletLater(name))).state, "finalized", `${name} then same-wallet creation`);
  assert.equal((await observe(name, { transaction: sameWalletEarlier })).state, "finalized", `same-wallet creation then ${name}`);
  assert.equal((await observe(name, { ...sameWalletLater(name), transaction: sameWalletEarlier })).state, "finalized", `${name} between same-wallet creations`);
}
await assert.rejects(() => observe("qa2", { transaction: (transaction) => {
  const entry = transaction.meta.postTokenBalances.find((balance: any) => balance.mint === mint);
  entry.uiTokenAmount.amount = (BigInt(entry.uiTokenAmount.amount) - 1n).toString();
} }), /aggregate BurnChecked token amount delta/);
await assert.rejects(() => observe("qa2", { accounts: (address, _entry, data) => {
  if (address === creatorOf(fixture.qa2!).sourceTokenAccount) data[0] ^= 1;
} }), /shared burn source layout|BurnChecked coherent source/);
await assert.rejects(() => observe("qa2", { accounts: (address, _entry, data) => {
  if (address === creatorOf(fixture.qa2!).sourceTokenAccount) data[32] ^= 1;
} }), /shared burn source layout|BurnChecked coherent source/);
await assert.rejects(() => observe("qa2", { accounts: (address, entry) => {
  if (address === creatorOf(fixture.qa2!).sourceTokenAccount) entry.owner = "11111111111111111111111111111111";
} }), /shared account owner\/layout/);

for (const name of ["qa2", "qa3"]) assert.equal((await observe(name, {}, true)).state, "confirmed");

console.log("beta shared creation reconciliation tests passed");
