#!/usr/bin/env node
// Every ```ts block of the README, compiled with strict tsc against the built package (self-reference), with only the free names declared.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url))), dir = join(root, ".readme-check");
const blocks = [...readFileSync(join(root, "README.md"), "utf8").matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]);
if (blocks.length < 6) throw new Error(`expected the 5 snippets and the server split, found ${blocks.length} ts blocks`);
const free = `declare const wallet: unknown;\ndeclare const yourInstruction: import("@solana/web3.js").TransactionInstruction;\n`;
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
blocks.forEach((code, i) => writeFileSync(join(dir, `snippet${i + 1}.mts`), (/\bwallet\b/.test(code) && !/declare const wallet/.test(code) ? free : /yourInstruction/.test(code) ? free : "") + code + "\nexport {};\n"));
writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "nodenext", moduleResolution: "nodenext",
  noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: false, skipLibCheck: true, types: ["node"] }, include: ["*.mts"] }));
try {
  execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", dir], { stdio: "inherit" });
  console.log(`README samples: ${blocks.length} blocks pass strict tsc`);
} finally { rmSync(dir, { recursive: true, force: true }); }
