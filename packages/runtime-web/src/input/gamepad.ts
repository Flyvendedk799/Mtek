export interface GamepadSnapshot {
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly value: number }[];
}

/** One sample per input phase, independent of browser-owned Gamepad objects. */
export class GamepadInput {
  private pads: readonly (GamepadSnapshot | null)[] = [];
  constructor(private readonly read: () => readonly (GamepadSnapshot | null)[]) {}
  poll(): void {
    try {
      this.pads = Array.from(this.read(), pad => pad?.connected === true ? {
        connected: true, axes: Array.from(pad.axes), buttons: Array.from(pad.buttons, b => ({ value: b.value })),
      } : null);
    } catch { this.pads = []; }
  }
  connected(pad: number): boolean { return Number.isInteger(pad) && pad >= 0 && this.pads[pad]?.connected === true; }
  axis(pad: number, index: number): number { return this.value(pad, index, false); }
  button(pad: number, index: number): number { return this.value(pad, index, true); }
  private value(pad: number, index: number, button: boolean): number {
    if (!this.connected(pad) || !Number.isInteger(index) || index < 0) return 0;
    const state = this.pads[pad];
    const value = button ? state?.buttons[index]?.value : state?.axes[index];
    return typeof value === "number" && Number.isFinite(value) ? Math.fround(Math.max(button ? 0 : -1, Math.min(1, value))) : 0;
  }
}
