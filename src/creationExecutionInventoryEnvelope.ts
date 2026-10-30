import {
  EXECUTABLE_SOURCE_ADAPTER_MASK_V0,
  MAX_TWAP_AGGREGATION_SOURCES,
  SourceAdapterType,
  VERSION_V0,
} from "./constants.js";

export type MimirCreationExecutionSourceShapeV1 =
  | {
      adapterType: typeof SourceAdapterType.OrcaWhirlpool;
      shape: "basic" | "routeable";
    }
  | {
      adapterType: typeof SourceAdapterType.RaydiumClmm;
      shape: "basic" | "routeable";
    }
  | {
      adapterType: typeof SourceAdapterType.RaydiumCpmm;
      shape: "basic" | "native-twap";
    }
  | {
      adapterType: typeof SourceAdapterType.MeteoraDlmm;
      shape: "basic" | "routeable";
    }
  | {
      adapterType: typeof SourceAdapterType.RaydiumAmmV4;
      shape: "basic";
    }
  | {
      adapterType: typeof SourceAdapterType.MeteoraDammV2;
      shape: "basic";
    }
  | {
      adapterType: typeof SourceAdapterType.PumpSwap;
      shape: "basic";
    };

export interface MimirCreationExecutionInventoryAddressBoundArgsV1 {
  adapterVersion: typeof VERSION_V0;
  sources: readonly MimirCreationExecutionSourceShapeV1[];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

export const MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1 = deepFreeze({
  schema: "mimir-creation-execution-inventory-envelope",
  version: 1,
  adapterVersion: VERSION_V0,
  executableAdapterMask: EXECUTABLE_SOURCE_ADAPTER_MASK_V0,
  maxSources: MAX_TWAP_AGGREGATION_SOURCES,
  commonDistinctAddressCount: 9,
  perAdapter: {
    [SourceAdapterType.OrcaWhirlpool]: {
      adapterType: SourceAdapterType.OrcaWhirlpool,
      shapes: {
        basic: { stable: 6, dynamic: 0, max: 6 },
        routeable: { stable: 6, dynamic: 3, max: 9 },
      },
      stable: 6,
      dynamic: 3,
      max: 9,
    },
    [SourceAdapterType.RaydiumClmm]: {
      adapterType: SourceAdapterType.RaydiumClmm,
      shapes: {
        basic: { stable: 6, dynamic: 0, max: 6 },
        routeable: { stable: 6, dynamic: 3, max: 9 },
      },
      stable: 6,
      dynamic: 3,
      max: 9,
    },
    [SourceAdapterType.RaydiumCpmm]: {
      adapterType: SourceAdapterType.RaydiumCpmm,
      shapes: {
        basic: { stable: 6, dynamic: 0, max: 6 },
        "native-twap": { stable: 8, dynamic: 0, max: 8 },
      },
      stable: 8,
      dynamic: 0,
      max: 8,
    },
    [SourceAdapterType.MeteoraDlmm]: {
      adapterType: SourceAdapterType.MeteoraDlmm,
      shapes: {
        basic: { stable: 5, dynamic: 1, max: 6 },
        routeable: { stable: 5, dynamic: 3, max: 8 },
      },
      stable: 5,
      dynamic: 3,
      max: 8,
    },
    [SourceAdapterType.RaydiumAmmV4]: {
      adapterType: SourceAdapterType.RaydiumAmmV4,
      shapes: {
        basic: { stable: 6, dynamic: 0, max: 6 },
      },
      stable: 6,
      dynamic: 0,
      max: 6,
    },
    [SourceAdapterType.MeteoraDammV2]: {
      adapterType: SourceAdapterType.MeteoraDammV2,
      shapes: {
        basic: { stable: 5, dynamic: 0, max: 5 },
      },
      stable: 5,
      dynamic: 0,
      max: 5,
    },
    [SourceAdapterType.PumpSwap]: {
      adapterType: SourceAdapterType.PumpSwap,
      shapes: {
        basic: { stable: 7, dynamic: 0, max: 7 },
      },
      stable: 7,
      dynamic: 0,
      max: 7,
    },
  },
  maxSourceRefreshInstructionCount: 5,
  maxTerminalMimirRefreshInstructionCount: 1,
  maxDistinctMimirAddressCount: 54,
  dynamicPolicy: {
    bootstrap: "bootstrap-current-only",
    runtime: "runtime-static-or-session-companion",
    coverage: "not-eternal",
  },
} as const);

export function mimirCreationExecutionInventoryAddressBoundV1(
  args: MimirCreationExecutionInventoryAddressBoundArgsV1,
): number {
  const runtimeAdapterVersion = args.adapterVersion as number;
  if (runtimeAdapterVersion !== MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1.adapterVersion) {
    throw new Error(
      `UnsupportedMimirCreationExecutionAdapterVersion:${runtimeAdapterVersion}`,
    );
  }

  const sourceCount = args.sources.length;
  if (
    sourceCount < 1 ||
    sourceCount > MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1.maxSources
  ) {
    throw new Error(`InvalidMimirCreationExecutionSourceCount:${sourceCount}`);
  }

  let addressBound =
    MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1.commonDistinctAddressCount;
  const perAdapter = MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1.perAdapter as Record<
    number,
    { readonly shapes: Record<string, { readonly max: number }> }
  >;
  for (const source of args.sources) {
    const adapterType = source.adapterType as number;
    const adapter = perAdapter[adapterType];
    if (!adapter) {
      throw new Error(`UnsupportedMimirCreationExecutionAdapter:${adapterType}`);
    }
    const shapeName = source.shape as string;
    if (!Object.prototype.hasOwnProperty.call(adapter.shapes, shapeName)) {
      throw new Error(
        `UnsupportedMimirCreationExecutionAdapterShape:${adapterType}:${shapeName}`,
      );
    }
    const shape = adapter.shapes[shapeName]!;
    addressBound += shape.max;
  }

  if (
    addressBound >
    MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1.maxDistinctMimirAddressCount
  ) {
    throw new Error(`MimirCreationExecutionInventoryEnvelopeExceeded:${addressBound}`);
  }
  return addressBound;
}
