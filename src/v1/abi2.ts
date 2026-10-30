import { getProgramDerivedAddress, type Address } from "@solana/kit";
import { addressBytes } from "../beta/bytes.js";
import { betaError } from "../beta/errors.js";
import {
  MIMIR_ABI1_LIMITS, observeMimirAbi1Deployment, verifyMimirCapabilityManifest, type MimirAbi1DeploymentObservation, type MimirBankCellV1, type MimirCapabilityManifestV1,
  type MimirCapabilityPacketV1,
} from "../beta/abi1Release.js";
import { MIMIR_DELETED_CLASSIC_TAGS, MIMIR_INIT_FUSED_CLASSIC_TAG } from "../beta/classicExecution.js";
import { MIMIR_INIT_FUSED_COMPOSITE_TAG, MIMIR_REMOVED_COMPOSITE_TAGS, type MimirFusedRecipe } from "../beta/compositeExecution.js";
import { MIMIR_V1_MAX_CREATE_LEN, MIMIR_V1_TAG } from "./build.js";
import * as C from "./layout/common.js";
import * as K from "./layout/classic.js";
import * as X from "./layout/composite.js";

export const MIMIR_V1_CAPABILITY_MANIFEST_SCHEMA = "mimir-capability-manifest-v1-abi2";
export const MIMIR_V1_ABI = "ABI-2";
/** Tags the V1 program dispatches. */
export const MIMIR_V1_CAPABILITY_TAGS = MIMIR_V1_TAG;
/** Tags the V1 program refuses: the deleted ABI-1 tags, the ABI-1 execution initializers 88/90 and the feed-closing tags 97-102. */
export const MIMIR_V1_REMOVED_TAGS = Object.freeze([...MIMIR_DELETED_CLASSIC_TAGS, ...MIMIR_REMOVED_COMPOSITE_TAGS,
  MIMIR_INIT_FUSED_COMPOSITE_TAG, MIMIR_INIT_FUSED_CLASSIC_TAG, 97, 98, 99, 100, 101, 102].sort((a, b) => a - b));
/** Transaction v1 limits (unchanged from ABI-1); realloc growth is the V1 create/grow step. */
export const MIMIR_V1_LIMITS = Object.freeze({ ...MIMIR_ABI1_LIMITS, reallocGrowth: MIMIR_V1_MAX_CREATE_LEN });
/** V1 account layout the manifest pins, from `./layout`. Composite prefix P = prefixFixed + prefixPerComponent × N. */
export const MIMIR_V1_STATE = Object.freeze({
  classic: Object.freeze({ magic: K.CLASSIC_MAGIC, version: K.CLASSIC_VERSION, prefixLength: C.CLASSIC_PREFIX_LEN, ownerOffset: K.CLASSIC_OWNER,
    ownerLength: C.OWNER_CLASSIC_LEN, headerOffset: K.CLASSIC_HEADER, headerLength: K.CLASSIC_HEADER_LEN, proofOffset: K.CLASSIC_PROOF,
    proofLength: K.PROOF_LEN, definitionOffset: K.CLASSIC_DEFINITION, feedImageLength: C.FEED_IMAGE_LEN, planImageOffset: K.CLASSIC_PLAN_IMAGE,
    planImageLength: C.PLAN_IMAGE_LEN, rowsOffset: K.CLASSIC_ROWS, rowLength: C.SOURCE_ROW_LEN, converterFixedLength: C.CONVERTER_FIXED_LEN,
    maxPrimaryRows: K.CLASSIC_MAX_PRIMARY_ROWS, maxConverterRows: K.CLASSIC_MAX_CONVERTER_ROWS }),
  composite: Object.freeze({ cspMagic: X.CSP_MAGIC, cspVersion: X.CSP_VERSION_VALUE, prefixFixed: C.COMPOSITE_PREFIX_FIXED_LEN,
    prefixPerComponent: C.COMPOSITE_PREFIX_COMPONENT_LEN, ownerLength: C.OWNER_COMPOSITE_LEN, cfcMagic: X.CFC_MAGIC, cfcVersion: X.CFC_VERSION_VALUE,
    cfcFixed: X.CFC_LEN_FIXED, cfcPerComponent: X.CFC_LEN_PER_COMPONENT, headerMagic: X.HDR_MAGIC, headerVersion: X.HDR_VERSION_VALUE,
    headerLength: X.HDR_LEN, feeLength: X.FEE_LEN, rowCompactLength: X.ROW_COMPACT_LEN, rowFullLength: X.ROW_FULL_LEN,
    rowDefLength: X.ROWDEF_LEN, minComponents: X.COMPOSITE_MIN_COMPONENTS, maxComponents: X.COMPOSITE_MAX_COMPONENTS,
    maxConverterRows: X.COMPOSITE_MAX_CONVERTER_ROWS }),
  common: Object.freeze({ descriptorLength: C.DESCRIPTOR_LEN, sourceImageLength: C.SOURCE_IMAGE_LEN, ringLength: C.RING_LEN,
    membershipHeaderLength: C.MEMBERSHIP_HEADER_LEN, membershipTupleLength: C.MEMBERSHIP_TUPLE_LEN, maxBindingWidth: C.MAX_BINDING_WIDTH,
    adminConfigLength: C.ADMIN_CONFIG_LEN, registryLength: C.REGISTRY_LEN, generationCounterLength: C.GENERATION_COUNTER_LEN,
    tickerClaimLength: C.TICKER_CLAIM_ACCOUNT_LEN, identityClaimLength: C.IDENTITY_CLAIM_LEN }),
});

