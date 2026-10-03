/**
 * The drawing surface: canvas configuration with hardware sRGB encoding, the depth texture, resize and
 * the clear-only frame of M1 (`spec/runtime-abi.md` section 8.2; meshes are drawn from M1-18 on).
 *
 * With `test.renderTarget` the frame goes into an offscreen `rgba8unorm-srgb` texture of a fixed size
 * (independent of the canvas and of the platform's preferred format) so pixel tests are portable.
 */
import type { ResourceRegistry } from "../gpu/registry.js";

// The WebGPU usage flag values are constants of the standard. They are spelled out because the
// `GPUTextureUsage` / `GPUBufferUsage` / `GPUMapMode` globals do not exist outside a browser.
const TEXTURE_USAGE_COPY_SRC = 0x01;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const BUFFER_USAGE_MAP_READ = 0x01;
const BUFFER_USAGE_COPY_DST = 0x08;
const MAP_MODE_READ = 0x0001;

export const OFFSCREEN_FORMAT = "rgba8unorm-srgb";
export const DEPTH_FORMAT = "depth24plus";

export type CanvasFormat = "bgra8unorm" | "rgba8unorm";
export type CanvasSrgbFormat = "bgra8unorm-srgb" | "rgba8unorm-srgb";

/** The sRGB view format of a preferred canvas format; `undefined` for any other format. */
export function srgbViewFormat(format: string): CanvasSrgbFormat | undefined {
  if (format === "bgra8unorm") return "bgra8unorm-srgb";
  if (format === "rgba8unorm") return "rgba8unorm-srgb";
  return undefined;
}

/** `round(clientWidth x dpr) x round(clientHeight x dpr)`, clamped to the device's texture limit. */
export function backingSize(
  clientWidth: number,
  clientHeight: number,
  devicePixelRatio: number,
  maxDimension: number,
): { width: number; height: number } {
  const scale = (client: number): number => Math.min(Math.max(Math.round(client * devicePixelRatio), 0), maxDimension);
  return { width: scale(clientWidth), height: scale(clientHeight) };
}

/** Bytes per row of a `copyTextureToBuffer` of rgba8 pixels: 4 bytes per pixel, rounded up to 256. */
export function paddedBytesPerRow(width: number): number {
  return Math.ceil((width * 4) / 256) * 256;
}

export interface PixelData {
  width: number;
  height: number;
  format: "rgba8unorm-srgb";
  data: Uint8Array;
}

export interface SurfaceOptions {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly device: GPUDevice;
  readonly registry: ResourceRegistry;
  /** `navigator.gpu.getPreferredCanvasFormat()`; must have an sRGB view format. */
  readonly format: CanvasFormat;
  readonly renderTarget: { readonly width: number; readonly height: number } | undefined;
  /** Called each time the backing size is computed. */
  readonly devicePixelRatio: () => number;
}

export class Surface {
  private readonly viewFormat: CanvasSrgbFormat;
  private widthPx = 0;
  private heightPx = 0;
  private depth: GPUTexture | null = null;
  private depthWidth = 0;
  private depthHeight = 0;
  private offscreen: GPUTexture | null = null;
  private rendered = 0;
  private skipped = 0;
  private configured = false;

  constructor(private readonly options: SurfaceOptions) {
    const view = srgbViewFormat(options.format);
    if (view === undefined) throw new Error(`Surface: no sRGB view format for ${options.format}`);
    this.viewFormat = view;
  }

  /** Frames that were drawn / skipped because the canvas has no pixels. */
  get framesRendered(): number {
    return this.rendered;
  }

  get framesSkipped(): number {
    return this.skipped;
  }

  /** The current backing (or render target) size in pixels. */
  get size(): { width: number; height: number } {
    return { width: this.widthPx, height: this.heightPx };
  }

  /** True when a frame can be drawn: the target has at least one pixel. */
  get renderable(): boolean {
    return this.widthPx > 0 && this.heightPx > 0;
  }

  /**
   * `context.configure` with the preferred format, its sRGB view format and opaque alpha, so the hardware
   * encodes linear to sRGB (`spec/runtime-abi.md` section 8.2). Throws what the browser throws.
   */
  configure(): void {
    const { context, device, format } = this.options;
    context.configure({ device, format, viewFormats: [this.viewFormat], alphaMode: "opaque" });
    this.configured = true;
  }

