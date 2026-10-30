// Declared wallet-guard token accounts: a real wallet's guard tail (payer + 2 token accounts) on a one-signer purchase and
// on that purchase merged ahead of a 2-signer core, admitted under the declared form and nothing looser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { address, getAddressEncoder, getAddressFromPublicKey, type Address } from "@solana/addresses";
import { generateKeyPair, signBytes } from "@solana/keys";
import { getCompiledTransactionMessageDecoder } from "@solana/transaction-messages";
import { getTransactionDecoder, getTransactionEncoder } from "@solana/transactions";
import {
  admitMimirBetaWalletSignedBatchV1, admitMimirBetaWalletSignedTransactionV1, compileMimirBetaTransactionV1,
  isMimirBetaWalletRewriteV1, mimirBetaReviewedToWalletInstructionIndexesV1, verifyMimirBetaWalletSignedTransactionV1,
  type MimirBetaWalletGuardAccountsV1,
} from "../src/beta/transactionV1.js";
import type { MimirBetaInstruction } from "../src/beta/types.js";

const LIGHTHOUSE = address("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/walletGuards/${name}`, import.meta.url)));
const decodeMessage = (bytes: Uint8Array) => getCompiledTransactionMessageDecoder().decode(bytes) as any;

function decompile(messageBytes: Uint8Array) {
  const m = decodeMessage(messageBytes); const h = m.header; const n = m.staticAccounts.length;
  const signer = (i: number) => i < h.numSignerAccounts;
  const writable = (i: number) => signer(i) ? i < h.numSignerAccounts - h.numReadonlySignerAccounts : i < n - h.numReadonlyNonSignerAccounts;
  const instructions: MimirBetaInstruction[] = m.instructionHeaders.map((header: any, i: number) => ({
    programAddress: m.staticAccounts[header.programAccountIndex] as Address,
    accounts: m.instructionPayloads[i].instructionAccountIndices.map((k: number) => ({ address: m.staticAccounts[k] as Address, isSigner: signer(k), isWritable: writable(k) })),
    data: new Uint8Array(m.instructionPayloads[i].instructionData),
  }));
  return { instructions, payer: m.staticAccounts[0] as Address, blockhash: m.lifetimeToken as string,
    priorityFee: (m.configMask & 3) === 3 ? BigInt(m.configValues[0].value) : undefined };
}
const wireMessage = (name: string) => new Uint8Array(getTransactionDecoder().decode(fixture(name)).messageBytes);

// Payer-substituted twin: a throwaway key replaces the captured payer everywhere, nothing here is sendable.
const keyPair = await generateKeyPair();
const twin = await getAddressFromPublicKey(keyPair.publicKey);
const buy = decompile(wireMessage("buy.wire.bin")), core = decompile(wireMessage("core.wire.bin"));
const payer = buy.payer;
assert.equal(core.payer, payer);
const [from, to] = [payer, twin].map((a) => new Uint8Array(getAddressEncoder().encode(a)));
const substitute = (bytes: Uint8Array) => {
  const out = new Uint8Array(bytes);
  for (let i = 0; i + 32 <= out.length; i++) if (from!.every((b, k) => out[i + k] === b)) { out.set(to!, i); i += 31; }
  return out;
};
const swap = (ixs: readonly MimirBetaInstruction[]) => ixs.map((ix) => ({ ...ix, accounts: ix.accounts.map((a) => ({ ...a, address: a.address === payer ? twin : a.address })) }));
const wireOf = async (messageBytes: Uint8Array) => {
  const m = decodeMessage(messageBytes);
  const signatures: Record<string, Uint8Array | null> = Object.fromEntries(m.staticAccounts.slice(0, m.header.numSignerAccounts).map((a: string) => [a, null]));
  signatures[m.staticAccounts[0]] = await signBytes(keyPair.privateKey, messageBytes);
  return new Uint8Array(getTransactionEncoder().encode({ messageBytes, signatures } as never));
};
const compile = (blockhash: string, instructions: readonly MimirBetaInstruction[], priorityFeeLamports?: bigint) =>
  compileMimirBetaTransactionV1({ feePayer: twin, recentBlockhash: blockhash, lastValidBlockHeight: 1n, instructions,
    ...(priorityFeeLamports !== undefined ? { priorityFeeLamports } : {}) });

// The wallet's real guard instructions: payer, then two token-account guards.
const guarded = decodeMessage(fixture("buyWalletGuarded.message.bin"));
const realGuards = guarded.instructionHeaders.flatMap((header: any, i: number) => guarded.staticAccounts[header.programAccountIndex] === LIGHTHOUSE
  ? [{ target: guarded.staticAccounts[guarded.instructionPayloads[i].instructionAccountIndices[0]] as Address, data: substitute(new Uint8Array(guarded.instructionPayloads[i].instructionData)) }] : []);
assert.equal(realGuards.length, 3);
assert.equal(realGuards[0].target, payer);
const guardIx = (target: Address, data: Uint8Array): MimirBetaInstruction => ({ programAddress: LIGHTHOUSE,
  accounts: [{ address: target === payer ? twin : target, isSigner: target === payer, isWritable: target === payer }], data });
const [gPayer, gFirst, gSecond] = realGuards.map((g: { target: Address; data: Uint8Array }) => guardIx(g.target, g.data)) as MimirBetaInstruction[];
const [firstAccount, secondAccount] = [realGuards[1].target, realGuards[2].target] as Address[];
const declared = { tokenAccounts: [firstAccount!, secondAccount!] } as const;
const flipped = (ix: MimirBetaInstruction, at: number, xor: number): MimirBetaInstruction => { const d = new Uint8Array(ix.data); d[at] ^= xor; return { ...ix, data: d }; };

const buyTx = await compile(buy.blockhash, swap(buy.instructions), buy.priorityFee);
assert.equal(buyTx.packet.signatureCount, 1);
const buyGuarded = substitute(fixture("buyWalletGuarded.message.bin"));
const mergedIx = [...swap(buy.instructions), ...swap(core.instructions)];
const merged = await compile(core.blockhash, mergedIx, core.priorityFee);
assert.equal(merged.packet.signatureCount, 2);
const walletMsg = async (extra: MimirBetaInstruction[], ixs: readonly MimirBetaInstruction[] = mergedIx) => (await compile(core.blockhash, [...ixs, ...extra], 140_000n)).serializedMessage;
const vault = buy.instructions[4]!.accounts.find((a) => a.isWritable && ![payer, firstAccount, secondAccount].includes(a.address))!.address;
const readonlyKey = buy.instructions.flatMap((ix) => ix.accounts).find((a) => !a.isWritable && !a.isSigner)!.address;
const absentKey = address("Sysvar1nstructions1111111111111111111111111");
const three = await walletMsg([gPayer!, gFirst!, gSecond!]);

const verdict = async (msg: Uint8Array, guards: MimirBetaWalletGuardAccountsV1, transaction = merged) => {
  try { await admitMimirBetaWalletSignedTransactionV1({ transaction, walletAddress: twin, walletSignedTransaction: await wireOf(msg), collateralTokenAccount: guards }); return "ACCEPT"; }
  catch (error) { return `REJECT ${(error as { code?: string }).code}`; }
};
const batch = async (wires: Uint8Array[]) => {
  try {
    await admitMimirBetaWalletSignedBatchV1({ walletAddress: twin, walletSignedTransactions: wires,
      reviews: [{ transaction: merged, collateralTokenAccount: declared }, { transaction: buyTx, collateralTokenAccount: declared }] });
    return "ACCEPT";
  } catch (error) { return `REJECT ${(error as { code?: string }).code}`; }
};
const R = "REJECT RECEIPT_MISMATCH";
const cases: Record<string, [Promise<string>, string]> = {
  "buy alone, 3 guards, legacy null": [verdict(buyGuarded, null, buyTx), R],
  "buy alone, 3 guards, legacy token account": [verdict(buyGuarded, secondAccount!, buyTx), R],
  "buy alone, 3 guards, declared": [verdict(buyGuarded, declared, buyTx), "ACCEPT"],
  "merged, 3 guards, legacy token account": [verdict(three, secondAccount!), R],
  "merged, 3 guards, declared": [verdict(three, declared), "ACCEPT"],
  "merged, 2 guards, declared": [verdict(await walletMsg([gPayer!, gSecond!]), declared), "ACCEPT"],
  "merged, fee-only, declared": [verdict(await walletMsg([]), declared), "ACCEPT"],
  "MUT guard on route vault": [verdict(await walletMsg([gPayer!, guardIx(vault, gFirst!.data), gSecond!]), declared), R],
  "MUT owner != payer": [verdict(await walletMsg([gPayer!, flipped(gFirst!, 40, 1), gSecond!]), declared), R],
  "MUT duplicate guard": [verdict(await walletMsg([gPayer!, gSecond!, gSecond!]), declared), R],
  "MUT no payer guard": [verdict(await walletMsg([gFirst!, gSecond!]), declared), R],
  "MUT opcode flip": [verdict(await walletMsg([gPayer!, flipped(gFirst!, 0, 1), gSecond!]), declared), R],
  "MUT 4th undeclared guard": [verdict(await walletMsg([gPayer!, gFirst!, gSecond!, guardIx(vault, gSecond!.data)]), declared), R],
  "MUT guard before core": [verdict((await compile(core.blockhash, [gPayer!, ...mergedIx, gFirst!, gSecond!], 140_000n)).serializedMessage, declared), R],
  "MUT core data changed": [verdict(await walletMsg([gPayer!, gFirst!, gSecond!], mergedIx.map((ix, i) => i === 4 ? flipped(ix, 8, 1) : ix)), declared), R],
  "MUT buy amount changed": [verdict(await walletMsg([gPayer!, gFirst!, gSecond!], mergedIx.map((ix, i) => i === 2 ? flipped(ix, 4, 1) : ix)), declared), R],
  "MUT guard on readonly key": [verdict(await walletMsg([gPayer!, guardIx(readonlyKey, gFirst!.data), gSecond!]), { tokenAccounts: [readonlyKey, secondAccount!] }), R],
  "MUT guard on absent key": [verdict(await walletMsg([gPayer!, guardIx(absentKey, gFirst!.data), gSecond!]), { tokenAccounts: [absentKey, firstAccount!, secondAccount!] }), R],
  "batch ordered": [batch([await wireOf(three), await wireOf(buyGuarded)]), "ACCEPT"],
  "batch reordered": [batch([await wireOf(buyGuarded), await wireOf(three)]), R],
};
const actual: Record<string, string> = {}, expected: Record<string, string> = {};
for (const [name, [result, want]] of Object.entries(cases)) { actual[name] = await result; expected[name] = want; }
assert.deepEqual(actual, expected);

// Declared form flows through the rewrite predicate, the index map and wallet-first verification.
assert.equal(isMimirBetaWalletRewriteV1(buyTx.serializedMessage, buyGuarded), false);
assert.equal(isMimirBetaWalletRewriteV1(buyTx.serializedMessage, buyGuarded, declared), true);
assert.deepEqual([...mimirBetaReviewedToWalletInstructionIndexesV1(buyTx.serializedMessage, buyGuarded, declared).entries()],
  [...mimirBetaReviewedToWalletInstructionIndexesV1(buyTx.serializedMessage, buyTx.serializedMessage).entries()]);
const verified = await verifyMimirBetaWalletSignedTransactionV1({ transaction: buyTx, walletAddress: twin,
  walletSignedTransaction: await wireOf(buyGuarded), preservedSignatures: [], collateralTokenAccount: declared });
assert.deepEqual(verified.serializedMessage, buyGuarded);
const buyGuardedWire = await wireOf(buyGuarded);
await assert.rejects(() => verifyMimirBetaWalletSignedTransactionV1({ transaction: buyTx, walletAddress: twin,
  walletSignedTransaction: buyGuardedWire, preservedSignatures: [] }), /wallet changed the reviewed Transaction v1 message/);

console.log("walletGuardAccounts tests passed");
