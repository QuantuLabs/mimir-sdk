import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { address, getProgramDerivedAddress } from "@solana/kit";
import bs58 from "bs58";
// The same R3 contract runs against source and freshly built package JS.
const packed = process.argv.includes("--packed");
const { prepareMimirV1ClassicRefresh } = await import(packed ? "../dist/src/v1/index.js" : "../src/v1/index.js");
import { staticConnection } from "./helpers/staticConnection.js";
import * as C from "../src/v1/layout/common.js";
import * as K from "../src/v1/layout/classic.js";
const load = (name: string) => JSON.parse(readFileSync(new URL("./fixtures/v1Refresh/"+name,import.meta.url),"utf8"));
const dlmmPool="9d9mb8kooFfaD3SctgZtkxQypkshx6ezhbKio89ixyy2", dlmmActive="3MysKYcjD3Lxf9TfqpSXLD2sMZoMxgmkzoXpAYfq8uFc";
  const dlmm = load("usdc_dlmm.json"), converter = load("sol_quoted_orca.json");
  const raw = Buffer.from(dlmm.accounts[dlmm.request.feed].data, "base64");
  const image = Buffer.from(converter.accounts[converter.request.feed].data, "base64");
  const converterRow = K.CLASSIC_ROWS + C.SOURCE_ROW_LEN + C.CONVERTER_FIXED_LEN;
  raw.copy(image, converterRow, K.CLASSIC_ROWS, K.CLASSIC_ROWS + C.SOURCE_ROW_LEN);
  image[converterRow + C.D_MODE] = C.MODE_NATIVE_BOUNDED;
  image[converterRow + C.D_EXTERNAL_WIDTH] = 7;
  raw.copy(image, image.length - C.MEMBERSHIP_HEADER_LEN, raw.length - C.MEMBERSHIP_HEADER_LEN);
  converter.accounts = { ...dlmm.accounts, ...converter.accounts,
    [converter.request.feed]: { ...converter.accounts[converter.request.feed], data: image.toString("base64") } };
  const worlds = await Promise.all([-321, -320].map(async (index) => {
    const seed = Buffer.alloc(8); seed.writeBigInt64LE(BigInt(index));
    const [key] = await getProgramDerivedAddress({ programAddress: dlmm.accounts[dlmmPool].owner,
      seeds: ["bin_array", bs58.decode(dlmmPool), seed] });
    const data = Buffer.from(dlmm.accounts[dlmmActive].data, "base64");
    data.writeBigInt64LE(BigInt(index), 8);
    // Keep all required bins initialized with two-sided liquidity; zero cached prices use the live bin-id price.
    for (let bin = 0; bin < 70; bin++) {
      const at = 56 + bin * 144;
      data.writeBigUInt64LE(1_000_000_000_000n, at); data.writeBigUInt64LE(1_000_000_000_000n, at + 8);
      data.fill(0, at + 16, at + 32);
    }
    return { key, account: { ...dlmm.accounts[dlmmActive], data: data.toString("base64") } };
  }));
  const poolAt = (active: number) => {
    const data = Buffer.from(dlmm.accounts[dlmmPool].data, "base64");
    data.writeInt32LE(active, 76); data.writeUInt16LE(1, 80);
    return { ...dlmm.accounts[dlmmPool], data: data.toString("base64") };
  };

const captured=JSON.parse(readFileSync(new URL("./fixtures/exportedRefresh/classic-dlmm-native-routeable-e9.json",import.meta.url),"utf8"));
const program=address("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"), pd="HZcJwcJ2njPDxZtpPoKnF8v2w9QAx2rS7TdJPSRkbEhu";
const [oracle]=await getProgramDerivedAddress({programAddress:program,seeds:["oracle",bs58.decode(dlmmPool)]});
const od=Buffer.alloc(64);od.set([139,194,131,179,140,179,229,244]);od.writeBigUInt64LE(1n,24);
const accounts: Record<string, any>={...converter.accounts,...Object.fromEntries(worlds.map(w=>[w.key,w.account])),[dlmmPool]:poolAt(-22402),
 [oracle]:{owner:program,executable:false,lamports:1,data:od.toString("base64")},
 ...Object.fromEntries([program,pd].map(k=>[k,{...captured.accounts[k],lamports:Number(captured.accounts[k].lamports)}]))};
