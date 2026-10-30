import assert from "node:assert/strict";

import {
  EXECUTABLE_SOURCE_ADAPTER_MASK_V0,
  SOURCE_ADAPTER_MAX,
  SourceAdapterType,
} from "../src/constants.js";
import {
  MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1,
  mimirCreationExecutionInventoryAddressBoundV1,
  type MimirCreationExecutionSourceShapeV1,
} from "../src/creationExecutionInventoryEnvelope.js";

const envelope = MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1;

assert.equal(SourceAdapterType.PumpSwap, 6);
assert.equal(SOURCE_ADAPTER_MAX, 7);
assert.equal(EXECUTABLE_SOURCE_ADAPTER_MASK_V0, 223n);
assert.equal(envelope.schema, "mimir-creation-execution-inventory-envelope");
assert.equal(envelope.version, 1);
assert.equal(envelope.adapterVersion, 0);
assert.equal(envelope.executableAdapterMask, EXECUTABLE_SOURCE_ADAPTER_MASK_V0);
assert.equal(envelope.maxSources, 5);
assert.equal(envelope.commonDistinctAddressCount, 9);
assert.equal(envelope.maxSourceRefreshInstructionCount, 5);
assert.equal(envelope.maxTerminalMimirRefreshInstructionCount, 1);
assert.equal(envelope.maxDistinctMimirAddressCount, 54);
assert.deepEqual(envelope.dynamicPolicy, {
  bootstrap: "bootstrap-current-only",
  runtime: "runtime-static-or-session-companion",
  coverage: "not-eternal",
});

assert.deepEqual(envelope.perAdapter[SourceAdapterType.OrcaWhirlpool], {
  adapterType: SourceAdapterType.OrcaWhirlpool,
  shapes: {
    basic: { stable: 6, dynamic: 0, max: 6 },
    routeable: { stable: 6, dynamic: 3, max: 9 },
  },
  stable: 6,
  dynamic: 3,
  max: 9,
});
assert.deepEqual(envelope.perAdapter[SourceAdapterType.RaydiumClmm], {
  adapterType: SourceAdapterType.RaydiumClmm,
  shapes: {
    basic: { stable: 6, dynamic: 0, max: 6 },
    routeable: { stable: 6, dynamic: 3, max: 9 },
  },
  stable: 6,
  dynamic: 3,
  max: 9,
});
assert.deepEqual(envelope.perAdapter[SourceAdapterType.RaydiumCpmm], {
  adapterType: SourceAdapterType.RaydiumCpmm,
  shapes: {
    basic: { stable: 6, dynamic: 0, max: 6 },
    "native-twap": { stable: 8, dynamic: 0, max: 8 },
  },
  stable: 8,
  dynamic: 0,
  max: 8,
});
assert.deepEqual(envelope.perAdapter[SourceAdapterType.MeteoraDlmm], {
  adapterType: SourceAdapterType.MeteoraDlmm,
  shapes: {
    basic: { stable: 5, dynamic: 1, max: 6 },
    routeable: { stable: 5, dynamic: 3, max: 8 },
  },
  stable: 5,
  dynamic: 3,
  max: 8,
});
assert.deepEqual(envelope.perAdapter[SourceAdapterType.RaydiumAmmV4], {
  adapterType: SourceAdapterType.RaydiumAmmV4,
  shapes: {
    basic: { stable: 6, dynamic: 0, max: 6 },
  },
  stable: 6,
  dynamic: 0,
  max: 6,
});
assert.deepEqual(envelope.perAdapter[SourceAdapterType.MeteoraDammV2], {
  adapterType: SourceAdapterType.MeteoraDammV2,
  shapes: {
    basic: { stable: 5, dynamic: 0, max: 5 },
  },
  stable: 5,
  dynamic: 0,
  max: 5,
});
assert.deepEqual(envelope.perAdapter[SourceAdapterType.PumpSwap], {
  adapterType: SourceAdapterType.PumpSwap,
  shapes: {
    basic: { stable: 7, dynamic: 0, max: 7 },
  },
  stable: 7,
  dynamic: 0,
  max: 7,
});

const executableShapes: readonly MimirCreationExecutionSourceShapeV1[] = [
  { adapterType: SourceAdapterType.OrcaWhirlpool, shape: "basic" },
  { adapterType: SourceAdapterType.OrcaWhirlpool, shape: "routeable" },
  { adapterType: SourceAdapterType.RaydiumClmm, shape: "basic" },
  { adapterType: SourceAdapterType.RaydiumClmm, shape: "routeable" },
  { adapterType: SourceAdapterType.RaydiumCpmm, shape: "basic" },
  { adapterType: SourceAdapterType.RaydiumCpmm, shape: "native-twap" },
  { adapterType: SourceAdapterType.MeteoraDlmm, shape: "basic" },
  { adapterType: SourceAdapterType.MeteoraDlmm, shape: "routeable" },
  { adapterType: SourceAdapterType.RaydiumAmmV4, shape: "basic" },
  { adapterType: SourceAdapterType.MeteoraDammV2, shape: "basic" },
  { adapterType: SourceAdapterType.PumpSwap, shape: "basic" },
] as const;

