// S4: ./create facade seams — the keyless Jupiter builder, captured-build validation, market flags, refusals, and the wallet admission.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createKeyPairFromPrivateKeyBytes } from "@solana/keys";
import { getAddressFromPublicKey, type Address } from "@solana/addresses";
import * as create from "../../src/create/index.js";
import { jupiterSwapBuild, keyPairSigner, prepareFeed } from "../../src/create/index.js";
import { admitSigned, typed } from "../../src/create/facade.js";
import { CompositeExistsError, InsufficientSolError } from "../../src/create/errors.js";
import { MimirBetaDlmmPointError, MimirBetaError } from "../../src/beta/errors.js";
import { getTransactionDecoder } from "@solana/transactions";
import bs58 from "bs58";
import { validateJupiterCollateralBuild } from "../../src/create/collateral-funding.js";
import { marketEligible } from "../../src/create/recipes.js";
import { compileMimirBetaTransactionV1, admitMimirBetaWalletSignedTransactionV1 } from "../../src/beta/transactionV1.js";
import { buildMimirBetaComputeUnitLimitInstruction } from "../../src/beta/liveAbi.js";
import { MimirError } from "../../src/easy/price.js";

const SOL = "So11111111111111111111111111111111111111112", COLA = create.MIMIR_MAINNET_COLLATERAL_MINT;
const taker = "6Ba7yenKXHuauCn451XN8UotWgKtZyvxPMFwcPZza2Kz" as Address;

// (e) Keyless URL and the five params; 429 honoured with Retry-After, then the bare build JSON is returned.
const keyless = JSON.parse(readFileSync(new URL("./fixtures/jupiter-keyless-cola-build.json", import.meta.url), "utf8"));
const seen: { url: URL; headers?: Record<string, string> }[] = [];
let limited = 1;
globalThis.fetch = (async (input: string | URL, init?: { headers?: Record<string, string> }) => {
  seen.push({ url: new URL(String(input)), ...(init?.headers ? { headers: init.headers } : {}) });
  if (limited-- > 0) return new Response("", { status: 429, headers: { "retry-after": "0" } });
  return Response.json(keyless);
}) as typeof fetch;
const body = await jupiterSwapBuild()({ taker, inputMint: SOL, outputMint: COLA, amount: 20_000n, slippageBps: 100 });
assert.deepEqual(body, keyless);
assert.equal(seen.length, 2);
assert.equal(seen[1]!.url.origin + seen[1]!.url.pathname, "https://api.jup.ag/swap/v2/build");
assert.deepEqual(Object.fromEntries(seen[1]!.url.searchParams), { taker, inputMint: SOL, outputMint: COLA, amount: "20000", slippageBps: "100", transactionVersion: "1" });
assert.equal(seen[1]!.headers, undefined);
await jupiterSwapBuild({ apiKey: "free" })({ taker, inputMint: SOL, outputMint: COLA, amount: 1n, slippageBps: 100 });
assert.deepEqual(seen.at(-1)!.headers, { "x-api-key": "free" });

// (e) The captured keyless mainnet build validates; any route but route_v2 (shared_accounts_route_v2 included) is refused.
const [ata] = await (await import("../../src/v1/build.js")).findMimirV1AssociatedTokenAddress(taker, COLA);
const terms = { authority: taker, collateralMint: COLA, collateralTokenAccount: ata, requiredOutputRaw: 1n, maxInputLamports: 1_000_000_000n, slippageBps: 100 };
const valid = await validateJupiterCollateralBuild(keyless, terms);
assert.equal(valid.inputLamports, 20_000n);
const shared = structuredClone(keyless);
const data = Buffer.from(shared.swapInstruction.data, "base64"); data.set([0xd1, 0x98, 0xf3, 0x6b, 0x5d, 0x10, 0x33, 0xec]); shared.swapInstruction.data = data.toString("base64");
await assert.rejects(validateJupiterCollateralBuild(shared, terms));

// (a) Market flags: two pools, or a non-spot sealing mode; a 1-pool Default is a market only where it seals current-point.
assert.equal(marketEligible(null, { adapterType: 1, adapterVersion: 0 }, 1), false);
assert.equal(marketEligible("native-bounded", { adapterType: 1, adapterVersion: 0 }, 1), true);
assert.equal(marketEligible(null, { adapterType: 1, adapterVersion: 0 }, 2), true);
assert.equal(marketEligible("current-point", { adapterType: 3, adapterVersion: 0 }, 1), true);

