// node scripts/installed-v1-node10-types.mjs <sdk.tgz>: installs the packed SDK into an isolated consumer and type-checks
// `@quantulabs/mimir-sdk/v1` and `/v1/refresh` under `moduleResolution: node10` (CJS consumers resolve subpaths via typesVersions).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tarball = resolve(process.argv[2] ?? "");
const tsc = join(dirname(dirname(fileURLToPath(import.meta.url))), "node_modules", "typescript", "bin", "tsc");
const root = mkdtempSync(join(tmpdir(), "mimir-sdk-node10-"));
try {
  execFileSync("npm", ["install", "--prefix", root, tarball, "--ignore-scripts", "--omit=dev", "--prefer-offline", "--no-audit", "--no-fund"], { stdio: "inherit" });
  writeFileSync(join(root, "check.ts"), `import { observeMimirV1Deployment, verifyMimirAbi2Capability, type MimirV1CapabilityManifest } from "@quantulabs/mimir-sdk/v1";
import { prepareMimirV1ClassicRefresh, type MimirV1PreparedRefresh } from "@quantulabs/mimir-sdk/v1/refresh";
export const checks: [typeof observeMimirV1Deployment, typeof verifyMimirAbi2Capability, typeof prepareMimirV1ClassicRefresh] =
  [observeMimirV1Deployment, verifyMimirAbi2Capability, prepareMimirV1ClassicRefresh];
export type Checked = [MimirV1CapabilityManifest["schema"], MimirV1PreparedRefresh];
`);
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "commonjs", moduleResolution: "node10", strict: true,
    noEmit: true, skipLibCheck: true, types: [] }, files: ["check.ts"] }));
  execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.json")], { stdio: "inherit" });
  console.log("installed v1 node10 types ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
