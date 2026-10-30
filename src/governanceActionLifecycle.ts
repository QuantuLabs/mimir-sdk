import { freshNumberRecord } from "./internal/canonicalAuthority.js";
import type {
  GovernanceActionHeader,
  GovernancePolicyHeader,
} from "./types.js";

const {
  GovernanceActionStatus,
  GovernanceActionTargetKind,
  GovernancePolicyStatus,
} = {
  GovernanceActionStatus: freshNumberRecord("GovernanceActionStatus"),
  GovernanceActionTargetKind: freshNumberRecord("GovernanceActionTargetKind"),
  GovernancePolicyStatus: freshNumberRecord("GovernancePolicyStatus"),
};

export const GOVERNANCE_ACTION_LIFECYCLE_POLICY_HASH_DOMAIN =
  "MIMIR_GOVERNANCE_ACTION_LIFECYCLE_POLICY_V1";

export type GovernanceActionLifecycleFailure =
  | "PolicyNotActive"
  | "UnknownSigner"
  | "PolicyMismatch"
  | "ActionHashMissing"
  | "ActionHashMismatch"
  | "UnsupportedTargetKind"
  | "StatusMismatch"
  | "ApprovalMaskMismatch"
  | "ThresholdMismatch"
  | "ProposedSlotMismatch"
  | "EffectiveSlotTooEarly"
  | "InvalidExpiry"
  | "ExpiryTooLate"
  | "RevisionMismatch"
  | "ActionExpired"
  | "InvalidStatus"
  | "DuplicateApproval";

export interface GovernanceActionLifecycleEvaluation {
  eligible: boolean;
  failureCodes: readonly GovernanceActionLifecycleFailure[];
  signerBit: number | null;
  expectedStatus: number | null;
  minEffectiveSlot: bigint | null;
  maxExpiresSlot: bigint | null;
  nextApprovalMask: number | null;
  nextStatus: number | null;
  nextRevision: bigint | null;
}

export interface EvaluateNewGovernanceActionHeaderArgs {
  policy: GovernancePolicyHeader;
  action: GovernanceActionHeader;
  policyAddress: Uint8Array;
  proposer: Uint8Array;
  clockSlot: bigint;
}

export interface EvaluateGovernanceActionApprovalArgs {
  policy: GovernancePolicyHeader;
  action: GovernanceActionHeader;
  policyAddress: Uint8Array;
  actionHash: Uint8Array;
  signer: Uint8Array;
  clockSlot: bigint;
  expectedActionRevision: bigint;
}

