import assert from "node:assert/strict";
import fs from "node:fs";
import { createMimirBetaRenewalWitnesses } from "../src/beta/creation.js";
import type { MimirBetaAccount } from "../src/beta/types.js";

const revive = (_key: string, value: any) => value?.$mimir === "bigint" ? BigInt(value.value)
  : value?.$mimir === "bytes" ? Uint8Array.from(value.value) : value;
const run = JSON.parse(fs.readFileSync(new URL("./fixtures/sharedCreationReconciliation.json", import.meta.url), "utf8"), revive).qa2;
const collection = "DbjsWo7iUs7QZyJxLgNyVxvAAjQZCXroJHoGok8h8Umg";
const mint = "CoLAyH8CRuBLyr2BRDozka3dJ5XH97BSa6WpZL9NAqWL";
const writes = run.receipt.reviewedStep.step.expectedWrites;
const raw = (predicate: (data: Buffer) => boolean) => {
  const entry = run.accounts.value.find((value: any) => predicate(Buffer.from(value.data[0], "base64")));
  return { entry, data: Buffer.from(entry.data[0], "base64") };
};
const core = raw((data) => data[0] === 5 && data.length === 68);
const spl = raw((data) => data.length === 82);
const deployment = { cluster: "localnet", mimirProgramId: "TYo5SEVfHyFzpjsbFVzNFKTnmLdBvdYjLxmnv32iQ9r", agentRegistryProgramId: "8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ",
  mplCoreProgramId: core.entry.owner, systemProgramId: "11111111111111111111111111111111", physicalCollection: collection,
  collectionPointer: "c1:a" } as never;
const account = (address: string, entry: any, data: Buffer): MimirBetaAccount =>
  ({ address, lamports: 1n, owner: entry.owner, executable: false, data: Uint8Array.from(data) }) as never;

type Tamper = { collection?: (data: Buffer) => Buffer | void; mint?: (data: Buffer) => void };
function witness(base: { minted: number; supply: bigint }, delta = 1, tamper: Tamper = {}) {
  const state = (minted: number, supply: bigint, post: boolean) => {
    const c = Buffer.from(core.data); c.writeUInt32LE(minted, 60); c.writeUInt32LE(minted - 78, 64);
    const m = Buffer.from(spl.data); m.writeBigUInt64LE(supply, 36);
    if (post) { tamper.mint?.(m); }
    const t = post ? tamper.collection?.(c) ?? c : c;
    return new Map([[collection, account(collection, core.entry, t)], [mint, account(mint, spl.entry, m)]]) as never;
  };
  return createMimirBetaRenewalWitnesses(writes, state(base.minted, base.supply, false),
    state(base.minted + delta, base.supply - BigInt(delta) * 10_000_000_000_000n, true), deployment);
}

const base = await witness({ minted: 1510, supply: 1010142043503199018n });
assert.deepEqual(base.map((entry) => entry.role), ["core-collection", "burn-mint"]);
assert.deepEqual(await witness({ minted: 1520, supply: 1010142043503199018n }), base);
assert.deepEqual(await witness({ minted: 1510, supply: 1000142043503199018n }), base);
const differs = async (label: string, value: Promise<unknown>) => assert.notDeepEqual(await value, base, label);
const at = (offset: number) => (data: Buffer) => { data[offset] ^= 1; };
await differs("name", witness({ minted: 1510, supply: 1010142043503199018n }, 1, { collection: at(37) }));
await differs("authority", witness({ minted: 1510, supply: 1010142043503199018n }, 1, { collection: at(1) }));
await differs("uri", witness({ minted: 1510, supply: 1010142043503199018n }, 1, { collection: at(core.data.readUInt32LE(33) + 41) }));
const plugin = witness({ minted: 1510, supply: 1010142043503199018n }, 1, { collection: (data) => Buffer.concat([data, Buffer.of(1)]) });
await plugin.then((value) => assert.notDeepEqual(value, base, "plugin"), () => undefined);
await differs("effect", witness({ minted: 1510, supply: 1010142043503199018n }, 2));
await differs("mint authority", witness({ minted: 1510, supply: 1010142043503199018n }, 1, { mint: at(4) }));
await differs("freeze authority", witness({ minted: 1510, supply: 1010142043503199018n }, 1, { mint: at(50) }));
console.log("betaRenewalWitness ok");
