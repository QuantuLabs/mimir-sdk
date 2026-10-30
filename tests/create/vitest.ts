// Minimal vitest surface over node:test and node:assert, so app tests of the moved `src/create` files run with the same assertions.
import assert from "node:assert/strict";
import { afterEach as nodeAfterEach, mock, test } from "node:test";

type Fn = (...args: any[]) => any;
type Mock<F extends Fn = Fn> = F & { mock: { calls: Parameters<F>[] }; mockImplementation(f: F): Mock<F>; mockImplementationOnce(f: F): Mock<F>;
  mockResolvedValue(v: unknown): Mock<F>; mockResolvedValueOnce(v: unknown): Mock<F>; mockReturnValue(v: unknown): Mock<F>; mockClear(): Mock<F>; mockRestore(): void };

const prefix: string[] = [];
export function it(name: string, fn: () => unknown, _timeout?: number) { test([...prefix, name].join(" › "), async () => { await fn(); }); }
it.each = (rows: readonly unknown[]) => (name: string, fn: (...a: any[]) => unknown, _timeout?: number) => rows.forEach((row, i) =>
  it(`${name} [${i}]`, () => Array.isArray(row) ? fn(...row) : fn(row)));
export const test_ = it;
export function describe(name: string, fn: () => void) { prefix.push(name); try { fn(); } finally { prefix.pop(); } }

function fnMock<F extends Fn = Fn>(impl?: F): Mock<F> {
  let base: Fn | undefined = impl; const once: Fn[] = [];
  const m = function (this: unknown, ...args: any[]) { m.mock.calls.push(args as Parameters<F>); const f = once.shift() ?? base; return f?.apply(this, args); } as Mock<F>;
  m.mock = { calls: [] };
  m.mockImplementation = (f) => { base = f; return m; };
  m.mockImplementationOnce = (f) => { once.push(f); return m; };
  m.mockResolvedValue = (v) => m.mockImplementation((async () => v) as F);
  m.mockResolvedValueOnce = (v) => m.mockImplementationOnce((async () => v) as F);
  m.mockReturnValue = (v) => m.mockImplementation((() => v) as F);
  m.mockClear = () => { m.mock.calls.length = 0; return m; };
  m.mockRestore = () => undefined;
  return m;
}
const globals = new Map<string, PropertyDescriptor | undefined>();
let fake = false;
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
export const vi = {
  fn: fnMock,
  spyOn<T extends object, K extends keyof T>(target: T, key: K): Mock<T[K] extends Fn ? T[K] : Fn> {
    const original = target[key] as Fn; const m = fnMock(original) as Mock<any>;
    m.mockRestore = () => { target[key] = original as T[K]; };
    target[key] = m as T[K]; return m;
  },
  stubGlobal(name: string, value: unknown) {
    if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  },
  unstubAllGlobals() {
    for (const [name, d] of globals) d ? Object.defineProperty(globalThis, name, d) : delete (globalThis as Record<string, unknown>)[name];
    globals.clear();
  },
  useFakeTimers(_opts?: object) { if (!fake) mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] }); fake = true; return vi; },
  useRealTimers() { if (fake) mock.timers.reset(); fake = false; return vi; },
  isFakeTimers: () => fake,
  setSystemTime(t: number | Date) { mock.timers.setTime(Number(t)); },
  async advanceTimersByTimeAsync(ms: number) {
    await flush();
    for (let left = ms; left > 0; left -= 1) { mock.timers.tick(1); await flush(); }
  },
};

const fmt = (v: unknown) => { try { return JSON.stringify(v, (_k, x) => typeof x === "bigint" ? `${x}n` : x); } catch { return String(v); } };
class Containing { constructor(readonly value: object) {} test(v: unknown) { return matchObject(v, this.value); } }
class Any { constructor(readonly type: Fn) {} test(v: unknown) { const t = this.type as unknown;
  return t === Number ? typeof v === 'number' : t === String ? typeof v === 'string' : t === BigInt ? typeof v === 'bigint' : t === Boolean ? typeof v === 'boolean'
    : t === Function ? typeof v === 'function' : t === Object ? v !== null && typeof v === 'object' : v instanceof (t as new () => unknown); } }
const hasAny = (v: unknown): boolean => v instanceof Any || v instanceof Containing || (v !== null && typeof v === 'object' && Object.values(v as object).some(hasAny));
function matchObject(actual: any, expected: any): boolean {
  if (expected instanceof Any || expected instanceof Containing) return expected.test(actual);
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (actual === null || typeof actual !== "object") return false;
  if (expected instanceof Uint8Array) return actual instanceof Uint8Array && Buffer.from(actual).equals(Buffer.from(expected));
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((x, i) => matchObject(actual[i], x));
  return Object.keys(expected).every((k) => matchObject(actual[k], expected[k]));
}
const deepEq = (a: unknown, b: unknown): boolean => { if (hasAny(b)) return matchObject(a, b); try { assert.deepStrictEqual(a, b); return true; } catch { try { assert.deepEqual(a, b); return true; } catch { return false; } } };
function thrownMatches(error: unknown, expected?: unknown) {
  if (expected === undefined) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof expected === "string") return message.includes(expected);
  if (expected instanceof RegExp) return expected.test(message);
  if (typeof expected === "function") return error instanceof (expected as new () => unknown);
  if (expected instanceof Error) return message === expected.message;
  return matchObject(error, expected);
}

