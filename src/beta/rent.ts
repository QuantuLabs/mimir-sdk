import type { Address } from "@solana/kit";
import { betaError } from "./errors.js";
import type { MimirBetaFinalizedRpc } from "./rpc.js";

export const MIMIR_RENT_SYSVAR = "SysvarRent111111111111111111111111111111111" as Address;
const ACCOUNT_STORAGE_OVERHEAD = 128n;

export interface MimirRentSysvar {
  readonly lamportsPerByteYear: bigint;
  readonly exemptionThreshold: number;
  readonly burnPercent: number;
}

export function decodeMimirRentSysvar(data: Uint8Array): MimirRentSysvar {
  if (data.length < 17) betaError("ACCOUNT_MALFORMED", "rent sysvar data is too short", MIMIR_RENT_SYSVAR);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { lamportsPerByteYear: view.getBigUint64(0, true), exemptionThreshold: view.getFloat64(8, true), burnPercent: data[16]! };
}

export function computeMimirRentExemptLamports(rent: MimirRentSysvar, dataLength: bigint | number): bigint {
  const length = BigInt(dataLength);
  if (length < 0n) betaError("INVALID_ARGUMENT", "data length is negative");
  if (rent.exemptionThreshold !== 1 && rent.exemptionThreshold !== 2) {
    betaError("RENT_THRESHOLD_UNSUPPORTED", `rent exemption threshold ${rent.exemptionThreshold} is unsupported`, MIMIR_RENT_SYSVAR);
  }
  return (length + ACCOUNT_STORAGE_OVERHEAD) * rent.lamportsPerByteYear * BigInt(rent.exemptionThreshold);
}

export async function readMimirRentSysvar(rpc: Pick<MimirBetaFinalizedRpc, "getAccountInfo">): Promise<MimirRentSysvar> {
  const response = await rpc.getAccountInfo(MIMIR_RENT_SYSVAR, { commitment: "finalized", encoding: "base64" }).send() as
    { value?: { data?: unknown } | null } | null;
  const data = response?.value?.data;
  if (!Array.isArray(data) || typeof data[0] !== "string") betaError("ACCOUNT_NOT_FOUND", "rent sysvar unavailable", MIMIR_RENT_SYSVAR);
  return decodeMimirRentSysvar(Uint8Array.from(atob(data[0] as string), (c) => c.charCodeAt(0)));
}

export async function getMimirRentExemptLamports(rpc: Pick<MimirBetaFinalizedRpc, "getAccountInfo">, dataLength: bigint | number): Promise<bigint> {
  return computeMimirRentExemptLamports(await readMimirRentSysvar(rpc), dataLength);
}
