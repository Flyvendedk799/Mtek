/**
 * GPU time of the frame's render pass from `timestamp-query` (`spec/runtime-abi.md` section 10.1,
 * decision 0055). Development builds only.
 *
 * Two timestamps bracket the render pass; they are resolved into a buffer and copied into a mappable
 * buffer in the frame's own command buffer. The mapping is requested after the submit and its result
 * arrives asynchronously, so a frame never waits for the GPU. One measurement is in flight at a time: a
 * frame that starts while the previous result is still pending is simply not measured, and `lastMs`
 * keeps the most recent completed measurement. Nothing here is ever derived from CPU clocks: without the
 * feature no timer exists and the overlay says "GPU time unavailable".
 */
import type { ResourceRegistry } from "../gpu/registry.js";
import type { PassTimer } from "../host/surface.js";

// WebGPU usage flags (constants of the standard; the globals do not exist outside a browser).
const BUFFER_USAGE_MAP_READ = 0x01;
const BUFFER_USAGE_COPY_SRC = 0x04;
const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_QUERY_RESOLVE = 0x200;
const MAP_MODE_READ = 0x0001;

/** The WebGPU feature that makes GPU time available. */
export const TIMESTAMP_FEATURE = "timestamp-query";

/** The part of the device the timer uses. */
export type TimerDevice = Pick<GPUDevice, "createQuerySet" | "features">;

/** True when `device` was created with `timestamp-query`. */
export function hasTimestampQuery(device: Pick<GPUDevice, "features">): boolean {
  return device.features.has(TIMESTAMP_FEATURE);
}

export class GpuTimer implements PassTimer {
  private readonly querySet: GPUQuerySet;
  private readonly resolveBuffer: GPUBuffer;
  private readonly readBuffer: GPUBuffer;
  private armed = false;
  private inFlight = false;
  private disposed = false;
  private last: number | null = null;
  private completed = 0;

  /** Throws when the device lacks `timestamp-query` (check `hasTimestampQuery` first). */
  constructor(device: TimerDevice, registry: ResourceRegistry) {
    if (!hasTimestampQuery(device)) throw new Error("GpuTimer: the device was created without timestamp-query");
    this.querySet = device.createQuerySet({ label: "mtek gpu timer", type: "timestamp", count: 2 });
    this.resolveBuffer = registry.createBuffer({
      label: "mtek gpu timer resolve",
      size: 16,
      usage: BUFFER_USAGE_QUERY_RESOLVE | BUFFER_USAGE_COPY_SRC,
    });
    this.readBuffer = registry.createBuffer({
      label: "mtek gpu timer read",
      size: 16,
      usage: BUFFER_USAGE_MAP_READ | BUFFER_USAGE_COPY_DST,
    });
  }

  /** GPU time of the render pass in milliseconds from the latest completed measurement; `null` before the first one. */
  get lastMs(): number | null {
    return this.last;
  }

  /** Measurements completed so far. */
  get measurements(): number {
    return this.completed;
  }

  passTimestampWrites(): GPURenderPassTimestampWrites | undefined {
    if (this.disposed || this.inFlight) return undefined;
    this.armed = true;
    return { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  resolve(encoder: GPUCommandEncoder): void {
    if (!this.armed) return;
    encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, 16);
  }

  submitted(): void {
    if (!this.armed) return;
    this.armed = false;
    this.inFlight = true;
    void this.readBuffer.mapAsync(MAP_MODE_READ).then(
      () => {
        if (this.disposed) return;
        const [begin, end] = new BigUint64Array(this.readBuffer.getMappedRange().slice(0, 16));
        this.readBuffer.unmap();
        this.inFlight = false;
        if (begin !== undefined && end !== undefined && end >= begin) {
          // Nanoseconds to milliseconds.
          this.last = Number(end - begin) / 1e6;
          this.completed += 1;
        }
      },
      () => {
        // The device was destroyed or lost while the mapping was pending: no measurement.
        this.inFlight = false;
      },
    );
  }

  /** Stops measuring and destroys the query set. The buffers belong to the registry. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.querySet.destroy();
  }
}
