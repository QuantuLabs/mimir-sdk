export function sourceAdapterSupportsVersion(adapterType: number, adapterVersion: number): boolean {
  if (!Number.isInteger(adapterType) || !Number.isInteger(adapterVersion)) return false;
  if (adapterVersion === 0) return [0, 1, 2, 3, 4, 6, 7].includes(adapterType);
  return adapterVersion === 1 && (adapterType === 1 || adapterType === 3 || adapterType === 6);
}
