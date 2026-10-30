import assert from "node:assert/strict";
import fs from "node:fs";
import { PublicKey, type Connection } from "@solana/web3.js";
import { MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS } from "../src/beta/classicExecution.js";
import { createMimirRefreshGroupBuilder } from "../src/refreshGroup.js";

// Recurring tag-89/tag-87 from real sealed executions (bank runs): the exported builder must reproduce the instructions the program accepted.
const dir = new URL("./fixtures/exportedRefresh/", import.meta.url);
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const fx = JSON.parse(fs.readFileSync(new URL(name, dir), "utf8"));
  assert.equal(fx.executed.ok, true, name);
  const info = (key: PublicKey | string) => {
    const a = fx.accounts[String(key)];
    return a ? { owner: new PublicKey(a.owner), lamports: Number(a.lamports), executable: a.executable, rentEpoch: 0, data: Buffer.from(a.data, "base64") } : null;
  };
  const context = { slot: fx.slot };
  const connection = {
    getAccountInfo: async (k: PublicKey) => info(k),
    getAccountInfoAndContext: async (k: PublicKey) => ({ context, value: info(k) }),
    getMultipleAccountsInfo: async (ks: PublicKey[]) => ks.map(info),
    getMultipleAccountsInfoAndContext: async (ks: PublicKey[]) => ({ context, value: ks.map(info) }),
    getSlot: async () => fx.slot,
  } as unknown as Connection;
  const build = createMimirRefreshGroupBuilder({ connection, payer: fx.payer, commitment: "confirmed",
    profile: { cluster: "localnet", name: "localnet" as never, programId: new PublicKey(fx.programId) } });
  const group = await build(fx.target);
  const got = group.publish.instructions.map((i) => ({ program: i.programAddress,
    accounts: i.accounts.map((m) => [m.address, m.isSigner, m.isWritable]), data: Buffer.from(i.data).toString("hex") }));
  const windowed = fx.instructions.map((i: { data: string }) => {
    const d = Buffer.from(i.data, "hex"); const at = d[0] === 89 ? 94 : 64;
    if (d[0] === 89 && d.readBigUInt64LE(43) !== d.readBigUInt64LE(35) || d[0] === 87 && d.readBigUInt64LE(49) !== d.readBigUInt64LE(41)) d.writeUInt16LE(MIMIR_DEFAULT_MAX_REUSE_AGE_SLOTS, at);
    return { ...i, data: d.toString("hex") };
  });
  assert.deepEqual(got, windowed, name);
}
console.log("exported recurring refresh fixtures ok");