// Refusal before any RPC: a malformed ticker.
await assert.rejects(prepareFeed({ payer: taker, ticker: "bad-t", baseMint: SOL, quote: "USDC", pools: [] }), (e: MimirError) => e.code === "INVALID_INPUT");

// Per-code hints: funding is retried later and says what it covers; an unsupported recipe names the supported ones; a bad mint names the field.
const short = (() => { try { return typed(new InsufficientSolError(14_256_900n, 1_000_000n)); } catch (e) { return e as MimirError; } })();
assert.equal(short.code, "INSUFFICIENT_SOL"); assert.equal(short.retry, "later");
assert.match(short.message, /0\.0142569 SOL for this step and the next \(the COLA purchase/);
assert.equal(short.hint, "Fund the payer with the amount in the message, then call createFeed again. Nothing was sent.");
assert.equal(new MimirError("NOT_SUPPORTED", "x", "never").hint, "Use recipe default, native-bounded or current-point.");
const mint = (() => { try { return typed(new MimirBetaError("INVALID_ARGUMENT", "base mint address invalid")); } catch (e) { return e as MimirError; } })();
assert.equal(mint.code, "INVALID_INPUT"); assert.equal(mint.message, "baseMint is not a valid mint address");
assert.equal(mint.hint, "Fix this input: baseMint is not a valid mint address.");

// (b) The wallet admission: the signed reviewed bytes pass; a non-fee rewrite is refused (createFeed maps it to REVIEW_CHANGED).
const pair = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(3));
const payer = await getAddressFromPublicKey(pair.publicKey);
const transaction = await compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9n,
  instructions: [buildMimirBetaComputeUnitLimitInstruction(50_000), { programAddress: COLA as Address, accounts: [{ address: payer, isSigner: true, isWritable: true }], data: Uint8Array.of(1) }] });
const sign = await keyPairSigner(pair);
const signed = await sign({ kind: "buy-cola", index: 0, transaction, review: {} as never });
await admitMimirBetaWalletSignedTransactionV1({ transaction, walletAddress: payer, walletSignedTransaction: signed });
const tampered = signed.slice(); tampered[tampered.length - 1] ^= 1;
await assert.rejects(admitMimirBetaWalletSignedTransactionV1({ transaction, walletAddress: payer, walletSignedTransaction: tampered }));
// Blocker 1: the tracked signature is the fee payer's trailing TxV1 slot, not bytes 1..65 of the message.
const { signature } = await admitSigned(transaction, payer, signed);
assert.equal(signature, bs58.encode(new Uint8Array(getTransactionDecoder().decode(signed).signatures[payer]!)));
assert.notEqual(signature, bs58.encode(signed.subarray(1, 65)));
// Blocker 2: same fee, CU limit 50,000 -> 1 is admitted by the fee-only predicate but refused by the facade; a fee-only raise passes.
const rewrite = (cu: number, fee: bigint) => compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9n,
  priorityFeeLamports: fee, instructions: [buildMimirBetaComputeUnitLimitInstruction(cu), { programAddress: COLA as Address, accounts: [{ address: payer, isSigner: true, isWritable: true }], data: Uint8Array.of(1) }] });
const starved = await sign({ kind: "buy-cola", index: 0, transaction: await rewrite(1, transaction.config.priorityFeeLamports!), review: {} as never });
await admitMimirBetaWalletSignedTransactionV1({ transaction, walletAddress: payer, walletSignedTransaction: starved });
await assert.rejects(admitSigned(transaction, payer, starved), (e: MimirError) => e.code === "REVIEW_CHANGED");
await admitSigned(transaction, payer, await sign({ kind: "buy-cola", index: 0, transaction: await rewrite(50_000, 100_000n), review: {} as never }));
assert.throws(() => typed(new CompositeExistsError("Idx1111111111111111111111111111111111111111", "IDX")),
  (e: MimirError) => e.code === "FEED_EXISTS" && e.feeds?.[0]?.feed === "Idx1111111111111111111111111111111111111111" && e.feeds[0].ticker === "IDX");
assert.throws(() => typed(new MimirBetaDlmmPointError("one-sided", "DLMM active bin is not two-sided")),
  (e: MimirError) => e.code === "UNPRICEABLE" && e.retry === "later" && /native-bounded/.test(e.hint) && !/^DLMM_POINT/.test(e.message));
console.log("create facade: ok");
