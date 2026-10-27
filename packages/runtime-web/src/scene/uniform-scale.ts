// Imported bind/animation values are float32, even though pose arithmetic uses doubles.
// Permit bounded exporter round-off, not general nonuniform orientation frames.
const FLOAT32_SCALE_ROUND_OFF = 16 * 2 ** -23;
export function numericallyUniformScale(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && x > 0 && y > 0 && z > 0
    && Math.abs(x / y - 1) <= FLOAT32_SCALE_ROUND_OFF && Math.abs(x / z - 1) <= FLOAT32_SCALE_ROUND_OFF;
}
