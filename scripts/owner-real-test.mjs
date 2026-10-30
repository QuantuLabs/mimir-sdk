// Owner real test: plan through the Mimir API, confirm, create one feed on mainnet, read it back through the API.
// MIMIR_KEYPAIR=<keypair.json> MIMIR_RPC=<rpc> [MIMIR_AFTER='<json>'] node scripts/owner-real-test.mjs <mint> [ticker]
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Mimir } from "@quantulabs/mimir-sdk";

const [mint, ticker] = process.argv.slice(2);
if (!mint) { console.error("usage: node scripts/owner-real-test.mjs <mint> [ticker]"); process.exit(1); }
if (!process.env.MIMIR_KEYPAIR) { console.error("MIMIR_KEYPAIR is required (path to your keypair json)."); process.exit(1); }
if (!process.env.MIMIR_RPC) { console.error("MIMIR_RPC is required (your RPC URL): creation finds pools and sends through it."); process.exit(1); }

const wallet = JSON.parse(readFileSync(process.env.MIMIR_KEYPAIR, "utf8"));
const after = process.env.MIMIR_AFTER ? JSON.parse(process.env.MIMIR_AFTER) : undefined;
const sol = (l) => `${(Number(l) / 1e9).toFixed(6)} SOL`;
const args = { mint, ticker, after };

const plan = await new Mimir({ wallet, rpc: process.env.MIMIR_RPC }).createFeed({ ...args, dryRun: true });
console.log(`ticker: ${plan.ticker}`);
console.log(`feed:   ${plan.feed}`);
console.log(`pools:  ${plan.pools.map((p) => `${p.venue} ${p.pool}`).join("\n        ")}`);
console.log(`steps:  ${plan.steps.map((s) => `${s.kind} ${sol(s.costLamports)}`).join(", ")}`);
for (const w of plan.warnings) console.log(`warn:   ${w}`);
console.log(`total:  ${sol(plan.totalLamports)} plus the COLA purchase (${plan.tariffCola} COLA), paid in SOL at the live price`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("type YES to create on mainnet: ");
rl.close();
if (answer.trim() !== "YES") { console.log("aborted"); process.exit(0); }

let created;
try {
  created = await new Mimir({ rpc: process.env.MIMIR_RPC, wallet }).createFeed({ ...args, onStep: (e) => console.log(`step ${e.kind} ${e.state}${e.index != null ? ` ${e.index}/${e.of}` : ""}${e.signature ? ` ${e.signature}` : ""}`) });
} catch (e) {
  console.error(`error: ${e.code} ${e.message}${e.hint ? `\nhint:  ${e.hint}` : ""}`);
  console.error(`rerun exactly: MIMIR_AFTER='${JSON.stringify(e.signatures ?? [])}' node scripts/owner-real-test.mjs ${process.argv.slice(2).join(" ")}`);
  process.exit(1);
}
for (const s of created.signatures) console.log(`sig ${s.kind}: ${s.signature} (slot ${s.slot})`);
console.log(`feed:  ${created.feed} (${created.ticker})`);
console.log(`first: ${created.price.price} ${created.price.quote}`);
console.log(`cost:  ${created.cost.sol} SOL`);
for (const end = Date.now() + 60_000; ; await new Promise((r) => setTimeout(r, 5_000))) {
  try { const back = await new Mimir().price(created.feed); console.log(`api:   ${back.price} ${back.quote} ${back.status}`); break; }
  catch (e) { if (Date.now() > end) { console.error(`api read-back failed after 60 s: ${e.code} ${e.message}`); process.exit(1); } }
}
