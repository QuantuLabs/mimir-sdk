import assert from "node:assert/strict";
import fs from "node:fs";
import { assertRefreshableIdentity, observeMimirBetaReceipt } from "../src/beta/reconciliation.js";
import type { MimirBetaStageReceipt } from "../src/beta/review.js";
import { bytesAddress } from "../src/beta/bytes.js";

const revive = (_key: string, value: any) => value?.$mimir === "bigint" ? BigInt(value.value)
  : value?.$mimir === "bytes" ? Uint8Array.from(value.value) : value;
const load = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const composite = JSON.parse(load("compositeConcurrentReconciliation.json"));
// Shared fixture has synthetic 12-byte ticker postconditions/hash bindings; not a new transaction capture.
const classic = JSON.parse(load("sharedCreationReconciliation.json"), revive).qa2;

type Tamper = {
  accounts?: (address: string, entry: any, data: Buffer) => Buffer | void;
  transaction?: (transaction: any) => void;
};

const compositeConfig = "B1bZPFUkmYwLtA5QNu4QmDNGJZcmg7nRkssRpPUgJhnz";
const compositeRoot = "8EJKP5kGstzmpwrKMhp6h4cKXYW3kvVyvBg26CEbtujJ";
const classicSnapshot = "3BB1By89TfuwvNbC85NfbAhsWD9iEKFUB3dUozsD1xvE";
const classicRing = "CXHFrA5Aox9ePWbfVxPiyQa9wYxNwTjzyywB5nYsdYsU";
const classicTwap = "4iybp11VmD4L75aJbZDgdVfc8gEMgaqLT5StukGYD1xZ";

function rpcFor(transactionSource: any, accountsFor: (addresses: readonly string[]) => any, tamper: Tamper) {
  const transaction = structuredClone(transactionSource);
  tamper.transaction?.(transaction);
  return {
    getTransaction: () => ({ send: async () => structuredClone(transaction) }),
    getMultipleAccounts: (addresses: readonly string[]) => ({ send: async () => {
      const response = accountsFor(addresses);
      response.value.forEach((entry: any, index: number) => {
        if (entry === null) return;
        const data = Buffer.from(entry.data[0], "base64");
        entry.data = [(tamper.accounts?.(addresses[index]!, entry, data) ?? data).toString("base64"), "base64"];
      });
      return response;
    } }),
  };
}

function observeComposite(tamper: Tamper = {}, receiptJson = composite.receipt) {
  const byAddress = new Map<string, any>(composite.addresses.map((address: string, index: number) => [address, composite.accounts.value[index]]));
  const rpc = rpcFor(composite.transaction, (addresses) => ({ context: composite.accounts.context,
    value: addresses.map((address) => structuredClone(byAddress.get(address) ?? null)) }), tamper);
  const receipt = JSON.parse(JSON.stringify(receiptJson), revive) as MimirBetaStageReceipt;
  return observeMimirBetaReceipt({ rpc: rpc as never, receipt });
}

function observeClassic(tamper: Tamper = {}) {
  const rpc = rpcFor(classic.transaction, () => structuredClone(classic.accounts), tamper);
  return observeMimirBetaReceipt({ rpc: rpc as never, receipt: classic.receipt });
}

// The composite fixture is an inert pre-ABI-1 tag-65 receipt: the release reviewer refuses its route, so every observation rejects.
const inert = (label: string) => (error: Error) => /RECEIPT_MISMATCH/.test(error.message) || assert.fail(`${label}: ${error.message}`);
await assert.rejects(() => observeComposite(), inert("pre-ABI-1 composite receipt"));
await assert.rejects(() => observeComposite({}, JSON.parse(JSON.stringify(composite.receipt))), inert("reloaded pre-ABI-1 composite receipt"));

const refreshClassic: Tamper = { accounts: (address, entry, data) => {
  if (address === classicSnapshot) {
    data.writeBigUInt64LE(2n, 96);
    data.writeBigUInt64LE(data.readBigUInt64LE(116) + 40n, 116);
    data.writeBigUInt64LE(data.readBigUInt64LE(124) + 40n, 124);
  }
  if (address === classicRing) {
    for (const offset of [64, 72]) data.writeBigUInt64LE(data.readBigUInt64LE(offset) + 40n, offset);
    entry.lamports += 1;
  }
} };
assert.equal((await observeClassic(refreshClassic)).state, "finalized", "third-party Classic refresh before reconciliation");

await assert.rejects(() => observeClassic({ accounts: (address, entry) => {
  if (address === classicSnapshot) entry.owner = "11111111111111111111111111111111";
} }), /owner|postcondition/);
await assert.rejects(() => observeClassic({ accounts: (address, _entry, data) => {
  if (address === classicRing) data.fill(0, 16, 48);
} }), /postcondition|SDK codec rejected|native|layout/);

