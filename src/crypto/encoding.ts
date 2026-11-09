/**
 * Pure-JS encoding, padding, and byte manipulation utilities for Chatuk E2EE.
 * 100% compatible with React Native Hermes, Expo Go, Node, and Web (no WebAssembly required).
 */
import base64 from 'base64-js';
import nacl from 'tweetnacl';
import { ed25519 } from '@noble/curves/ed25519.js';

export function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  return base64.fromByteArray(bytes);
}

export function fromBase64(b64: string): Uint8Array {
  return base64.toByteArray(b64);
}

/**
 * Generates cryptographically secure random bytes without WebAssembly.
 */
export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    return buf;
  }
  if (typeof global !== 'undefined' && (global as any).crypto?.getRandomValues) {
    (global as any).crypto.getRandomValues(buf);
    return buf;
  }
  return nacl.randomBytes(length);
}

/**
 * Concatenates multiple Uint8Array buffers into a single Uint8Array.
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Compares two byte arrays lexicographically for deterministic sorting.
 */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/**
 * ISO/IEC 7816-4 padding: Appends a 0x80 byte followed by 0x00 bytes to reach the block size multiple.
 */
export function pad(buf: Uint8Array, blocksize: number = 160): Uint8Array {
  const padLen = blocksize - (buf.length % blocksize);
  const out = new Uint8Array(buf.length + padLen);
  out.set(buf, 0);
  out[buf.length] = 0x80;
  out.fill(0, buf.length + 1);
  return out;
}

/**
 * ISO/IEC 7816-4 unpadding: Strips trailing zeros and the 0x80 delimiter.
 */
export function unpad(buf: Uint8Array, blocksize: number = 160): Uint8Array {
  if (buf.length === 0 || buf.length % blocksize !== 0) {
    throw new Error('Invalid padding: buffer length is not a multiple of blockSize');
  }
  let i = buf.length - 1;
  while (i >= 0 && buf[i] === 0) {
    i--;
  }
  if (i < 0 || buf[i] !== 0x80) {
    throw new Error('Invalid padding: delimiter 0x80 not found');
  }
  return buf.subarray(0, i);
}

/**
 * Zeroes out a Uint8Array in memory (best effort).
 */
export function wipeBytes(arr?: Uint8Array | null): void {
  if (!arr) return;
  arr.fill(0);
}

export const sodiumCompat = {
  crypto_sign_verify_detached(sig: Uint8Array, msg: Uint8Array, pk: Uint8Array): boolean {
    try {
      return ed25519.verify(sig, msg, pk);
    } catch {
      return false;
    }
  },
  randombytes_buf(length: number): Uint8Array {
    return randomBytes(length);
  },
  from_string: utf8ToBytes,
  to_string: bytesToUtf8,
  to_base64: toBase64,
  from_base64: fromBase64,
  memzero: wipeBytes,
};

export async function ensureSodiumReady(): Promise<typeof sodiumCompat> {
  return Promise.resolve(sodiumCompat);
}
export default sodiumCompat;