/** V1 (ABI-2) capability manifest: the ABI-1 manifest fields with the V1 schema, tags, state and review. */
export type MimirV1CapabilityManifest = Omit<MimirCapabilityManifestV1, "schema" | "abi" | "tags" | "state" | "review"> & Readonly<{
  schema: typeof MIMIR_V1_CAPABILITY_MANIFEST_SCHEMA; abi: typeof MIMIR_V1_ABI;
  tags: Readonly<Record<keyof typeof MIMIR_V1_TAG, number>>; state: typeof MIMIR_V1_STATE;
  review: Readonly<{ codexReviewReportSha256: string; ponytailReportSha256: string }>;
}>;
export interface MimirV1Capability {
  readonly manifest: MimirV1CapabilityManifest; readonly manifestSha256: string; readonly cells: ReadonlyMap<string, MimirBankCellV1>;
}

const mismatch = (what: string): never => betaError("PROGRAM_ABI_MISMATCH", `ABI-2 capability mismatch: ${what}`);
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111" as Address;

/**
 * Reads the V1 deployment (program + ProgramData, two account reads) and authenticates it: both accounts owned by the Upgradeable Loader,
 * the program executable, ProgramData non-executable and equal to the loader PDA of the program id.
 */
export async function observeMimirV1Deployment(args: Readonly<{ programId: Address; elfLength: number; clusterGenesisHash: string;
  readAccount: (address: Address) => Promise<Readonly<{ owner: Address; executable: boolean; data: Uint8Array }> | null> }>): Promise<MimirAbi1DeploymentObservation> {
  const read = new Map<Address, Readonly<{ owner: Address; executable: boolean }>>();
  const observed = await observeMimirAbi1Deployment({ ...args, readAccount: async (address) => {
    const account = await args.readAccount(address); if (account) read.set(address, account); return account;
  } });
  const program = read.get(args.programId)!; const pd = read.get(observed.programDataAddress)!;
  const [canonical] = await getProgramDerivedAddress({ programAddress: UPGRADEABLE_LOADER, seeds: [addressBytes(args.programId)] });
  if (program.owner !== UPGRADEABLE_LOADER || program.executable !== true) mismatch("program account identity");
  if (observed.programDataAddress !== canonical || pd.owner !== UPGRADEABLE_LOADER || pd.executable !== false) mismatch("ProgramData account identity");
  return observed;
}

/** Bank gates a V1 manifest requires: each present, passing and without regressions (the bank's accepted exceptions are not regressions). */
export const MIMIR_V1_BANK_GATES = Object.freeze(["t1", "cu", "tsub", "ref05_no_abort"] as const);
export function assertMimirV1BankGates(report: Readonly<{ gates?: Readonly<Record<string, unknown>> }>): void {
  for (const gate of MIMIR_V1_BANK_GATES) {
    const g = report.gates?.[gate] as Readonly<{ pass?: unknown; regressions?: unknown }> | undefined;
    if (g?.pass !== true || !Array.isArray(g.regressions) || g.regressions.length !== 0) mismatch(`bank gate ${gate}`);
  }
}

/**
 * Fail-closed V1 (ABI-2) gate, the ABI-1 checks with the V1 constants: manifest hash, schema/abi, tags, state/limits, deployment/ELF identity
 * (`observeMimirV1Deployment`), frame gate, bank cells, consumer budget contract hash, and a measured exact-ELF cell per requested recipe.
 */
export async function verifyMimirAbi2Capability(args: Readonly<{
  manifest: MimirV1CapabilityManifest; expectedManifestSha256: string; observed: MimirAbi1DeploymentObservation;
  consumerContractSha256?: string; recipes?: readonly MimirFusedRecipe[]; packet?: MimirCapabilityPacketV1;
}>): Promise<MimirV1Capability> {
  return verifyMimirCapabilityManifest(args, { schema: MIMIR_V1_CAPABILITY_MANIFEST_SCHEMA, abi: MIMIR_V1_ABI, tags: MIMIR_V1_CAPABILITY_TAGS,
    removedTags: MIMIR_V1_REMOVED_TAGS, state: MIMIR_V1_STATE, limits: MIMIR_V1_LIMITS, fail: mismatch });
}