const SUPPORTED_TARGET_KINDS = [
  GovernanceActionTargetKind.Registry,
  GovernanceActionTargetKind.Policy,
] as const;

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isZeroBytes(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

function countApprovalBits(mask: number): number {
  let count = 0;
  let value = mask & 0b0000_0111;
  while (value !== 0) {
    count += value & 1;
    value >>= 1;
  }
  return count;
}

export function governancePolicySignerBit(
  policy: GovernancePolicyHeader,
  signer: Uint8Array,
): number | null {
  if (equalBytes(policy.signer0, signer)) return 1;
  if (equalBytes(policy.signer1, signer)) return 2;
  if (equalBytes(policy.signer2, signer)) return 4;
  return null;
}

function supportedTargetKind(targetKind: number): boolean {
  return SUPPORTED_TARGET_KINDS.includes(
    targetKind as (typeof SUPPORTED_TARGET_KINDS)[number],
  );
}

function baseLifecycleEvaluation(
  failureCodes: GovernanceActionLifecycleFailure[],
  signerBit: number | null,
  expectedStatus: number | null,
  minEffectiveSlot: bigint | null,
  maxExpiresSlot: bigint | null,
): GovernanceActionLifecycleEvaluation {
  return {
    eligible: failureCodes.length === 0,
    failureCodes,
    signerBit,
    expectedStatus,
    minEffectiveSlot,
    maxExpiresSlot,
    nextApprovalMask: null,
    nextStatus: null,
    nextRevision: null,
  };
}

export function evaluateNewGovernanceActionHeader(
  args: EvaluateNewGovernanceActionHeaderArgs,
): GovernanceActionLifecycleEvaluation {
  const signerBit = governancePolicySignerBit(args.policy, args.proposer);
  const expectedStatus =
    args.policy.threshold === 1
      ? GovernanceActionStatus.Approved
      : GovernanceActionStatus.Pending;
  const minEffectiveSlot = args.clockSlot + args.policy.minDelaySlots;
  const maxExpiresSlot = args.action.effectiveSlot + args.policy.actionTtlSlots;
  const failures: GovernanceActionLifecycleFailure[] = [];

  if (args.policy.status !== GovernancePolicyStatus.Active) {
    failures.push("PolicyNotActive");
  }
  if (signerBit == null) failures.push("UnknownSigner");
  if (!equalBytes(args.action.policy, args.policyAddress)) {
    failures.push("PolicyMismatch");
  }
  if (isZeroBytes(args.action.actionHash)) failures.push("ActionHashMissing");
  if (!supportedTargetKind(args.action.targetKind)) {
    failures.push("UnsupportedTargetKind");
  }
  if (args.action.status !== expectedStatus) failures.push("StatusMismatch");
  if (signerBit != null && args.action.approvalMask !== signerBit) {
    failures.push("ApprovalMaskMismatch");
  }
  if (args.action.threshold !== args.policy.threshold) {
    failures.push("ThresholdMismatch");
  }
  if (args.action.proposedSlot !== args.clockSlot) {
    failures.push("ProposedSlotMismatch");
  }
  if (args.action.effectiveSlot < minEffectiveSlot) {
    failures.push("EffectiveSlotTooEarly");
  }
  if (args.action.expiresSlot <= args.action.effectiveSlot) {
    failures.push("InvalidExpiry");
  }
  if (args.action.expiresSlot > maxExpiresSlot) {
    failures.push("ExpiryTooLate");
  }
  if (args.action.revision !== 1n) failures.push("RevisionMismatch");

  return baseLifecycleEvaluation(
    failures,
    signerBit,
    expectedStatus,
    minEffectiveSlot,
    maxExpiresSlot,
  );
}

export function evaluateGovernanceActionApproval(
  args: EvaluateGovernanceActionApprovalArgs,
): GovernanceActionLifecycleEvaluation {
  const signerBit = governancePolicySignerBit(args.policy, args.signer);
  const failures: GovernanceActionLifecycleFailure[] = [];
  const expectedStatus =
    args.policy.threshold === 1
      ? GovernanceActionStatus.Approved
      : GovernanceActionStatus.Pending;
  const minEffectiveSlot = args.action.proposedSlot + args.policy.minDelaySlots;
  const maxExpiresSlot = args.action.effectiveSlot + args.policy.actionTtlSlots;

  if (args.policy.status !== GovernancePolicyStatus.Active) {
    failures.push("PolicyNotActive");
  }
  if (signerBit == null) failures.push("UnknownSigner");
  if (!equalBytes(args.action.policy, args.policyAddress)) {
    failures.push("PolicyMismatch");
  }
  if (!equalBytes(args.action.actionHash, args.actionHash)) {
    failures.push("ActionHashMismatch");
  }
  if (args.action.revision !== args.expectedActionRevision) {
    failures.push("RevisionMismatch");
  }
  if (args.action.expiresSlot < args.clockSlot) {
    failures.push("ActionExpired");
  }
  if (args.action.status > GovernanceActionStatus.Approved) {
    failures.push("InvalidStatus");
  }
  if (signerBit != null && (args.action.approvalMask & signerBit) !== 0) {
    failures.push("DuplicateApproval");
  }

  if (failures.length !== 0 || signerBit == null) {
    return baseLifecycleEvaluation(
      failures,
      signerBit,
      expectedStatus,
      minEffectiveSlot,
      maxExpiresSlot,
    );
  }

  const nextApprovalMask = args.action.approvalMask | signerBit;
  const nextRevision = args.action.revision + 1n;
  const nextStatus =
    countApprovalBits(nextApprovalMask) >= args.policy.threshold
      ? GovernanceActionStatus.Approved
      : GovernanceActionStatus.Pending;

  return {
    eligible: true,
    failureCodes: [],
    signerBit,
    expectedStatus,
    minEffectiveSlot,
    maxExpiresSlot,
    nextApprovalMask,
    nextStatus,
    nextRevision,
  };
}