assert.equal(bs58.encode(Buffer.from(accounts[dlmmPool].data,"base64").subarray(552,584)),oracle,"retained pool authentic oracle pointer");
const read = new Set<string>(), connection = staticConnection(converter.slot, accounts, read);
let diagnosticReads = 0;
const transport = connection as typeof connection & { _rpcRequest: (...args: any[]) => Promise<any> };
const request = transport._rpcRequest.bind(connection);
transport._rpcRequest = (...args: any[]) => { diagnosticReads++; return request(...args); };
const p = await prepareMimirV1ClassicRefresh(connection, converter.request.feed, { programId: converter.programId, cluster: converter.cluster });
const fixed = new Set(["11111111111111111111111111111111", "Sysvar1nstructions1111111111111111111111111"]);
const cohort = [...new Set<string>(p.instruction.accounts.map((a: { address: string }) => a.address))].filter(k => !fixed.has(k));
assert(cohort.every(k => read.has(k)), "every exact instruction role captured during preparation");
const fail = async () => {
  try {
    await p.preparationDrift!({ InstructionError: [0, { Custom: 3 }] },
      [`Program ${converter.programId} invoke [1]`, `Program ${converter.programId} failed: custom program error: 0x3`]);
    assert.fail("callback returned");
  } catch (e: any) { return e; }
};
let cases = 0;
// Generic property: every final instruction role, including headers, native oracle and generation pins.
for (const key of cohort) {
  const good = accounts[key];
  const mutations = good ? [
    ["owner", { ...good, owner: good.owner === program ? "11111111111111111111111111111111" : program }],
    ["executable", { ...good, executable: !good.executable }],
    ["length", { ...good, data: Buffer.concat([Buffer.from(good.data, "base64"), Buffer.alloc(1)]).toString("base64") }],
    ["disappear", null],
  ] : [["appear", { owner: program, executable: false, lamports: 1, data: "" }]];
  for (const [kind, bad] of mutations) for (const moves of [false, true]) {
    accounts[dlmmPool] = poolAt(moves ? -22398 : -22402);
    accounts[key] = key === dlmmPool && bad ? { ...bad,
      ...(kind === "length" ? { data: Buffer.concat([Buffer.from(accounts[dlmmPool].data, "base64"), Buffer.alloc(1)]).toString("base64") }
        : { data: accounts[dlmmPool].data }) } : bad;
    read.clear(); diagnosticReads = 0;
    const error = await fail();
    assert.equal(error.code, "SIMULATION_FAILED", `${key} ${kind} movement=${moves}`);
    assert.equal(error.customCode, 3);
    assert.equal(diagnosticReads, 1, "one coherent failure-only read");
    assert(cohort.every(k => read.has(k)), "whole exact cohort reread even for hard negative");
    cases++;
  }
  accounts[key] = good;
}
accounts[dlmmPool] = poolAt(-22398);
diagnosticReads = 0;
assert.equal((await fail()).code, "PREPARATION_STALE", "unchanged native tail permits authentic movement");
assert.equal(diagnosticReads, 2, "one diagnostic cohort plus existing new-array closure");
// A structurally invalid native tail already present at preparation cannot acquire retry authority either.
const goodOracle = accounts[oracle];
for (const bad of [null, { ...goodOracle, owner: "11111111111111111111111111111111" }, { ...goodOracle, executable: true }]) {
  accounts[dlmmPool] = poolAt(-22402); accounts[oracle] = bad;
  const invalid = await prepareMimirV1ClassicRefresh(connection, converter.request.feed, { programId: converter.programId, cluster: converter.cluster });
  accounts[dlmmPool] = poolAt(-22398);
  await assert.rejects(invalid.preparationDrift!({ InstructionError: [0, { Custom: 3 }] },
    [`Program ${converter.programId} invoke [1]`, `Program ${converter.programId} failed: custom program error: 0x3`]),
    (e: any) => e.code === "SIMULATION_FAILED" && e.customCode === 3, "preexisting invalid native oracle");
}
accounts[oracle] = goodOracle;
const {assessMimirRefresh}=await import(packed ? "../dist/src/beta/refreshPlanner.js" : "../src/beta/refreshPlanner.js");
const result=[];
for(const moves of [false,true]) {
 accounts[dlmmPool]=poolAt(-22402);accounts[oracle]={owner:program,executable:false,lamports:1,data:od.toString("base64")};
 let builds=0,simulations=0,hashes=0;
 const readiness=await assessMimirRefresh({programId:converter.programId,payer:converter.request.feed,
 target:{kind:"classic",feedConfig:converter.request.feed},consumer:{instructions:[{programAddress:"11111111111111111111111111111111",accounts:[],data:Uint8Array.of(0)}],computeUnits:1000},
 rpc:{getLatestBlockhash:()=>({send:async()=>({value:{blockhash:worlds[hashes++%2].key,lastValidBlockHeight:99n}})}),
 simulateTransaction:()=>({send:async()=>{
  simulations++;accounts[oracle]={...accounts[oracle],owner:"11111111111111111111111111111111"};if(moves)accounts[dlmmPool]=poolAt(-22398);
  return {value:{err:{InstructionError:[0,{Custom:3}]},logs:[`Program ${converter.programId} invoke [1]`,`Program ${converter.programId} failed: custom program error: 0x3`]}};
 }})} as never,
 buildRefreshGroup:async()=>{builds++;const p=await prepareMimirV1ClassicRefresh(staticConnection(converter.slot,accounts),converter.request.feed,{programId:converter.programId,cluster:converter.cluster});
 return {updates:[],publish:{instructions:[p.instruction],computeUnitBound:p.computeUnitLimit},preparationDrift:p.preparationDrift,
 check:{account:converter.request.feed,kind:"classic-snapshot",slotOffset:116,revisionOffset:96,statusOffset:104,expectedStatus:0,validUntilSlotOffset:124,snapshotSourceOffset:107,expectedSnapshotSource:5,config:converter.request.feed}};
 }});
 assert.equal(readiness.state,"not-ready");assert.equal(builds,1);assert.equal(simulations,1);
 result.push({moves,builds,simulations,hashes,readiness});
}
console.log(`v1NativeDrift ${packed ? "packed JS" : "source"}: ${cases} envelope cases; ${cohort.length} diagnostic accounts; planner negatives passed`);
