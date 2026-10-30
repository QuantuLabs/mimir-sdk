import bs58 from "bs58";
import { MimirError } from "./easy/error.js";
import type { MimirBetaUnsignedTransaction } from "./beta/review.js";

/** Signs one reviewed Transaction v1 and returns the signed wire. */
export type MimirSigner = { readonly address: () => string | null; readonly prompts: boolean; sign(transaction: MimirBetaUnsignedTransaction, step?: object): Promise<Uint8Array> };
/** A key pair (64 bytes, base58, web3.js `Keypair`, WebCrypto `CryptoKeyPair`), a @solana/kit signer, a Wallet Standard wallet, a wallet-adapter, or `{ address, sign }`. */
export type WalletInput = unknown;

const TXV1_HINT = "Use a key pair, a @solana/kit signer, or a Wallet Standard wallet that signs Transaction v1 (wallet-adapter: pass useWallet().wallet).";
const unsupported = (message: string): never => { throw new MimirError("WALLET_UNSUPPORTED", message, "never", { hint: TXV1_HINT }); };
const PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null;
const isKey = (x: unknown) => typeof CryptoKey !== "undefined" && x instanceof CryptoKey;

/** A wallet that declined: 4001 or « rejected » in its message. */
export function rejected(e: unknown): boolean {
  return (e as { code?: unknown })?.code === 4001 || /reject|declin|denied|cancel/i.test(String((e as Error)?.message ?? e));
}
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) {
    if (e instanceof MimirError) throw e;
    if (rejected(e)) throw new MimirError("WALLET_REJECTED", "the wallet declined the transaction", "now", { cause: e });
    throw e;
  }
}

/** The fee-payer signature in slot 0 of the TxV1 wire (message first, signatures trailing). */
function withSignature(t: MimirBetaUnsignedTransaction, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) unsupported("the signer returned no 64-byte signature");
  const wire = t.serializedTransaction.slice();
  wire.set(signature, t.serializedMessage.length);
  return wire;
}

async function seedSigner(secret: Uint8Array): Promise<MimirSigner> {
  const address = bs58.encode(secret.subarray(32, 64));
  let pair: Promise<CryptoKeyPair> | undefined;
  const keys = () => pair ??= (async () => {
    const pkcs8 = new Uint8Array(48); pkcs8.set(PKCS8); pkcs8.set(secret.subarray(0, 32), 16);
    const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", false, ["sign"]);
    const publicKey = await crypto.subtle.importKey("raw", secret.slice(32, 64), "Ed25519", true, ["verify"]);
    const probe = new Uint8Array(32);
    if (!await crypto.subtle.verify("Ed25519", publicKey, await crypto.subtle.sign("Ed25519", privateKey, probe), probe)) unsupported("bytes 32-63 of the key are not the public key of bytes 0-31");
    return { privateKey, publicKey };
  })();
  return { address: () => address, prompts: false, sign: (t) => cryptoSign(t, address, keys()) };
}
async function cryptoSign(t: MimirBetaUnsignedTransaction, address: string, keys: Promise<CryptoKeyPair>) {
  const [keyPair, { partiallySignMimirBetaTransactionV1 }] = await Promise.all([keys, import("./beta/transactionV1.js")]);
  return (await partiallySignMimirBetaTransactionV1({ transaction: t, signerAddress: address as never, keyPair })).serializedTransaction;
}

/** The Wallet Standard wallet under a wallet-adapter value, or the value itself. */
function standardOf(w: Obj): Obj | null {
  for (const c of [w, (w.wallet as Obj | undefined)?.adapter && ((w.wallet as Obj).adapter as Obj).wallet, (w.adapter as Obj | undefined)?.wallet, w.wallet]) {
    if (isObj(c) && isObj(c.features)) return c;
  }
  return null;
}

