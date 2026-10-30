// MimirError.from before price.ts loads: Mimir's custom error number from the logs, with its retry; a foreign program stays UNKNOWN.
import assert from 'node:assert/strict';
import { MimirError } from '../../src/root.js';

const failed = (program: string, hex: string) => Object.assign(new Error('Simulation failed'), { logs: [`Program ${program} failed: custom program error: 0x${hex}`] });
const e = MimirError.from(failed('hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR', '1f'));
assert.deepEqual([e.code, e.retry, e.name], [31, 'later', 'Custom31']);
assert.equal(MimirError.from(failed('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', '1f')).code, 'UNKNOWN');
const notReady = MimirError.from(Object.assign(new Error('CLASSIC_NATIVE_NOT_READY:row 0 native history not ready'), { code: 'CLASSIC_NATIVE_NOT_READY' }));
assert.deepEqual([notReady.code, notReady.retry], ['CLASSIC_NATIVE_NOT_READY', 'later']);
assert.equal(MimirError.from(Object.assign(new Error('x'), { code: 'CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT' })).code, 'CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT');
console.log('MimirError light classifier: ok');
