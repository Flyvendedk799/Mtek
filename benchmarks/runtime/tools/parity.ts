// The "same visible result" check (spec/ai-and-benchmarks.md section 7): the three implementations of a workload draw their
// scene after the workload's parity frames, and the pictures are compared pixel by pixel. Rendering differs in the last bit
// (binary32 against binary64 formulas, rasterisation of coincident edges), so a pixel counts as different only when a
// channel differs by more than `CHANNEL_TOLERANCE` of 255; the verdict allows a small share of such pixels (silhouette edges).
export const CHANNEL_TOLERANCE = 8;
/** At most this share of pixels may differ by more than the tolerance for two pictures to count as the same scene. */
export const MAX_DIFFERING_SHARE = 0.005;

export interface PictureComparison {
  readonly pixels: number;
  /** Pixels with some channel differing by more than the tolerance. */
  readonly differingPixels: number;
  readonly differingShare: number;
  readonly maxChannelDifference: number;
  readonly meanAbsoluteDifference: number;
  /** The share of pixels that are not the clear colour in the reference picture (a blank picture would pass a diff against itself). */
  readonly referenceDrawnShare: number;
  readonly sameScene: boolean;
}

export function comparePictures(reference: Uint8Array, other: Uint8Array): PictureComparison {
  if (reference.length !== other.length) throw new Error(`the pictures differ in size: ${String(reference.length)} and ${String(other.length)} bytes`);
  const pixels = reference.length / 4;
  let differing = 0;
  let maxDiff = 0;
  let sum = 0;
  let drawn = 0;
  const clear = [reference[0] ?? 0, reference[1] ?? 0, reference[2] ?? 0];
  for (let p = 0; p < pixels; p += 1) {
    let pixelMax = 0;
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs((reference[p * 4 + c] as number) - (other[p * 4 + c] as number));
      sum += d;
      if (d > pixelMax) pixelMax = d;
    }
    if (pixelMax > maxDiff) maxDiff = pixelMax;
    if (pixelMax > CHANNEL_TOLERANCE) differing += 1;
    if (reference[p * 4] !== clear[0] || reference[p * 4 + 1] !== clear[1] || reference[p * 4 + 2] !== clear[2]) drawn += 1;
  }
  const differingShare = differing / pixels;
  return {
    pixels,
    differingPixels: differing,
    differingShare,
    maxChannelDifference: maxDiff,
    meanAbsoluteDifference: sum / (pixels * 3),
    referenceDrawnShare: drawn / pixels,
    sameScene: differingShare <= MAX_DIFFERING_SHARE && drawn / pixels > 0.01,
  };
}