let evaluatedCombinationCount = 0;
let observedMaximum = 0;
function enumerate(prefix: MimirCreationExecutionSourceShapeV1[], target: number): void {
  if (prefix.length === target) {
    const actual = mimirCreationExecutionInventoryAddressBoundV1({
      adapterVersion: 0,
      sources: prefix,
    });
    assert.ok(actual <= envelope.maxDistinctMimirAddressCount);
    observedMaximum = Math.max(observedMaximum, actual);
    evaluatedCombinationCount += 1;
    return;
  }
  for (const source of executableShapes) {
    enumerate([...prefix, source], target);
  }
}

for (let sourceCount = 1; sourceCount <= envelope.maxSources; sourceCount += 1) {
  enumerate([], sourceCount);
}
assert.equal(evaluatedCombinationCount, 177_155);
assert.equal(observedMaximum, 54);

assert.throws(
  () =>
    mimirCreationExecutionInventoryAddressBoundV1({
      adapterVersion: 1 as 0,
      sources: [executableShapes[0]!],
    }),
  /UnsupportedMimirCreationExecutionAdapterVersion:1/,
);
for (const unsupportedAdapter of [SourceAdapterType.Custom]) {
  assert.throws(
    () =>
      mimirCreationExecutionInventoryAddressBoundV1({
        adapterVersion: 0,
        sources: [{ adapterType: unsupportedAdapter, shape: "basic" }] as never,
      }),
    new RegExp(`UnsupportedMimirCreationExecutionAdapter:${unsupportedAdapter}`),
  );
}
assert.throws(
  () =>
    mimirCreationExecutionInventoryAddressBoundV1({
      adapterVersion: 0,
      sources: [],
    }),
  /InvalidMimirCreationExecutionSourceCount:0/,
);
assert.throws(
  () =>
    mimirCreationExecutionInventoryAddressBoundV1({
      adapterVersion: 0,
      sources: Array.from({ length: 6 }, () => executableShapes[0]!),
    }),
  /InvalidMimirCreationExecutionSourceCount:6/,
);
assert.throws(
  () =>
    mimirCreationExecutionInventoryAddressBoundV1({
      adapterVersion: 0,
      sources: [
        { adapterType: SourceAdapterType.RaydiumCpmm, shape: "routeable" },
      ] as never,
    }),
  /UnsupportedMimirCreationExecutionAdapterShape:2:routeable/,
);
for (const inheritedShapeName of [
  "__proto__",
  "constructor",
  "toString",
  "hasOwnProperty",
]) {
  assert.throws(
    () =>
      mimirCreationExecutionInventoryAddressBoundV1({
        adapterVersion: 0,
        sources: [
          {
            adapterType: SourceAdapterType.RaydiumCpmm,
            shape: inheritedShapeName,
          },
        ] as never,
      }),
    new RegExp(
      `UnsupportedMimirCreationExecutionAdapterShape:2:${inheritedShapeName}`,
    ),
  );
}

assert.ok(Object.isFrozen(envelope));
assert.ok(Object.isFrozen(envelope.dynamicPolicy));
assert.ok(Object.isFrozen(envelope.perAdapter));
assert.ok(Object.isFrozen(envelope.perAdapter[SourceAdapterType.RaydiumCpmm]));
assert.ok(Object.isFrozen(envelope.perAdapter[SourceAdapterType.RaydiumCpmm].shapes));
assert.ok(Object.isFrozen(envelope.perAdapter[SourceAdapterType.RaydiumAmmV4]));
assert.ok(Object.isFrozen(envelope.perAdapter[SourceAdapterType.RaydiumAmmV4].shapes));
assert.ok(Object.isFrozen(envelope.perAdapter[SourceAdapterType.PumpSwap]));
assert.ok(Object.isFrozen(envelope.perAdapter[SourceAdapterType.PumpSwap].shapes));
assert.ok(
  Object.isFrozen(
    envelope.perAdapter[SourceAdapterType.RaydiumCpmm].shapes["native-twap"],
  ),
);
assert.throws(() => {
  (envelope.dynamicPolicy as { coverage: string }).coverage = "eternal";
}, TypeError);

console.log("creation execution inventory envelope tests passed");