const byMagic = (magic: string, mutate: (data: Buffer) => void): Tamper => ({ accounts: (_address, _entry, data) => {
  if (data.subarray(0, 8).toString() === magic) mutate(data);
} });
const adversarial: readonly [string, "classic", string, (data: Buffer) => void][] = [
  ["snapshot-unsupported-version", "classic", "MIMIRSNP", (data) => data.writeUInt16LE(65535, 8)],
  ["snapshot-bad-header-length", "classic", "MIMIRSNP", (data) => data.writeUInt16LE(1, 10)],
  ["twap-unsupported-version", "classic", "MIMIRTWP", (data) => data.writeUInt16LE(65535, 8)],
  ["twap-bad-header-length", "classic", "MIMIRTWP", (data) => data.writeUInt16LE(1, 10)],
  ["ring-unsupported-version", "classic", "MIMIRRNG", (data) => data.writeUInt16LE(65535, 8)],
  ["ring-bad-header-length", "classic", "MIMIRRNG", (data) => data.writeUInt16LE(1, 10)],
  ["snapshot-foreign-config", "classic", "MIMIRSNP", (data) => data.fill(7, 48, 80)],
  ["snapshot-foreign-plan", "classic", "MIMIRSNP", (data) => { data[262] ^= 1; }],
  ["twap-foreign-plan", "classic", "MIMIRTWP", (data) => { data[192] ^= 1; }],
  ["ring-foreign-source-config", "classic", "MIMIRRNG", (data) => data.fill(7, 216, 248)],
  ["ring-foreign-pool", "classic", "MIMIRRNG", (data) => data.fill(7, 248, 280)],
  ["ring-foreign-plan", "classic", "MIMIRRNG", (data) => { data[280] ^= 1; }],
  ["ring-unusable-payload", "classic", "MIMIRRNG", (data) => data.fill(0, 50)],
];
for (const [label, , magic, mutate] of adversarial) {
  await assert.rejects(() => observeClassic(byMagic(magic, mutate)),
    /RECONCILIATION_CONFLICT|PDA_MISMATCH|ACCOUNT_MALFORMED/, label);
}

const lineage = (JSON.parse(JSON.stringify(composite.receipt), revive) as MimirBetaStageReceipt).reviewedStep;
const program = lineage.review.programId;
const live = new Map<any, any>(composite.addresses.map((address: string, index: number) => {
  const entry = composite.accounts.value[index];
  return [address, entry && { address, owner: entry.owner, executable: entry.executable, lamports: BigInt(entry.lamports),
    data: Uint8Array.from(Buffer.from(entry.data[0], "base64")) }];
}));
const rootIx = lineage.review.instructions.find((ix) => ix.programAddress === program && Buffer.from(ix.dataBase64, "base64")[0] === 65)!;
const recovery = { ...lineage, review: { ...lineage.review, instructions: [rootIx] } } as typeof lineage;
const root = live.get(compositeRoot);
const recoveryRoot = (mutate?: (data: Uint8Array) => void, accounts = live) => {
  const data = Uint8Array.from(root.data); mutate?.(data);
  return assertRefreshableIdentity(compositeRoot as never, { ...root, data }, { kind: "feed" }, accounts, recovery);
};
await recoveryRoot();
await assert.rejects(() => recoveryRoot((data) => { data[248] ^= 1; }), /RECONCILIATION_CONFLICT/, "recovery root foreign component set");
await assert.rejects(() => recoveryRoot((data) => data.fill(7, 320, 352)), /RECONCILIATION_CONFLICT/, "recovery root foreign component");
const withoutConfig = new Map(live); withoutConfig.delete(compositeConfig);
await assert.rejects(() => recoveryRoot(undefined, withoutConfig), /RECONCILIATION_CONFLICT/, "recovery root without config read");
const foreignConfig = new Map(live); const config = live.get(compositeConfig);
foreignConfig.set(compositeConfig, { ...config, data: Uint8Array.from(config.data).fill(7, 128, 160) });
await assert.rejects(() => recoveryRoot(undefined, foreignConfig), /RECONCILIATION_CONFLICT|ACCOUNT_MALFORMED/, "recovery config foreign set hash");


// Staged classic:ready ([90 BEGIN, 90 SEAL, 89]): the plan is read-only, so the post-SEAL plan identity is the tag-89 CAS plan hash.
{
  const snapIndex = classic.accounts.value.findIndex((e: any) => e && Buffer.from(e.data[0], "base64").subarray(0, 8).toString() === "MIMIRSNP");
  const snapData = Uint8Array.from(Buffer.from(classic.accounts.value[snapIndex].data[0], "base64"));
  const owner = classic.receipt.reviewedStep.review.programId;
  const feedConfig = bytesAddress(snapData.subarray(48, 80));
  const snapAccount = { address: classicSnapshot, owner, executable: false, lamports: 1n, data: snapData };
  const tag89 = (planHash: Uint8Array, feedId = snapData.subarray(16, 48)) => {
    const d = new Uint8Array(112); d[0] = 89; d.set(feedId, 1); d[51] = 1; d.set(planHash, 60);
    return { programAddress: owner, accounts: [{ address: classicSnapshot }, { address: classicTwap }, { address: classicRing }], dataBase64: Buffer.from(d).toString("base64") };
  };
  const seal = { programAddress: owner, accounts: [{ address: classicRing }, { address: classicTwap }, { address: classicSnapshot }, { address: feedConfig }],
    dataBase64: Buffer.from(Uint8Array.of(90, 2)).toString("base64") };
  const ready = (ix: readonly unknown[]) => ({ ...classic.receipt.reviewedStep, review: { ...classic.receipt.reviewedStep.review, instructions: ix } });
  const check = (ix: readonly unknown[]) => assertRefreshableIdentity(classicSnapshot as never, snapAccount as never, { kind: "feed" },
    new Map([[classicSnapshot, snapAccount]]) as never, ready(ix) as never);
  const planHash = snapData.subarray(262, 294);
  await check([seal, tag89(planHash)]);
  await assert.rejects(() => check([seal]), /plan hash/, "no reviewed plan identity");
  await assert.rejects(() => check([seal, tag89(planHash.map((x, i) => (i === 0 ? x ^ 1 : x)))]), /plan hash/, "foreign tag-89 plan hash");
  await assert.rejects(() => check([seal, tag89(planHash, new Uint8Array(32).fill(7))]), /feed ID|plan hash/, "foreign tag-89 feed");
}

console.log("beta refreshable reconciliation tests passed");
