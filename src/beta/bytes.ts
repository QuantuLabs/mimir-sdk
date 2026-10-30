import { getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";
import { betaError } from "./errors.js";

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

export const utf8 = (value: string): Uint8Array => utf8Encoder.encode(value);
export const decodeUtf8 = (value: Uint8Array): string => utf8Decoder.decode(value);
const encodedAddresses = new Map<string, Uint8Array>();
const decodedAddresses = new Map<string, Address>();
function remember<K, V>(cache: Map<K, V>, key: K, value: V): V {
  if (cache.size >= 8192) cache.clear();
  cache.set(key, value);
  return value;
}
export const addressBytes = (value: Address): Uint8Array =>
  Uint8Array.from(encodedAddresses.get(value) ?? remember(encodedAddresses, value, Uint8Array.from(addressEncoder.encode(value))));
export const bytesAddress = (value: Uint8Array): Address => {
  const key = String.fromCharCode(...value);
  return decodedAddresses.get(key) ?? remember(decodedAddresses, key, addressDecoder.decode(value));
};

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

export function isZeroBytes(value: Uint8Array): boolean {
  return value.every((byte) => byte === 0);
}

export function assertZeroBytes(value: Uint8Array, label: string): void {
  if (!isZeroBytes(value)) betaError("ACCOUNT_MALFORMED", `${label} must be zero`);
}

export function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(value)) betaError("INVALID_ARGUMENT", "invalid lowercase hex");
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_PAIRS: string[] = [];
for (let index = 0; index < 4096; index += 1) BASE64_PAIRS.push(BASE64_ALPHABET[index >> 6]! + BASE64_ALPHABET[index & 63]!);
const BASE64_VALUES = new Int16Array(65536).fill(-1);
for (let index = 0; index < 64; index += 1) BASE64_VALUES[BASE64_ALPHABET.charCodeAt(index)] = index;

export function base64(value: Uint8Array): string {
  let out = "";
  const whole = value.length - value.length % 3;
  for (let index = 0; index < whole; index += 3) {
    const triple = value[index]! << 16 | value[index + 1]! << 8 | value[index + 2]!;
    out += BASE64_PAIRS[triple >> 12]! + BASE64_PAIRS[triple & 4095]!;
  }
  if (value.length - whole === 1) out += BASE64_PAIRS[value[whole]! << 4]! + "==";
  else if (value.length - whole === 2) {
    const pair = value[whole]! << 8 | value[whole + 1]!;
    out += BASE64_PAIRS[pair >> 4]! + BASE64_ALPHABET[(pair & 15) << 2]! + "=";
  }
  return out;
}

function base64Value(value: string, index: number): number {
  const decoded = BASE64_VALUES[value.charCodeAt(index)]!;
  if (decoded < 0) betaError("INVALID_ARGUMENT", "invalid base64");
  return decoded;
}

export function fromBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0) betaError("INVALID_ARGUMENT", "invalid base64");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const out = new Uint8Array(value.length / 4 * 3 - padding);
  const whole = value.length - (padding === 0 ? 0 : 4);
  let offset = 0;
  for (let index = 0; index < whole; index += 4) {
    const v0 = BASE64_VALUES[value.charCodeAt(index)]!, v1 = BASE64_VALUES[value.charCodeAt(index + 1)]!;
    const v2 = BASE64_VALUES[value.charCodeAt(index + 2)]!, v3 = BASE64_VALUES[value.charCodeAt(index + 3)]!;
    if ((v0 | v1 | v2 | v3) < 0) betaError("INVALID_ARGUMENT", "invalid base64");
    const quantum = v0 << 18 | v1 << 12 | v2 << 6 | v3;
    out[offset] = quantum >> 16; out[offset + 1] = quantum >> 8; out[offset + 2] = quantum; offset += 3;
  }
  if (padding === 2) {
    const quantum = base64Value(value, whole) << 6 | base64Value(value, whole + 1);
    if ((quantum & 15) !== 0) betaError("INVALID_ARGUMENT", "non-canonical base64");
    out[offset] = quantum >> 4;
  } else if (padding === 1) {
    const quantum = base64Value(value, whole) << 12 | base64Value(value, whole + 1) << 6 | base64Value(value, whole + 2);
    if ((quantum & 3) !== 0) betaError("INVALID_ARGUMENT", "non-canonical base64");
    out[offset] = quantum >> 10; out[offset + 1] = quantum >> 2;
  }
  return out;
}

export async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) betaError("INVALID_ARGUMENT", "Web Crypto SHA-256 unavailable");
  const input = Uint8Array.from(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input.buffer));
}

type Canonical = null | boolean | string | bigint | number | Uint8Array | readonly Canonical[] | {
  readonly [key: string]: Canonical;
};

function canonicalValue(value: Canonical): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) betaError("INVALID_ARGUMENT", "canonical numbers must be safe integers");
    return value.toString(10);
  }
  if (value instanceof Uint8Array) return base64(value);
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (typeof value !== "object") betaError("INVALID_ARGUMENT", "unsupported canonical value");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    betaError("INVALID_ARGUMENT", "canonical object must be plain");
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const member = (value as Record<string, Canonical | undefined>)[key];
    if (member === undefined) betaError("INVALID_ARGUMENT", `undefined canonical field ${key}`);
    out[key] = canonicalValue(member);
  }
  return out;
}

export function canonicalJson(value: Canonical): string {
  return JSON.stringify(canonicalValue(value));
}

export async function domainHash(domain: string, canonical: string): Promise<string> {
  return hex(await sha256(concatBytes(utf8(domain), utf8(canonical))));
}
