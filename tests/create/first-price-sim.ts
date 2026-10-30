import { readFileSync } from 'node:fs';
import { getAddressEncoder, type Address } from '@solana/kit';

const FEED = readFileSync('tests/fixtures/layout_v1/classic/reference_usdc_cpmm_m0.bin');
const COMPOSITE = readFileSync('tests/fixtures/layout_v1/composite/two_comp_reuse.bin');

/** 500 ms slots: the auto ages stay at the 150 slots the fixtures expect. */
export const slotSamples = () => ({ send: async () => [{ numSlots: 120, samplePeriodSecs: 60 }] });

/** A Classic feed account at `feed` whose snapshot is a Fresh price (status 0, slot 9, mantissa `mantissa`). */
export function firstPriceFeed(feed: Address, mantissa = 1n, status = 0) {
  const bytes = new Uint8Array(FEED), view = new DataView(bytes.buffer);
  bytes.set(getAddressEncoder().encode(feed), 48);
  bytes[104] = status; view.setBigUint64(116, 9n, true); view.setBigUint64(188, mantissa, true);
  return bytes;
}

/** A composite account at `composite` whose snapshot is a Fresh price (status, price state, conditions and conditioned rows 0, mantissa 1). */
export function firstPriceComposite(composite: Address) {
  const bytes = new Uint8Array(COMPOSITE), view = new DataView(bytes.buffer);
  bytes.set(getAddressEncoder().encode(composite), 48);
  bytes[104] = 0; view.setBigUint64(152, 1n, true); view.setUint16(314, 0, true); bytes[318] = 0; bytes[319] = 0;
  return bytes;
}

/** The gate's last instruction is its first refresh, whose data ends before the one signature: tag87 is 106 + 8k bytes (n at +57), tag89 104 + 8w. */
const compositeGate = (wire: Uint8Array) => Array.from({ length: 10 }, (_, k) => wire.length - 64 - 106 - 8 * (k + 1))
  .some((at) => wire[at] === 87 && wire[at + 57]! >= 1 && wire[at + 57]! <= 5);

/** simulateTransaction: CREATE + first refresh succeed and every requested post-account is a Fresh feed of the gate's kind. */
export const freshFirstPrice = (wire: string, config?: { minContextSlot?: bigint; accounts?: { addresses: readonly Address[] } }) => ({ send: async () => {
  const image = compositeGate(Buffer.from(wire, 'base64')) ? firstPriceComposite : firstPriceFeed;
  return { context: { slot: config?.minContextSlot ?? 9n },
    value: { err: null, logs: [], accounts: (config?.accounts?.addresses ?? []).map((x) => ({ data: [Buffer.from(image(x)).toString('base64'), 'base64'] })) } };
} });

/** The first-price gate (its own simulation replaces the blockhash) answers Fresh; every other simulation goes to `other`. */
export const gateOr = <T>(other: (wire: string, config?: object) => T) => (wire: string, config?: { replaceRecentBlockhash?: boolean; minContextSlot?: bigint; accounts?: { addresses: readonly Address[] } }) =>
  config?.replaceRecentBlockhash ? freshFirstPrice(wire, config) as T : other(wire, config);
