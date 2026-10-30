import { readFileSync } from "node:fs";
import type { Address } from "@solana/kit";

const CLOCK = "SysvarC1ock11111111111111111111111111111111" as Address;
const recorded = JSON.parse(readFileSync(new URL("./native-ready-clmm-observation.json", import.meta.url), "utf8"));
type Acc = { owner: Address; executable: boolean; data: Uint8Array; fixtureRole?: string };

/** Gives a capture-fixture store an authentic Clock at `slot` and a ready native history: the recorded EZVk CLMM observation, a dense CPMM one. */
export function withReadyNativeHistory(store: Map<Address, Acc>, slot: bigint): void {
  const now = BigInt(recorded.clockUnix);
  const clock = new Uint8Array(40); const cv = new DataView(clock.buffer); cv.setBigUint64(0, slot, true); cv.setBigInt64(32, now, true);
  store.set(CLOCK, { owner: "Sysvar1111111111111111111111111111111111111" as Address, executable: false, data: clock });
  for (const [address, account] of store) {
    if (account.fixtureRole === "clmm-observation") {
      const data = Uint8Array.from(Buffer.from(recorded.data, "base64")); data.set(account.data.subarray(19, 51), 19);
      store.set(address, { ...account, data });
    } else if (account.fixtureRole === "cpmm-observation") {
      const data = Uint8Array.from(account.data); const v = new DataView(data.buffer);
      v.setUint16(9, 1, true); v.setBigUint64(43, now - 300n, true); data[51] = 1; v.setBigUint64(83, now - 5n, true); data[91] = 1; v.setBigUint64(4_043, now - 5n, true);
      store.set(address, { ...account, data });
    }
  }
}
