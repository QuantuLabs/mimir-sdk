import { address, type Address } from "@solana/kit";
import { MPL_CORE_PROGRAM_ID } from "@metaplex-foundation/mpl-core";
import { utf8 } from "./bytes.js";
import { betaError } from "./errors.js";

export type MimirBetaCluster = "localnet" | "devnet" | "mainnet-beta";

export interface MimirBetaDeployment {
  readonly cluster: MimirBetaCluster;
  readonly mimirProgramId: Address;
  readonly agentRegistryProgramId: Address;
  readonly mplCoreProgramId: Address;
  readonly systemProgramId: Address;
  readonly physicalCollection: Address;
  readonly collectionPointer: string;
}

export const MIMIR_BETA_MPL_CORE_PROGRAM_ID = MPL_CORE_PROGRAM_ID as unknown as Address;
export const MIMIR_BETA_SYSTEM_PROGRAM_ID = "11111111111111111111111111111111" as Address;

function checkedAddress(value: Address, label: string): Address {
  try {
    return address(value);
  } catch {
    return betaError("INVALID_ARGUMENT", `${label} is not a canonical Solana address`);
  }
}

export function validateMimirBetaCollectionPointer(value: string): string {
  if (typeof value !== "string" || !/^c1:[a-z2-7]+$/.test(value)) {
    betaError("INVALID_ARGUMENT", "non-canonical collection pointer");
  }
  const bytes = utf8(value);
  if (bytes.length === 0 || bytes.length > 128) {
    betaError("INVALID_ARGUMENT", "collection pointer UTF-8 length invalid");
  }
  return value;
}

export function validateMimirBetaDeployment(input: MimirBetaDeployment): MimirBetaDeployment {
  if (!input || !(["localnet", "devnet", "mainnet-beta"] as const).includes(input.cluster)) {
    betaError("INVALID_ARGUMENT", "unsupported beta cluster");
  }
  const deployment: MimirBetaDeployment = {
    cluster: input.cluster,
    mimirProgramId: checkedAddress(input.mimirProgramId, "Mimir program"),
    agentRegistryProgramId: checkedAddress(input.agentRegistryProgramId, "8004 program"),
    mplCoreProgramId: checkedAddress(input.mplCoreProgramId, "MPL Core program"),
    systemProgramId: checkedAddress(input.systemProgramId, "System program"),
    physicalCollection: checkedAddress(input.physicalCollection, "physical collection"),
    collectionPointer: validateMimirBetaCollectionPointer(input.collectionPointer),
  };
  if (deployment.mplCoreProgramId !== MIMIR_BETA_MPL_CORE_PROGRAM_ID) {
    betaError("INVALID_ARGUMENT", "non-canonical MPL Core program");
  }
  if (deployment.systemProgramId !== MIMIR_BETA_SYSTEM_PROGRAM_ID) {
    betaError("INVALID_ARGUMENT", "non-canonical System program");
  }
  const roles = [
    deployment.mimirProgramId,
    deployment.agentRegistryProgramId,
    deployment.mplCoreProgramId,
    deployment.systemProgramId,
    deployment.physicalCollection,
  ];
  if (new Set(roles).size !== roles.length || roles.includes(deployment.collectionPointer as Address)) {
    betaError("INVALID_ARGUMENT", "role-confusable deployment values");
  }
  return Object.freeze(deployment);
}
