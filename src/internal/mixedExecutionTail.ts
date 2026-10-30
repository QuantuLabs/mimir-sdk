/** Producer tail width for an execution-native source, or null when the family/version has no execution form. */
export function mixedExecutionNativeTailWidth(kind: number, adapterVersion: number): number | null {
  if (adapterVersion !== 0 && adapterVersion !== 1) return null;
  if (kind === 1) return 2 + adapterVersion;
  if (kind === 2) return adapterVersion === 0 ? 4 : null;
  return kind === 3 ? 4 + adapterVersion : null;
}
