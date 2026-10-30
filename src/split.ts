// The server half of `skipSend`, loaded only by a split call.
import { MimirError } from "./easy/error.js";
import type { Price as ChainPrice } from "./easy/price.js";
import type { Price } from "./api/client.js";
import type { CompositePlan, FeedPlan, StepToSign } from "./create/facade.js";
import type { ServerStep, StepReceiptJson } from "./mimir.js";

/** One server call of the split: send the signed step if given, then return the next unsigned step or `ready`. */
export async function serverStep({ args, payer, rpcUrl, rebroadcastMs, plan, prepare, bound, toUsdc }: { args: { resume?: ServerStep; signed?: string; after?: readonly StepReceiptJson[] }; payer: string; rpcUrl: string;
  rebroadcastMs: number; plan: (payer: string) => Promise<FeedPlan | CompositePlan>; prepare: (plan: FeedPlan | CompositePlan, index: number) => Promise<StepToSign>;
  bound: (feed: string, payer: string) => Promise<boolean>; toUsdc: (prices: ChainPrice[]) => Promise<Price[]> }): Promise<ServerStep> {
  const { submit, facadeRpc, admitSigned, createdAndPriced, stepJson, unsignedFromWire, wireFacts, landedBuy } = await import("./create/facade.js");
  const { fromBase64 } = await import("./beta/bytes.js");
  const rpc = facadeRpc(rpcUrl), after: StepReceiptJson[] = [];
  const finalized = async (signature: string) => (await rpc.getSignatureStatuses([signature as never], { searchTransactionHistory: true }).send()).value[0];
  // A buy-cola receipt may be unverified (sent, then PENDING or EXPIRED): it counts once it landed; one that never landed is bought again.
  const prior = [...new Map([...(args.resume?.after ?? []), ...(args.after ?? [])].map((r) => [r.signature, r])).values()];
  const reused = await landedBuy(rpc, prior, payer).catch((cause: MimirError) => { throw new MimirError("PENDING", cause.message, "later", { cause, signatures: prior }); });
  if (reused) after.push({ kind: "buy-cola", signature: reused.signature, slot: String(reused.slot) });
  let bought = !!reused;
  for (const r of prior) {
    if (r.kind === "buy-cola") continue;
    const status = await finalized(r.signature);
    if (!status || status.err || status.confirmationStatus !== "finalized") throw new MimirError("INVALID_INPUT", `receipt ${r.signature} is not a finalized success on chain`, "never");
    after.push({ kind: r.kind, signature: r.signature, slot: String(status.slot) });
  }
  // The full-purchase rule starts every pre-CREATE plan with buy-cola: once one landed, the next step is the one after it.
  const skip = (p: FeedPlan | CompositePlan) => bought && p.steps[0]?.kind === "buy-cola" ? 1 : 0;
  const next = async (p: FeedPlan | CompositePlan): Promise<ServerStep> => {
    const i = skip(p);
    return { state: "sign", after, step: stepJson(await prepare(p, i), { feed: p.feed, steps: p.steps.slice(i) }, after.length, payer) };
  };
  if (args.resume?.state === "sign" && args.signed) {
    const step = args.resume.step;
    if (step.payer !== payer) throw new MimirError("INVALID_INPUT", "the step's payer is not this payer", "never");
    const tx = await unsignedFromWire(step);
    const buy = (await wireFacts(fromBase64(step.transaction))).programs.includes("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    const kind = buy ? "buy-cola" : step.kind;
    if (buy) { const p = await plan(payer); if (p.steps[skip(p)]?.kind !== "buy-cola") return next(p); }
    else if (step.kind === "buy-cola") return next(await plan(payer));
    const signed = fromBase64(args.signed);
    const { signature } = await admitSigned(tx, payer, signed);
    const landed = await finalized(signature);
    let slot: bigint | number;
    if (landed && !landed.err && landed.confirmationStatus === "finalized") slot = landed.slot;
    else {
      // A sent purchase comes back unverified (slot 0) in `signatures`: pass them as `after` and the next call checks it on chain before any new buy. Other steps carry only the verified receipts.
      const signatures = buy ? [...after, { kind, signature, slot: "0", lastValidBlockHeight: String(tx.lastValidBlockHeight) }] : after;
      const sent = await submit(rpc, rpcUrl.replace(/^http/, "ws"), signed, signature, tx.lastValidBlockHeight, undefined, rebroadcastMs)
        .catch((cause) => { throw new MimirError("PENDING", `${kind} ${signature} was sent; its outcome is unknown`, "later", { cause, signatures }); });
      if (sent.outcome === "timeout") throw new MimirError("PENDING", `${kind} ${signature} was sent; its outcome is unknown`, "later", { signatures });
      if (sent.outcome !== "confirmed") throw new MimirError(sent.outcome === "expired" ? "EXPIRED" : "RPC", `${kind} ${signature} ${sent.outcome}`, sent.outcome === "expired" ? "now" : "later", { signatures });
      slot = sent.slot;
    }
    after.push({ kind, signature, slot: String(slot) });
    if (buy) bought = true;
  }
  const feed = args.resume?.state === "sign" ? args.resume.step.feed : args.resume?.state === "ready" ? args.resume.feed : null;
  if (feed && after.some((r) => r.kind === "create+price" || r.kind === "first-price") && await createdAndPriced(rpc, feed, payer) && await bound(feed, payer)) {
    const { getPrice } = await import("./easy/refresh.js");
    const price = (await toUsdc([await getPrice(feed, { rpc: rpcUrl, live: false })]))[0]!;
    return { state: "ready", ticker: price.ticker!, feed, price: JSON.parse(JSON.stringify(price, (_k, v) => (typeof v === "bigint" ? v.toString() : v))), signatures: after, cost: { sol: "0" }, after };
  }
  return next(await plan(payer));
}
