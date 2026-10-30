import { getProgramDerivedAddress, type Address } from "@solana/kit";

const pdaMemo = new Map<string, Promise<readonly [Address, number]>>();

/** `getProgramDerivedAddress`, memoized by program and seeds. */
export function getProgramDerivedAddressCached(programAddress: Address, seeds: readonly Uint8Array[]): Promise<readonly [Address, number]> {
  const key = programAddress + seeds.map((seed) => "|" + Array.from(seed, (b) => b.toString(16).padStart(2, "0")).join("")).join("");
  let derived = pdaMemo.get(key);
  if (!derived) {
    if (pdaMemo.size >= 4096) pdaMemo.clear();
    derived = getProgramDerivedAddress({ programAddress, seeds: [...seeds] });
    pdaMemo.set(key, derived);
    derived.catch(() => pdaMemo.delete(key));
  }
  return derived;
}