  /**
   * Computes the size, applies it to the canvas and creates the depth texture (and the offscreen target
   * with `test.renderTarget`). Throws the registry's error when an allocation fails.
   */
  allocate(): void {
    const { renderTarget, registry } = this.options;
    if (renderTarget !== undefined) {
      this.widthPx = renderTarget.width;
      this.heightPx = renderTarget.height;
      this.offscreen = registry.createTexture({
        label: "mtek render target",
        size: [renderTarget.width, renderTarget.height],
        format: OFFSCREEN_FORMAT,
        usage: TEXTURE_USAGE_RENDER_ATTACHMENT | TEXTURE_USAGE_COPY_SRC,
      });
      this.ensureDepth();
      return;
    }
    this.applyCanvasSize();
  }

  /**
   * Recomputes the backing size after a `ResizeObserver` callback. Returns true when the size changed. In
   * render-target mode the size is fixed and nothing changes.
   */
  resize(): boolean {
    if (this.options.renderTarget !== undefined) return false;
    return this.applyCanvasSize();
  }

  private applyCanvasSize(): boolean {
    const { canvas, device, devicePixelRatio } = this.options;
    const max = device.limits.maxTextureDimension2D;
    const { width, height } = backingSize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio(), max);
    const changed = width !== this.widthPx || height !== this.heightPx;
    this.widthPx = width;
    this.heightPx = height;
    // Assigning width/height resets the canvas, so only do it when the value changed.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    this.ensureDepth();
    return changed;
  }

  /** Creates the depth texture for the current size; the old one is released only after the new one exists. */
  private ensureDepth(): void {
    if (!this.renderable) return;
    if (this.depth !== null && this.depthWidth === this.widthPx && this.depthHeight === this.heightPx) return;
    const next = this.options.registry.createTexture({
      label: "mtek depth",
      size: [this.widthPx, this.heightPx],
      format: DEPTH_FORMAT,
      usage: TEXTURE_USAGE_RENDER_ATTACHMENT,
    });
    const previous = this.depth;
    this.depth = next;
    this.depthWidth = this.widthPx;
    this.depthHeight = this.heightPx;
    // Replacement rule of section 9.2: the old texture is released after the new one is in place; `destroy()`
    // is safe for work that was already submitted.
    if (previous !== null) this.options.registry.release(previous);
  }

  /**
   * Draws one frame: clear colour (linear, encoded by the sRGB view) and depth 1.0. Returns false and
   * draws nothing when the canvas has no pixels (a zero-sized canvas is not an error).
   */
  render(clearColor: readonly [number, number, number, number]): boolean {
    if (!this.renderable || this.depth === null) {
      this.skipped += 1;
      return false;
    }
    const { device, context } = this.options;
    const target = this.offscreen ?? context.getCurrentTexture();
    const encoder = device.createCommandEncoder({ label: "mtek frame" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView({ format: this.offscreen !== null ? OFFSCREEN_FORMAT : this.viewFormat }),
          clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: clearColor[3] },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depth.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
    this.rendered += 1;
    return true;
  }

  /**
   * Copies the offscreen target to a mappable buffer (`bytesPerRow` padded to 256), maps it and returns
   * tightly packed rows (`spec/runtime-abi.md` section 10.2). The staging buffer is released either way.
   */
  async readPixels(): Promise<PixelData> {
    const { device, registry } = this.options;
    const offscreen = this.offscreen;
    if (offscreen === null) throw new Error("readPixels requires mountMtek options test.renderTarget");
    const { width, height } = this.size;
    const bytesPerRow = paddedBytesPerRow(width);
    const staging = registry.createBuffer({
      label: "mtek readback",
      size: bytesPerRow * height,
      usage: BUFFER_USAGE_MAP_READ | BUFFER_USAGE_COPY_DST,
    });
    try {
      const encoder = device.createCommandEncoder({ label: "mtek readback" });
      encoder.copyTextureToBuffer({ texture: offscreen }, { buffer: staging, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(MAP_MODE_READ);
      const mapped = new Uint8Array(staging.getMappedRange());
      const data = new Uint8Array(width * height * 4);
      for (let row = 0; row < height; row += 1) {
        data.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4), row * width * 4);
      }
      staging.unmap();
      return { width, height, format: OFFSCREEN_FORMAT, data };
    } finally {
      // After dispose the registry already destroyed the buffer; releasing again would throw.
      try {
        registry.release(staging);
      } catch {
        // already released by dispose
      }
    }
  }

  /** Unconfigures the canvas. The textures are released by the registry's `destroyAll`. */
  dispose(): void {
    if (this.configured) {
      this.configured = false;
      this.options.context.unconfigure();
    }
    this.depth = null;
    this.offscreen = null;
  }
}
