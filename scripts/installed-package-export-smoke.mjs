import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const smokeRoot = mkdtempSync(join(tmpdir(), "mimir-sdk-package-smoke-"));

try {
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", smokeRoot],
      {
        cwd: packageRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    ),
  );
  const filename = packResult?.[0]?.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("Installed package smoke could not resolve the packed tarball");
  }
  const tarballPath = join(smokeRoot, filename);
  const packedFiles = new Set(
    (packResult[0].files ?? []).map((entry) => entry.path),
  );
  const packedDocs = [...packedFiles].filter((path) => path === "docs" || path.startsWith("docs/"));
  if (packedDocs.sort().join() !== "docs/ADVANCED.md,docs/QUICKSTART.md") {
    throw new Error("Packed tarball must contain only docs/QUICKSTART.md and docs/ADVANCED.md from the docs tree");
  }
  for (const requiredPackagePath of [
    "dist/cjs/src/constants.js",
    "dist/cjs/src/creationExecutionInventoryEnvelope.js",
    "dist/cjs/src/publicApi.js",
    "dist/cjs/src/beta/index.js",
    "dist/src/codec.d.ts",
    "dist/src/instructions.d.ts",
    "dist/src/publicApi.d.ts",
    "dist/src/beta/index.d.ts",
    "docs/QUICKSTART.md",
  ]) {
    if (!packedFiles.has(requiredPackagePath)) {
      throw new Error(`Packed tarball is missing ${requiredPackagePath}`);
    }
  }

  const consumerRoot = join(smokeRoot, "consumer");
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      consumerRoot,
      tarballPath,
      "--ignore-scripts",
      "--omit=dev",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
    ],
    { stdio: "inherit" },
  );

  const installedPackageRoot = join(
    consumerRoot,
    "node_modules",
    "@quantulabs",
    "mimir-sdk",
  );
  if (lstatSync(installedPackageRoot).isSymbolicLink()) {
    throw new Error("Installed package smoke must use a copied tar dependency");
  }
  if (!realpathSync(installedPackageRoot).startsWith(realpathSync(consumerRoot))) {
    throw new Error("Installed package resolved outside the isolated consumer");
  }
  const installedManifest = JSON.parse(
    readFileSync(join(installedPackageRoot, "package.json"), "utf8"),
  );
  for (const dependency of ["@coral-xyz/anchor", "@meteora-ag/dlmm"]) {
    if (dependency in (installedManifest.dependencies ?? {})) {
      throw new Error(`Packed manifest must not depend on ${dependency}`);
    }
  }
  const consumerNodeModules = join(consumerRoot, "node_modules");
  const installedDirectories = [consumerNodeModules];
  while (installedDirectories.length > 0) {
    const current = installedDirectories.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(current, entry.name);
      if (path.endsWith(join("node_modules", "@coral-xyz", "anchor"))) {
        throw new Error(`Isolated consumer installed Anchor at ${path}`);
      }
      installedDirectories.push(path);
    }
  }
  const readme = readFileSync(join(installedPackageRoot, "README.md"), "utf8");
  const quickstartLink = readme.match(/\[[^\]]*\]\((\.\/docs\/QUICKSTART\.md)\)/)?.[1];
  if (!quickstartLink || resolve(installedPackageRoot, quickstartLink) !== join(installedPackageRoot, "docs/QUICKSTART.md") ||
    !packedFiles.has(quickstartLink.slice(2))) {
    throw new Error("Packed README quickstart link does not resolve inside the tarball");
  }
  const forbiddenPackedText = ["/Users/", "~/.config/solana", "id.json", ["dex", "screener"].join(""), ["Dex", "Screener"].join("")];
  const pending = [installedPackageRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        const contents = readFileSync(path);
        for (const forbidden of forbiddenPackedText) {
          if (contents.includes(Buffer.from(forbidden))) {
            throw new Error(`Installed package contains forbidden local path text in ${path.slice(installedPackageRoot.length + 1)}`);
          }
        }
      }
    }
  }
  for (const declarationPath of [
    "dist/src/codec.d.ts",
    "dist/src/instructions.d.ts",
    "dist/src/publicApi.d.ts",
    "dist/src/beta/index.d.ts",
  ]) {
    const declaration = readFileSync(join(installedPackageRoot, declarationPath));
    const digest = createHash("sha256").update(declaration).digest("hex");
    if (declaration.length === 0 || digest === createHash("sha256").digest("hex")) {
      throw new Error(`Installed declaration is empty: ${declarationPath}`);
    }
  }

  const esmSmoke = readFileSync(
    new URL("./installed-package-export-smoke-esm.mjs", import.meta.url),
    "utf8",
  );
  const cjsSmoke = readFileSync(
    new URL("./installed-package-export-smoke-cjs.cjs", import.meta.url),
    "utf8",
  );
  const betaDeclarations = readFileSync(join(installedPackageRoot, "dist/src/beta/index.d.ts"), "utf8");
  if (betaDeclarations.includes("@metaplex-foundation/umi") || betaDeclarations.includes("@solana/web3.js")) {
    throw new Error("Installed public beta declaration leaks an implementation boundary");
  }
  execFileSync("node", ["--input-type=module", "--eval", esmSmoke], {
    cwd: consumerRoot,
    stdio: "inherit",
  });
  execFileSync("node", ["--eval", cjsSmoke], {
    cwd: consumerRoot,
    stdio: "inherit",
  });
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
