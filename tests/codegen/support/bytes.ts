// Byte-level comparison helpers for the cross-check.
import { type ByteRange, type LayoutRecord, coverage, leafRanges } from "./layout.js";

const hex = (byte: number | undefined): string =>
  byte === undefined ? "--" : byte.toString(16).padStart(2, "0");

/** A description of the first difference between two byte arrays, or `null` if equal. */
export function firstDifference(expected: Uint8Array, actual: Uint8Array): string | null {
  if (expected.length !== actual.length) {
    return `length ${actual.length}, expected ${expected.length}`;
  }
  for (let index = 0; index < expected.length; index++) {
    if (expected[index] !== actual[index]) {
      return `byte ${index}: got 0x${hex(actual[index])}, expected 0x${hex(expected[index])}`;
    }
  }
  return null;
}

/** Offsets of the bytes of `bytes` that no leaf of `record` covers (padding). */
export function paddingOffsets(record: LayoutRecord): number[] {
  const covered = coverage(record.size, leafRanges(record.root));
  const padding: number[] = [];
  covered.forEach((isCovered, index) => {
    if (!isCovered) padding.push(index);
  });
  return padding;
}

/** Offsets of padding bytes that are not zero in `bytes`. */
export function dirtyPadding(record: LayoutRecord, bytes: Uint8Array): number[] {
  return paddingOffsets(record).filter((offset) => bytes[offset] !== 0);
}

/** Copies the bytes inside `ranges` (offset by `shift`) from `source` onto `target`. */
export function copyRanges(
  target: Uint8Array,
  source: Uint8Array,
  ranges: readonly ByteRange[],
  shift = 0,
): void {
  for (const range of ranges) {
    for (let byte = range.start; byte < range.end; byte++) {
      target[byte + shift] = source[byte] ?? 0;
    }
  }
}
