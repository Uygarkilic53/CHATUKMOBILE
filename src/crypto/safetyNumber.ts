/**
 * Safety number generation for direct conversation identity verification.
 * Follows E2EE_IMPLEMENTATION_SPEC.md Section 3.8.
 * Uses pure-JS BLAKE2b from @noble/hashes.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import {
  utf8ToBytes,
  fromBase64,
  compareBytes,
  concatBytes,
} from './encoding';

const SAFETY_NUMBER_PREFIX = 'e2ee-safety-v1|';

/**
 * Computes a deterministic 60-digit safety number fingerprint from two users' Ed25519 public keys.
 * Format: 12 groups of 5 digits separated by spaces (e.g. "12345 67890 ...").
 */
export async function computeSafetyNumber(
  pkA: Uint8Array | string,
  pkB: Uint8Array | string
): Promise<string> {
  const bytesA = typeof pkA === 'string' ? fromBase64(pkA) : pkA;
  const bytesB = typeof pkB === 'string' ? fromBase64(pkB) : pkB;

  // Deterministically sort public keys lexicographically
  const [firstPk, secondPk] =
    compareBytes(bytesA, bytesB) <= 0 ? [bytesA, bytesB] : [bytesB, bytesA];

  const prefixBytes = utf8ToBytes(SAFETY_NUMBER_PREFIX);
  const dataToHash = concatBytes(prefixBytes, firstPk, secondPk);

  // 64-byte BLAKE2b hash
  const hash = blake2b(dataToHash, { dkLen: 64 });

  // Derive 12 groups of 5 decimal digits (60 digits total)
  // Each 5-digit group is derived from 4 consecutive bytes
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const offset = i * 4;
    // Read 32-bit big-endian unsigned integer
    const val =
      ((hash[offset] << 24) |
        (hash[offset + 1] << 16) |
        (hash[offset + 2] << 8) |
        hash[offset + 3]) >>>
      0;
    const chunk = (val % 100000).toString().padStart(5, '0');
    groups.push(chunk);
  }

  return groups.join(' ');
}
