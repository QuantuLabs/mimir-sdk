import assert from "node:assert/strict";
import type { Address } from "@solana/kit";
import { mimirSortedJsonSha256, preflightMimirConsumerAdmissionV1, type MimirAbi1Capability, type MimirConsumerBudgetCellV1,
  type MimirConsumerBudgetPayloadV1 } from "../src/beta/abi1Release.js";

const PROGRAM = "4kxKWPhWUZMj1x2D2BaCBW9BfeBZ6po4WagfzkUCsAt4" as Address;
const OTHER = "11111111111111111111111111111111" as Address;
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const CELL = "classic:N1S0:2.0.m6.E4|";
const cell = (c: string, over: Partial<MimirConsumerBudgetCellV1> = {}): MimirConsumerBudgetCellV1 =>
  ({ case: c, cell: CELL, keys: 40, bytes: 2_000, instructions: 4, signers: 2, cu: 300_000, status: "measured", ...over });
const payload = (cells: MimirConsumerBudgetCellV1[], over: Partial<MimirConsumerBudgetPayloadV1> = {}): MimirConsumerBudgetPayloadV1 => ({
  schema: "mimir-consumer-budget-a2-v1", consumer: "any", cluster_genesis_hash: GENESIS, mimir_program_id: PROGRAM, consumer_program_ids: [],
  limits: { keys: 64, targetMaxKeys: 54, bytes: 4096, instructions: 64, cu: 1_400_000 }, cases: ["A", "B"], cells, ...over });
const capabilityFor = (sha: string, over: object = {}) => ({ manifest: { clusterGenesisHash: GENESIS, programId: PROGRAM,
  consumerBudgets: [{ schema: "mimir-consumer-budget-a2-v1", sha256: sha }], ...over }, manifestSha256: "", cells: new Map() }) as unknown as MimirAbi1Capability;
const run = async (p: MimirConsumerBudgetPayloadV1, capOver?: object | null) => {
  const sha = await mimirSortedJsonSha256(p);
  return preflightMimirConsumerAdmissionV1({ contract: { contract_sha256: sha, payload: p }, contractSha256: sha, cell: CELL,
    ...(capOver === null ? {} : { capability: capabilityFor(sha, capOver) }) });
};
const malformed = (p: Promise<unknown>, label: string) => assert.rejects(p, /verified deployment/, label);

const good = payload([cell("A"), cell("B")]);
assert.deepEqual((await run(good)).reasons, ["SETUP_VIEW_MISSING"], "valid contract: only the setup views are missing");
await malformed(run(good, null), "no capability");
assert.deepEqual((await run(good, { consumerBudgets: [] })).reasons, ["SETUP_VIEW_MISSING"], "pinned contract absent from consumerBudgets: accepted");
const goodSha = await mimirSortedJsonSha256(good);
const pinned = (contractSha: string, pinnedSha: string) => preflightMimirConsumerAdmissionV1({ contract: { contract_sha256: contractSha, payload: good },
  contractSha256: pinnedSha, cell: CELL, capability: capabilityFor(goodSha, { consumerBudgets: [] }) });
await malformed(pinned(goodSha, "0".repeat(64)), "actual != pinned");
await malformed(pinned("0".repeat(64), goodSha), "contract_sha256 != actual");
await malformed(run(payload([cell("A"), cell("B")], { schema: "mimir-consumer-budget-a1-v1" as never })), "schema");
await malformed(run(payload([cell("A"), cell("B")], { limits: { keys: 64, targetMaxKeys: 54, bytes: 4096, instructions: 64, cu: 1_400_001 } })), "limits");
await malformed(run(good, { clusterGenesisHash: "x" }), "wrong genesis");
await malformed(run(good, { programId: OTHER }), "wrong program");
await malformed(run(payload([cell("A"), cell("B")], { mimir_program_id: OTHER }), { programId: PROGRAM }), "contract names another deployment");
await malformed(run(payload([cell("A", { keys: -1, bytes: -1, instructions: -1, signers: 99, cu: -1 }), cell("B")])), "reviewer probe");
for (const [label, over] of [["keys 65", { keys: 65 }], ["signers > keys", { keys: 3, signers: 4 }], ["signers -1", { signers: -1 }],
  ["bytes 4097", { bytes: 4_097 }], ["instructions 65", { instructions: 65 }], ["float keys", { keys: 1.5 }], ["unsafe bytes", { bytes: 2 ** 53 }],
  ["measured cu 0", { cu: 0 }], ["measured cu null", { cu: null }], ["measured cu 1.4M+1", { cu: 1_400_001 }], ["open with cu", { status: "open", cu: 5 }],
  ["key-limit with cu", { status: "KEY_LIMIT", cu: 5 }], ["status", { status: "model" as never }]] as const) {
  await malformed(run(payload([cell("A", over), cell("B")])), label);
}
await malformed(run(payload([cell("A"), cell("A"), cell("B")])), "duplicate (case, cell)");
const keyLimit = await run(payload([cell("A", { status: "KEY_LIMIT", cu: null, keys: 64 }), cell("B", { cu: 1_400_000 })]));
assert.deepEqual(keyLimit.reasons, ["TRANSPORT_KEYS", "SETUP_VIEW_MISSING"], "valid over-limit cell: precise transport refusal");
console.log("consumerAdmissionDomainsA2 ok");
