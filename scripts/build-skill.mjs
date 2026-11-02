// Builds the agent skill skills/mimir-oracle/SKILL.md from AGENTS.md. `--check` exits 1 when the skill is out of date.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "skills/mimir-oracle/SKILL.md";
const BLOB = "https://github.com/QuantuLabs/mimir-sdk/blob/main/";

const header = `---
name: mimir-oracle
description: Integrate Mimir, a Solana oracle that computes token and index prices on chain from DEX pools (Raydium, Orca, Meteora, PumpSwap), with the TypeScript SDK @quantulabs/mimir-sdk. Use it to read or watch a Solana token price, to refresh and read a price inside your own transaction for a Solana program, or to create a price feed or an index for a token mint.
---
`;

const body = readFileSync("AGENTS.md", "utf8")
  .replace(/^# AGENTS\.md: integrating/, "# Integrating")
  .split("\n## Working on this repository")[0]
  .replace(/\bdocs\/([A-Z]+\.md)\b/g, `${BLOB}docs/$1`)
  .trimEnd();

const skill = `${header}\n${body}\n\nDocs: https://mimirfeeds.io/docs/ · API: https://api.mimirfeeds.io · SDK: https://github.com/QuantuLabs/mimir-sdk\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {}
  if (current !== skill) {
    console.error(`${OUT} is out of date: run npm run build:skill`);
    process.exit(1);
  }
} else {
  mkdirSync("skills/mimir-oracle", { recursive: true });
  writeFileSync(OUT, skill);
}
