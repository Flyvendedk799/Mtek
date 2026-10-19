/** Raw WebGPU canvas presentation, independent of Mtek shaders, geometry and offscreen readback. */
import { expect, test } from "../support/fixtures.ts";

interface PresentationProbe {
  preferredFormat: GPUTextureFormat;
  srgbFormat: GPUTextureFormat;
  errors: string[];
  framesSubmitted: number;
  framesCompleted: number;
  dispose(): void;
}
type ProbeWindow = Window & { presentationProbe?: PresentationProbe };

test("raw WebGPU presents an opaque red canvas through base and sRGB views", async ({ page, gpu }, testInfo) => {
  void gpu; // The shared fixture reports NOT-RUN, never a pass, when no adapter exists.
  let passed = false;
  try {
    await page.goto("/env.html"); // Keep the existing server's secure, same-origin context.
    await page.setContent(`<!doctype html><style>
      body{margin:0;display:flex;gap:16px;background:white}
      canvas{display:block;width:128px;height:128px;background:cyan}
      </style><canvas id="base" width="128" height="128"></canvas><canvas id="srgb" width="128" height="128"></canvas>`);
    await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter === null) throw new Error("the GPU fixture found an adapter, but the presentation page could not acquire one");
      const device = await adapter.requestDevice();
      const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
      if (preferredFormat !== "bgra8unorm" && preferredFormat !== "rgba8unorm") {
        device.destroy();
        throw new Error(`unsupported preferred canvas format: ${preferredFormat}`);
      }
      const srgbFormat = preferredFormat === "bgra8unorm" ? "bgra8unorm-srgb" : "rgba8unorm-srgb";
      const contexts: GPUCanvasContext[] = [];
      let frameRequest = 0;
      let disposed = false;
      let completionPending = false;
      const probe: PresentationProbe = {
        preferredFormat, srgbFormat, errors: [], framesSubmitted: 0, framesCompleted: 0,
        dispose() {
          disposed = true;
          cancelAnimationFrame(frameRequest);
          for (const context of contexts) context.unconfigure();
          device.destroy();
        },
      };
      (window as ProbeWindow).presentationProbe = probe;
      device.addEventListener("uncapturederror", event => { probe.errors.push(event.error.message); });
      void device.lost.then(info => { if (!disposed) probe.errors.push(`device lost: ${info.reason}: ${info.message}`); });
      for (const id of ["base", "srgb"]) {
        const canvas = document.getElementById(id);
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`missing ${id} canvas`);
        const context = canvas.getContext("webgpu");
        if (context === null) throw new Error(`no WebGPU context for ${id}`);
        contexts.push(context);
        context.configure({ device, format: preferredFormat, alphaMode: "opaque", ...(id === "srgb" ? { viewFormats: [srgbFormat] } : {}) });
      }
      const draw = (): void => {
        if (disposed || probe.errors.length > 0) return;
        for (const [index, context] of contexts.entries()) {
          // Keep the command buffers separate so one invalid view cannot invalidate both clear passes.
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({ colorAttachments: [{
            view: context.getCurrentTexture().createView({ format: index === 0 ? preferredFormat : srgbFormat }),
            clearValue: { r: 1, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store",
          }] });
          pass.end();
          device.queue.submit([encoder.finish()]);
        }
        probe.framesSubmitted += 1;
        if (!completionPending) {
          completionPending = true;
          const submitted = probe.framesSubmitted;
          void device.queue.onSubmittedWorkDone().then(() => {
            probe.framesCompleted = submitted;
            completionPending = false;
          }, (error: unknown) => {
            probe.errors.push(String(error));
            completionPending = false;
          });
        }
        frameRequest = requestAnimationFrame(draw);
      };
      draw(); // Submit once synchronously, then keep presenting across browser frames.
    });
    await page.waitForFunction(() => {
      const probe = (window as ProbeWindow).presentationProbe;
      return (probe?.framesCompleted ?? 0) > 0 || (probe?.errors.length ?? 0) > 0;
    }, undefined, { timeout: 10_000 });
    expect(await page.evaluate(() => (window as ProbeWindow).presentationProbe?.errors), "raw WebGPU queue must complete without device loss or validation errors").toEqual([]);
    await expect.poll(async () => {
      const fractions: number[] = [];
      for (const id of ["base", "srgb"]) {
        const png = await page.locator(`#${id}`).screenshot();
        fractions.push(await page.evaluate(async data => {
          const image = new Image();
          image.src = `data:image/png;base64,${data}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext("2d");
          if (context === null) throw new Error("no 2d context for screenshot inspection");
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let red = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if ((pixels[i] ?? 0) >= 250 && (pixels[i + 1] ?? 255) <= 5 && (pixels[i + 2] ?? 255) <= 5 && (pixels[i + 3] ?? 0) >= 250) red += 1;
          }
          return red / (canvas.width * canvas.height);
        }, png.toString("base64")));
      }
      return Math.min(...fractions);
    }, { timeout: 10_000, message: "both raw WebGPU canvases must present opaque red pixels" }).toBeGreaterThan(0.99);
    expect(await page.evaluate(() => (window as ProbeWindow).presentationProbe?.errors)).toEqual([]);
    passed = true;
  } finally {
    if (!passed) {
      // Capture before unconfigure/destroy; failed capture must not replace the original assertion.
      for (const id of ["base", "srgb"]) {
        try {
          await testInfo.attach(`raw-webgpu-${id}`, { body: await page.locator(`#${id}`).screenshot({ timeout: 5000 }), contentType: "image/png" });
        } catch { /* The page or canvas may not exist after a startup failure. */ }
      }
      try {
        const state = await page.evaluate(() => {
          const probe = (window as ProbeWindow).presentationProbe;
          return {
            userAgent: navigator.userAgent, navigatorGpu: navigator.gpu !== undefined,
            visibilityState: document.visibilityState, devicePixelRatio: window.devicePixelRatio,
            preferredFormat: probe?.preferredFormat, srgbFormat: probe?.srgbFormat,
            framesSubmitted: probe?.framesSubmitted, framesCompleted: probe?.framesCompleted, errors: probe?.errors,
          };
        });
        await testInfo.attach("raw-webgpu-diagnostics", { body: JSON.stringify(state, null, 2), contentType: "application/json" });
      } catch { /* Preserve the original failure if the page has closed. */ }
    }
    await page.evaluate(() => (window as ProbeWindow).presentationProbe?.dispose()).catch(() => { /* Already closed. */ });
  }
});
