import assert from "node:assert/strict";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  buildSizeAwareV0Transaction,
  buildSizeAwareV0TransactionWithResolver,
  chunkSizeAwareV0InstructionsByPacket,
  collectV0AltLookupAddresses,
  createSyntheticAddressLookupTable,
  MIMIR_PACKET_LIMIT_BYTES,
  MIMIR_SYNTHETIC_BLOCKHASH,
} from "../src/publicApi.js";

function pubkey(byte: number): PublicKey {
  return new PublicKey(new Uint8Array(32).fill(byte));
}

function instruction(args: {
  programByte: number;
  keyStart?: number;
  keyCount?: number;
  dataBytes?: number;
}): TransactionInstruction {
  const keyStart = args.keyStart ?? args.programByte + 1;
  return new TransactionInstruction({
    programId: pubkey(args.programByte),
    keys: Array.from({ length: args.keyCount ?? 2 }, (_, index) => ({
      pubkey: pubkey(keyStart + index),
      isSigner: false,
      isWritable: index % 3 === 0,
    })),
    data: Buffer.alloc(args.dataBytes ?? 4, args.programByte),
  });
}

function lookupTableFor(
  feePayer: PublicKey,
  instructions: readonly TransactionInstruction[],
) {
  return createSyntheticAddressLookupTable({
    key: pubkey(240),
    authority: feePayer,
    addresses: collectV0AltLookupAddresses({
      feePayer,
      instructions,
    }).lookupAddresses,
  });
}

const feePayer = Keypair.generate().publicKey;

{
  const plan = buildSizeAwareV0Transaction({
    feePayer,
    recentBlockhash: MIMIR_SYNTHETIC_BLOCKHASH,
    instructions: [instruction({ programByte: 7 })],
  });
  assert.equal(plan.altDecision, "fits_without_alt");
  assert.equal(plan.profile.usesAddressLookupTable, false);
  assert.ok(plan.profile.serializedBytes! <= MIMIR_PACKET_LIMIT_BYTES);
}

{
  const instructions = [instruction({ programByte: 10, keyCount: 40, dataBytes: 8 })];
  assert.throws(
    () =>
      buildSizeAwareV0Transaction({
        feePayer,
        recentBlockhash: MIMIR_SYNTHETIC_BLOCKHASH,
        instructions,
        label: "synthetic attach",
      }),
    /synthetic attach exceeds the 1232-byte packet limit and no address lookup table is available/,
  );
  const plan = buildSizeAwareV0Transaction({
    feePayer,
    recentBlockhash: MIMIR_SYNTHETIC_BLOCKHASH,
    instructions,
    lookupTables: [lookupTableFor(feePayer, instructions)],
    label: "synthetic attach",
  });
  assert.equal(plan.altDecision, "fits_with_provided_alt");
  assert.equal(plan.profile.usesAddressLookupTable, true);
  assert.ok(plan.profile.serializedBytes! <= MIMIR_PACKET_LIMIT_BYTES);
}

{
  const instructions = [instruction({ programByte: 20, keyStart: 60, keyCount: 42 })];
  let resolverCalls = 0;
  const plan = await buildSizeAwareV0TransactionWithResolver({
    feePayer,
    recentBlockhash: MIMIR_SYNTHETIC_BLOCKHASH,
    instructions,
    label: "synthetic resolver",
    resolveLookupTables: (request) => {
      resolverCalls += 1;
      assert.equal(request.forceAddressLookupTable, false);
      assert.equal(request.noAltProfile.fitsPacketLimit, false);
      return [lookupTableFor(request.feePayer, request.instructions)];
    },
  });
  assert.equal(resolverCalls, 1);
  assert.equal(plan.altDecision, "fits_with_resolved_alt");
  assert.equal(plan.profile.usesAddressLookupTable, true);
  assert.ok(plan.profile.serializedBytes! <= MIMIR_PACKET_LIMIT_BYTES);
}

{
  const instructions = [instruction({ programByte: 21, keyStart: 120, keyCount: 42 })];
  const providedAlt = lookupTableFor(feePayer, instructions);
  const plan = await buildSizeAwareV0TransactionWithResolver({
    feePayer,
    recentBlockhash: MIMIR_SYNTHETIC_BLOCKHASH,
    instructions,
    lookupTables: [providedAlt],
    resolveLookupTables: (request) => request.providedLookupTables,
  });
  assert.equal(plan.altDecision, "fits_with_provided_alt");
  assert.equal(plan.addressLookupTables[0]?.key.equals(providedAlt.key), true);
}

{
  const instructions = [instruction({ programByte: 22, keyStart: 170, keyCount: 40 })];
  const plan = buildSizeAwareV0Transaction({
    feePayer,
    recentBlockhash: MIMIR_SYNTHETIC_BLOCKHASH,
    instructions,
    requirePacketFit: false,
  });
  assert.equal(plan.altDecision, "allowed_without_alt");
  assert.equal(plan.profile.fitsPacketLimit, false);
}

{
  const instructions = [
    instruction({ programByte: 30, keyStart: 90, keyCount: 4, dataBytes: 420 }),
    instruction({ programByte: 31, keyStart: 100, keyCount: 4, dataBytes: 420 }),
    instruction({ programByte: 32, keyStart: 110, keyCount: 4, dataBytes: 420 }),
  ];
  const chunks = chunkSizeAwareV0InstructionsByPacket({
    feePayer,
    instructions,
    labels: ["a", "b", "c"],
  });
  assert.ok(chunks.length > 1);
  assert.equal(
    chunks.reduce((total, chunk) => total + chunk.instructions.length, 0),
    instructions.length,
  );
  for (const chunk of chunks) {
    assert.ok(chunk.profile.serializedBytes! <= MIMIR_PACKET_LIMIT_BYTES);
  }
}

{
  const huge = instruction({ programByte: 40, keyStart: 130, keyCount: 2, dataBytes: 2_400 });
  assert.throws(
    () =>
      chunkSizeAwareV0InstructionsByPacket({
        feePayer,
        instructions: [huge],
        labels: ["huge"],
        label: "oversized split",
      }),
    /oversized split chunk huge exceeds the 1232-byte packet limit/,
  );
}
