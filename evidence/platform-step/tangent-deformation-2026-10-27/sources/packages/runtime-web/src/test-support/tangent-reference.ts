/** Test oracle: generic pivoted matrix inversion, independent of the runtime's
 * cofactor/WGSL implementation. Returns the normalized glTF tangent frame. */
export function referenceTangentFrame(palette: ArrayLike<number>, ids: readonly number[], weights: readonly number[], normal: readonly number[], tangent: readonly number[]): { normal: number[]; tangent: number[]; determinant: number } {
  const matrix = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) => ids.reduce((value, id, k) => weights[k] === 0 ? value : value + palette[id * 16 + column * 4 + row]! * weights[k]!, 0)));
  const augmented = matrix.map((row, r) => [...row, ...[0, 1, 2].map(c => c === r ? 1 : 0)]);
  let determinant = 1;
  for (let column = 0; column < 3; column++) {
    let pivot = column;
    for (let row = column + 1; row < 3; row++) if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    if (augmented[pivot]![column] === 0) return { normal: [...normal], tangent: [0, 0, 0, 0], determinant: 0 };
    if (pivot !== column) { [augmented[pivot], augmented[column]] = [augmented[column]!, augmented[pivot]!]; determinant *= -1; }
    const divisor = augmented[column]![column]!; determinant *= divisor;
    for (let k = 0; k < 6; k++) augmented[column]![k] = augmented[column]![k]! / divisor;
    for (let row = 0; row < 3; row++) if (row !== column) {
      const multiple = augmented[row]![column]!;
      for (let k = 0; k < 6; k++) augmented[row]![k] = augmented[row]![k]! - multiple * augmented[column]![k]!;
    }
  }
  const n = [0, 1, 2].map(row => [0, 1, 2].reduce((value, column) => value + augmented[column]![row + 3]! * normal[column]!, 0));
  const length = Math.hypot(...n); for (let k = 0; k < 3; k++) n[k] = n[k]! / length;
  const t = matrix.map(row => row.reduce((value, component, k) => value + component * tangent[k]!, 0));
  const projection = t.reduce((value, component, k) => value + component * n[k]!, 0);
  for (let k = 0; k < 3; k++) t[k] = t[k]! - projection * n[k]!;
  const magnitude = Math.hypot(...t);
  return { normal: n, tangent: magnitude <= 1e-10 || tangent[3] === 0 ? [0, 0, 0, 0] : [...t.map(value => value / magnitude), tangent[3]! * Math.sign(determinant)], determinant };
}
