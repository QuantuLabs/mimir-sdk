import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PublicKey,
} from "@solana/web3.js";
import {
  REFRESH_FEED_TWAP_FROM_RINGS_AND_SNAPSHOT_LEN,
  SourceAdapterType,
  SPL_TOKEN_PROGRAM_ID,
  SPL_TOKEN_2022_PROGRAM_ID,
  findFeedConfigPda,
  findFeedSnapshotPda,
  findFeedTwapPda,
  findOracleRegistryPda,
  findSourcingPlanPda,
  findSourceConfigPda,
} from "../src/publicApi.js";
import {
  computeSingleExecutableSourceAccountsHash,
  computeRaydiumClmmRouteableSourceAccountsHash,
  computeRaydiumClmmSourceAccountsHash,
} from "../src/sourceGraph.js";

function pk(seed: number): PublicKey {
  return new PublicKey(Buffer.alloc(32, seed));
}

function bytes(seed: number): Buffer {
  return Buffer.alloc(32, seed);
}

function meta(pubkey: PublicKey, isSigner = false, isWritable = false) {
  return { pubkey: pubkey.toBase58(), isSigner, isWritable };
}

function metas(ix: { keys: readonly { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] }) {
  return ix.keys.map((key) => meta(key.pubkey, key.isSigner, key.isWritable));
}

function assertInstruction(
  name: string,
  ix: {
    programId: PublicKey;
    data: Uint8Array;
    keys: readonly { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  },
  expected: {
    programId: PublicKey;
    tag: number;
    length: number;
    metas: ReturnType<typeof meta>[];
  },
): void {
  assert.equal(ix.programId.toBase58(), expected.programId.toBase58(), `${name} program id`);
  assert.equal(ix.data[0], expected.tag, `${name} tag`);
  assert.equal(ix.data.length, expected.length, `${name} data length`);
  assert.deepEqual(metas(ix), expected.metas, `${name} account metas`);
}

const programId = pk(30);
const feedId = bytes(42);
const registry = findOracleRegistryPda(0, programId)[0];
const feedConfig = findFeedConfigPda(feedId, programId)[0];
const sourcingPlan = findSourcingPlanPda(feedId, 7, 3, programId)[0];
const feedTwap = findFeedTwapPda(feedId, 0, programId)[0];
const snapshot = findFeedSnapshotPda(feedId, programId)[0];
const sourceConfig0 = findSourceConfigPda(feedId, 0, programId)[0];
const sourceConfig1 = findSourceConfigPda(feedId, 1, programId)[0];
const sourceRing0 = pk(101);
const sourceRing1 = pk(102);

const refreshTwapPolicy = {
  expectedFeedId: feedId,
  twapVersion: 0,
  maxObservationAgeSlots: 20,
  minSourceCount: 2,
  expectedPrevRevision: 10n,
  expectedNewRevision: 11n,
};


const hashSource = {
  feedId: bytes(140),
  sourceIndex: 1,
  adapterType: SourceAdapterType.RaydiumClmm,
  direction: 0,
  adapterVersion: 1,
  programId: pk(141).toBuffer(),
  poolOrMarket: pk(142).toBuffer(),
  baseVault: pk(143).toBuffer(),
  quoteVault: pk(144).toBuffer(),
  baseMint: pk(145).toBuffer(),
  quoteMint: pk(146).toBuffer(),
  tokenProgram: SPL_TOKEN_2022_PROGRAM_ID.toBuffer(),
  vaultAuthority: pk(147).toBuffer(),
} as const;
const hashInput = {
  sourceConfig: hashSource,
  sourceConfigAddress: pk(148),
  token2022Mint: hashSource.baseMint,
  lowerTickArray: pk(149),
  activeTickArray: pk(150),
  upperTickArray: pk(151),
};
const routeableHash = computeRaydiumClmmRouteableSourceAccountsHash(hashInput);
const routeableManual = createHash("sha256");
routeableManual.update(Buffer.from("MIMIR_ACCOUNTS_RAYDIUM_CLMM_ROUTEABLE_V1", "ascii"));
routeableManual.update(hashSource.feedId);
routeableManual.update(Buffer.from([hashSource.sourceIndex, hashSource.adapterType, hashSource.direction]));
routeableManual.update(Buffer.from([hashSource.adapterVersion, 0]));
routeableManual.update(hashInput.sourceConfigAddress.toBuffer());
routeableManual.update(hashSource.programId);
routeableManual.update(hashSource.poolOrMarket);
routeableManual.update(hashSource.baseMint);
routeableManual.update(hashInput.lowerTickArray.toBuffer());
routeableManual.update(hashInput.activeTickArray.toBuffer());
routeableManual.update(hashInput.upperTickArray.toBuffer());
routeableManual.update(hashSource.baseVault);
routeableManual.update(hashSource.quoteVault);
routeableManual.update(hashSource.baseMint);
routeableManual.update(hashSource.quoteMint);
routeableManual.update(hashSource.tokenProgram);
routeableManual.update(hashSource.vaultAuthority);
assert.deepEqual(routeableHash, routeableManual.digest());
assert.throws(
  () => computeRaydiumClmmRouteableSourceAccountsHash({ ...hashInput, token2022Mint: undefined } as never),
  /MissingToken2022Mint/,
);
assert.throws(
  () => computeSingleExecutableSourceAccountsHash({ sourceConfig: hashSource, sourceConfigAddress: hashInput.sourceConfigAddress }),
  /RaydiumClmmV1RequiresRouteableAccounts/,
);

const classicHashSource = { ...hashSource, adapterVersion: 0, tokenProgram: SPL_TOKEN_PROGRAM_ID.toBuffer() } as const;
const classicHashInput = { sourceConfig: classicHashSource, sourceConfigAddress: pk(152) };
const classicHash = computeRaydiumClmmSourceAccountsHash(classicHashInput);
const classicManual = createHash("sha256");
classicManual.update(Buffer.from("MIMIR_ACCOUNTS_RAYDIUM_CLMM_V1", "ascii"));
classicManual.update(classicHashSource.feedId);
classicManual.update(Buffer.from([classicHashSource.sourceIndex, classicHashSource.adapterType, classicHashSource.direction]));
classicManual.update(Buffer.from([classicHashSource.adapterVersion, 0]));
classicManual.update(classicHashInput.sourceConfigAddress.toBuffer());
classicManual.update(classicHashSource.programId);
classicManual.update(classicHashSource.poolOrMarket);
classicManual.update(classicHashSource.baseVault);
classicManual.update(classicHashSource.quoteVault);
classicManual.update(classicHashSource.baseMint);
classicManual.update(classicHashSource.quoteMint);
classicManual.update(classicHashSource.tokenProgram);
classicManual.update(classicHashSource.vaultAuthority);
assert.deepEqual(classicHash, classicManual.digest());
assert.equal(classicHash.toString("hex"), "a39a099c360cfaee1ca473d43a6af26a898b0d63476d5907be4396703feebe60");