function matchers(actual: unknown, negate: boolean) {
  const check = (ok: boolean, what: string) => { if (ok === negate) throw new assert.AssertionError({ message: `expected ${fmt(actual)} ${negate ? "not " : ""}${what}` }); };
  const calls = () => (actual as Mock).mock.calls;
  return {
    toBe: (e: unknown) => check(Object.is(actual, e), `to be ${fmt(e)}`),
    toEqual: (e: unknown) => check(deepEq(actual, e), `to equal ${fmt(e)}`),
    toStrictEqual: (e: unknown) => check(deepEq(actual, e), `to equal ${fmt(e)}`),
    toMatchObject: (e: unknown) => check(matchObject(actual, e), `to match ${fmt(e)}`),
    toMatch: (e: RegExp | string) => check(typeof e === "string" ? String(actual).includes(e) : e.test(String(actual)), `to match ${e}`),
    toContain: (e: unknown) => check(typeof actual === "string" ? actual.includes(e as string) : (actual as unknown[]).includes(e), `to contain ${fmt(e)}`),
    toContainEqual: (e: unknown) => check((actual as unknown[]).some((x) => deepEq(x, e)), `to contain ${fmt(e)}`),
    toHaveLength: (n: number) => check((actual as { length: number }).length === n, `to have length ${n}`),
    toHaveProperty: (k: string, v?: unknown) => check(actual != null && k in (actual as object) && (v === undefined || deepEq((actual as any)[k], v)), `to have ${k}`),
    toBeNull: () => check(actual === null, "to be null"),
    toBeUndefined: () => check(actual === undefined, "to be undefined"),
    toBeDefined: () => check(actual !== undefined, "to be defined"),
    toBeTruthy: () => check(!!actual, "to be truthy"),
    toBeFalsy: () => check(!actual, "to be falsy"),
    toBeInstanceOf: (c: new (...a: any[]) => unknown) => check(actual instanceof c, `to be instance of ${c.name}`),
    toBeGreaterThan: (n: number | bigint) => check((actual as number) > n, `> ${n}`),
    toBeGreaterThanOrEqual: (n: number | bigint) => check((actual as number) >= n, `>= ${n}`),
    toBeLessThan: (n: number | bigint) => check((actual as number) < n, `< ${n}`),
    toBeLessThanOrEqual: (n: number | bigint) => check((actual as number) <= n, `<= ${n}`),
    toThrow: (e?: unknown) => { let threw = false, error: unknown; try { (actual as Fn)(); } catch (x) { threw = true; error = x; } check(threw && thrownMatches(error, e), `to throw ${fmt(e)}`); },
    toHaveBeenCalled: () => check(calls().length > 0, "to have been called"),
    toHaveBeenCalledOnce: () => check(calls().length === 1, "to have been called once"),
    toHaveBeenCalledTimes: (n: number) => check(calls().length === n, `to have been called ${n} times (got ${calls().length})`),
    toHaveBeenCalledWith: (...a: unknown[]) => check(calls().some((c) => deepEq(c, a) || matchObject(c, a)), `to have been called with ${fmt(a)}`),
    toHaveBeenCalledExactlyOnceWith: (...a: unknown[]) => check(calls().length === 1 && (deepEq(calls()[0], a) || matchObject(calls()[0], a)), `to have been called once with ${fmt(a)}`),
    toHaveBeenLastCalledWith: (...a: unknown[]) => check(calls().length > 0 && (deepEq(calls().at(-1), a) || matchObject(calls().at(-1), a)), `last called with ${fmt(a)}`),
  };
}
type Matchers = ReturnType<typeof matchers>;
type Async = { [K in keyof Matchers]: (...a: Parameters<Matchers[K]>) => Promise<void> };
expect.any = (type: Function) => new Any(type as Fn) as never;
expect.soft = (actual: unknown, _label?: string) => expect(actual);
expect.objectContaining = (value: object) => new Containing(value) as never;
export function expect(actual: unknown, _message?: string): any {
  const settle = async (want: "rejects" | "resolves", negate: boolean) => {
    try { const v = await actual; if (want === "rejects") throw Object.assign(new assert.AssertionError({ message: `expected rejection, resolved ${fmt(v)}` }), { __resolved: true }); return matchers(v, negate); }
    catch (e) { if ((e as { __resolved?: boolean }).__resolved || want === "resolves") throw e;
      return { ...matchers(e, negate), toThrow: (x?: unknown) => { if (thrownMatches(e, x) === negate) throw new assert.AssertionError({ message: `rejection ${fmt((e as Error)?.message)} vs ${fmt(x)}` }); } } as Matchers; }
  };
  const wrap = (want: "rejects" | "resolves", negate: boolean) => new Proxy({} as Async & { not: Async }, { get: (_t, k: string) => k === "not" ? wrap(want, !negate)
    : async (...a: unknown[]) => (((await settle(want, negate)) as unknown as Record<string, Fn>)[k]!)(...a) });
  return Object.assign(matchers(actual, false), { not: matchers(actual, true), rejects: wrap("rejects", false), resolves: wrap("resolves", false) });
}
export const afterEach = (fn: () => unknown) => nodeAfterEach(async () => { await fn(); });
