// Every live feed: its fresh-price Transaction v1 with a memo, built for a funded public payer and simulated on mainnet. Nothing is signed or sent.
// Usage: MIMIR_RPC=<mainnet rpc> [MIMIR_ONLY=SOL,HBM5] npm run check:live [-- out.md]
import { writeFileSync } from "node:fs";
import { Mimir } from "../dist/src/root.js";

const RPC = process.env.MIMIR_RPC;
if (!RPC) { console.error("set MIMIR_RPC to a mainnet RPC"); process.exit(2); }
const PAYER = process.env.MIMIR_PAYER ?? "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MEMO = { programAddress: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", accounts: [], data: new TextEncoder().encode("mimir live check") };
const MAX_CALLS = 1_500;

let calls = 0;
const fetched = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input?.url ?? input).startsWith(RPC)) {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls += Array.isArray(body) ? body.length : 1;
    if (calls > MAX_CALLS) throw new Error(`RPC budget of ${MAX_CALLS} calls spent`);
  }
  return fetched(input, init);
};
const rpc = async (method, params) => (await (await fetched(RPC, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json());

const feeds = [];
for (let page = 1; ; page++) {
  const r = await (await fetched(`https://api.mimirfeeds.io/v1/feeds?limit=100&page=${page}`)).json();
  feeds.push(...r.items);
  if (page >= r.lastPage) break;
}
const only = process.env.MIMIR_ONLY?.split(",");
const mimir = new Mimir({ rpc: RPC });
const rows = [];
for (const f of feeds.filter((f) => !only || only.includes(f.ticker))) {
  const row = { ticker: f.ticker, kind: f.kind, address: f.address, bytes: "", accounts: "", cu: "", err: "", status: "" };
  try {
    const step = await mimir.buildWithFreshPrice(f.address, [MEMO], { payer: PAYER });
    const wire = Buffer.from(step.transaction, "base64");
    row.bytes = wire.length;
    calls++;
    const sim = (await rpc("simulateTransaction", [step.transaction, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }])).result?.value;
    const { getCompiledTransactionMessageDecoder } = await import("@solana/transaction-messages");
    const { getTransactionDecoder } = await import("@solana/transactions");
    row.accounts = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(wire).messageBytes).staticAccounts.length;
    row.cu = sim?.unitsConsumed ?? "";
    row.err = sim?.err ? JSON.stringify(sim.err) : "";
    row.status = sim && !sim.err ? "ok" : "fail";
  } catch (e) {
    row.status = "fail";
    row.err = `${e.code ?? e.name}: ${String(e.message).slice(0, 160)}`;
  }
  rows.push(row);
  console.log(`${row.status} ${row.ticker} ${row.bytes} ${row.cu} ${row.err}`);
  await new Promise((r) => setTimeout(r, 150));
}
const ok = rows.filter((r) => r.status === "ok").length;
const md = [`# Live feeds check`, ``, `${new Date().toISOString()} · ${ok}/${rows.length} ok · ${calls} RPC calls · payer ${PAYER}`, ``,
  `| ticker | kind | bytes | accounts | CU | status | err |`, `|---|---|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.ticker} | ${r.kind} | ${r.bytes} | ${r.accounts} | ${r.cu} | ${r.status} | ${r.err.replace(/\|/g, "/")} |`)].join("\n");
if (process.argv[2]) writeFileSync(process.argv[2], md + "\n");
console.log(`${ok}/${rows.length} ok, ${calls} RPC calls`);
process.exit(ok === rows.length ? 0 : 1);
