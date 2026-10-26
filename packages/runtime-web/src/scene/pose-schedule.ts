/** Minimum camera distance and the corresponding pose evaluation interval in seconds. */
export interface AnimationUpdateBand {
  readonly distance: number;
  readonly interval: number;
}

/** Clocks keep running; only pose sampling, IK and palette construction are throttled. */
export class PoseSchedule {
  private bands: readonly AnimationUpdateBand[] = [];
  private elapsed = 0;
  private previous = -1;

  set(bands: readonly AnimationUpdateBand[] | undefined): void {
    const copy = bands?.map(band => ({ ...band })) ?? [];
    for (let i = 0; i < copy.length; i++) {
      const band = copy[i]!;
      if (!Number.isFinite(band.distance) || band.distance < 0
        || !Number.isFinite(band.interval) || band.interval < 0
        || (i === 0 ? band.distance !== 0 : band.distance <= copy[i - 1]!.distance))
        throw new RangeError("Animation update bands need increasing distances starting at zero and finite nonnegative intervals");
    }
    this.bands = copy;
    this.elapsed = 0;
    this.previous = -1;
  }

  due(dt: number, distance: number, force = false): boolean {
    if (!Number.isFinite(distance) || distance < 0)
      throw new RangeError("Animation distance must be finite and nonnegative");
    let selected = 0;
    for (let i = 1; i < this.bands.length; i++) {
      if (distance < this.bands[i]!.distance) break;
      selected = i;
    }
    const interval = this.bands[selected]?.interval ?? 0;
    this.elapsed += dt;
    // Moving to a more detailed band immediately refreshes the displayed pose.
    const closer = this.previous >= 0 && selected < this.previous;
    this.previous = selected;
    if (!force && !closer && this.elapsed + 1e-12 < interval) return false;
    this.elapsed = interval > 0 ? this.elapsed % interval : 0;
    if (interval > 0 && interval - this.elapsed < 1e-12) this.elapsed = 0;
    return true;
  }
}
