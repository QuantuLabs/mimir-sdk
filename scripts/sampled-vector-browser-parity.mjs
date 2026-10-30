#!/usr/bin/env node
import assert from "node:assert/strict";
import { runSampledTemporalVectorParity } from "../tests/sampledTemporalVectors.mjs";

const browser = await import(new URL("../dist/browser/beta.js", import.meta.url));
const checks = runSampledTemporalVectorParity(browser, new URL("../tests/fixtures/sampled-temporal", import.meta.url).pathname);
assert.equal(checks, 182);
console.log(`browser sampled temporal vectors: ${checks} checks`);
const { runCurrentPointVectorParity } = await import("../tests/currentPointVectors.mjs");
const pointChecks = runCurrentPointVectorParity(browser, new URL("../tests/fixtures/currentPointAbiVectors.json", import.meta.url).pathname);
assert.equal(pointChecks, 26);
console.log(`browser current point vectors: ${pointChecks} checks`);