/** Normalises any supported wallet input to one Transaction v1 signer, synchronously and without the network. */
export function normaliseWallet(w: WalletInput): MimirSigner {
  if (w === undefined || w === null) unsupported("no wallet");
  const bytes = Array.isArray(w) ? Uint8Array.from(w as number[]) : w instanceof Uint8Array ? w : typeof w === "string" ? (() => { try { return bs58.decode(w); } catch { return unsupported("the string is not a base58 secret key"); } })() : null;
  if (bytes) {
    if (bytes.length !== 64) unsupported(`a secret key is 64 bytes, got ${bytes.length}`);
    const signer = seedSigner(bytes), address = bs58.encode(bytes.subarray(32, 64));
    return { address: () => address, prompts: false, sign: async (t, step) => (await signer).sign(t, step) };
  }
  if (!isObj(w)) return unsupported("unknown wallet shape");
  if (w.secretKey instanceof Uint8Array && w.secretKey.length === 64 && w.publicKey) return normaliseWallet(w.secretKey);
  if (isKey(w.privateKey) && isKey(w.publicKey)) {
    let address: string | null = null;
    const ready = (async () => { const { getAddressFromPublicKey } = await import("@solana/kit"); address = await getAddressFromPublicKey(w.publicKey as CryptoKey); return address; })();
    return { address: () => address, prompts: false, sign: async (t) => cryptoSign(t, await ready, Promise.resolve(w as unknown as CryptoKeyPair)) };
  }
  if (typeof w.address === "string" && (typeof w.signTransactions === "function" || typeof w.modifyAndSignTransactions === "function")) {
    const address = w.address;
    return { address: () => address, prompts: !("keyPair" in w), sign: (t) => guard(async () => {
      const tx = { messageBytes: t.serializedMessage, signatures: Object.fromEntries(t.requiredSigners.map((s) => [s, null])) };
      if (typeof w.signTransactions === "function") {
        const [dict] = await (w.signTransactions as (x: unknown[]) => Promise<Record<string, Uint8Array>[]>)([tx]);
        return withSignature(t, dict?.[address] ?? new Uint8Array());
      }
      const [out] = await (w.modifyAndSignTransactions as (x: unknown[]) => Promise<{ messageBytes: Uint8Array; signatures: Record<string, Uint8Array> }[]>)([tx]);
      const wire = new Uint8Array(out!.messageBytes.length + t.requiredSigners.length * 64);
      wire.set(out!.messageBytes); t.requiredSigners.forEach((s, i) => { const sig = out!.signatures[s]; if (sig) wire.set(sig, out!.messageBytes.length + i * 64); });
      return wire;
    }) };
  }
  if (typeof w.address === "string" && typeof w.sign === "function") {
    const address = w.address, sign = w.sign as (step: unknown) => Promise<Uint8Array>;
    return { address: () => address, prompts: true, sign: (t, step) => guard(() => sign(step ?? { transaction: t })) };
  }
  const standard = standardOf(w);
  if (standard) {
    const feature = (standard.features as Obj)["solana:signTransaction"] as Obj | undefined;
    if (!feature || typeof feature.signTransaction !== "function") unsupported("this wallet has no solana:signTransaction");
    const versions = feature!.supportedTransactionVersions as readonly unknown[] | undefined;
    if (!versions?.some((v) => v === 1 || v === "1")) unsupported("this wallet cannot sign Transaction v1");
    const account = () => {
      const pk = (w as Obj).publicKey as { toBase58?: () => string } | null | undefined;
      const first = (standard.accounts as Obj[] | undefined)?.[0];
      const address = pk?.toBase58?.() ?? (typeof first?.address === "string" ? first.address : null);
      return { address, account: (standard.accounts as Obj[] | undefined)?.find((a) => a.address === address) ?? first };
    };
    return { address: () => account().address, prompts: true, sign: (t) => guard(async () => {
      const { account: a } = account();
      if (!a) throw new MimirError("NO_WALLET", "the wallet is not connected", "never", { hint: "Connect the wallet first." });
      const [out] = await (feature!.signTransaction as (x: unknown) => Promise<{ signedTransaction: Uint8Array }[]>)({ account: a, transaction: t.serializedTransaction, chain: "solana:mainnet" });
      return out!.signedTransaction;
    }) };
  }
  if (typeof w.signTransaction === "function") return unsupported("a legacy adapter cannot sign Transaction v1: pass useWallet().wallet");
  return unsupported("unknown wallet shape");
}
