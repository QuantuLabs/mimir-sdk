import { sha256 } from "@noble/hashes/sha256";
import { Buffer } from "buffer";

/** The `node:crypto` `createHash("sha256")` surface the SDK uses, on @noble/hashes so it also runs in a browser. */
export function createHash(_algorithm: "sha256") {
  const hash = sha256.create();
  const hasher = {
    update(data: Uint8Array | string, _encoding?: "ascii" | "utf8") {
      hash.update(typeof data === "string" ? Buffer.from(data, _encoding) : data);
      return hasher;
    },
    digest: ((encoding?: "hex") => {
      const out = Buffer.from(hash.digest());
      return encoding ? out.toString(encoding) : out;
    }) as { (): Buffer; (encoding: "hex"): string },
  };
  return hasher;
}
