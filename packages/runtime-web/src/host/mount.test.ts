import { describe, expect, it } from "vitest";
import { MtekMountError, type MtekDiagnostic, type MtekMountErrorKind } from "../diagnostics/types.js";
import {
  FakeHost,
  MANIFEST_URL,
  asDom,
  fakeProgram,
  type FakeHostOptions,
} from "../test-support/fake-host.js";
import {
  BROKEN_WGSL,
  MATERIAL,
  SHADER_MAP_URL,
  SHADER_URL,
  healthyHost,
  installProgram,
  mountOn,
} from "../test-support/mount-fixture.js";
import { mountMtekWith } from "./mount.js";
import type { MtekMountOptions } from "./types.js";

async function rejection(promise: Promise<unknown>): Promise<MtekMountError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MtekMountError) return error;
    throw error;
  }
  throw new Error("expected mountMtek to reject with MtekMountError");
}

function overlayOf(host: FakeHost): ReturnType<FakeHost["document"]["body"]["find"]> {
  return host.document.body.find("data-mtek-overlay");
}

function codes(diagnostics: readonly MtekDiagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}

describe("mountMtek success", () => {
  it("resolves with a running app and reads only the manifest and the startup shader", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    expect(app.state).toBe("running");
    expect(host.fetched).toEqual([MANIFEST_URL, SHADER_URL, SHADER_MAP_URL]);
    expect(overlayOf(host)).toBeUndefined();
    app.dispose();
  });

  it("configures the canvas with the preferred format, its sRGB view format and opaque alpha", async () => {
    for (const preferred of ["bgra8unorm", "rgba8unorm"]) {
      const host = new FakeHost({ gpu: { preferredFormat: preferred } });
      installProgram(host);
      const app = await mountOn(host);
      expect(host.context.configuration?.format).toBe(preferred);
      expect(host.context.configuration?.viewFormats).toEqual([`${preferred}-srgb`]);
      expect(host.context.configuration?.alphaMode).toBe("opaque");
      app.dispose();
    }
  });

  it("requests exactly the manifest's required features and limits, with no user-agent input", async () => {
    const host = new FakeHost({ adapter: { features: ["timestamp-query"], limits: { maxBufferSize: 600_000_000 } } });
    installProgram(host, (manifest) => {
      manifest["requiredCapabilities"] = {
        features: ["timestamp-query"],
        limits: { maxBufferSize: 300_000_000 },
        wgslLanguageFeatures: [],
      };
    });
    const app = await mountOn(host);
    expect(host.adapter?.deviceRequests).toEqual([
      { requiredFeatures: ["timestamp-query"], requiredLimits: { maxBufferSize: 300_000_000 } },
    ]);
    app.dispose();
  });

  it("creates the depth24plus texture at round(client size x devicePixelRatio) and resizes the canvas", async () => {
    const host = healthyHost();
    host.canvas.clientWidth = 200;
    host.canvas.clientHeight = 101;
    const app = await mountOn(host, { devicePixelRatio: 1.5 });
    expect(host.canvas.width).toBe(300);
    expect(host.canvas.height).toBe(152); // round(151.5) = 152
    const depth = host.device.textures.filter((t) => t.format === "depth24plus");
    expect(depth).toHaveLength(1);
    expect([depth[0]?.width, depth[0]?.height]).toEqual([300, 152]);
    app.dispose();
  });

  it("uses the environment's devicePixelRatio for 'auto' (the default)", async () => {
    const host = healthyHost();
    host.devicePixelRatio = 2;
    const app = await mountOn(host);
    expect([host.canvas.width, host.canvas.height]).toEqual([400, 200]);
    app.dispose();
  });

  it("creates the startup shader module and waits for its compilation info", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    expect(host.device.shaderModules).toHaveLength(1);
    expect(app.debug).toBeUndefined();
    app.dispose();
  });

  it("takes pauseWhenHidden from the manifest unless the option overrides it", async () => {
    const hostA = healthyHost();
    const appA = await mountOn(hostA);
    expect(hostA.document.listenerCount).toBe(1); // manifest default is true
    appA.dispose();

    const hostB = healthyHost();
    const appB = await mountOn(hostB, { pauseWhenHidden: false });
    expect(hostB.document.listenerCount).toBe(0);
    appB.dispose();
  });

  it("starts paused when the page is hidden at mount time and pauseWhenHidden is on", async () => {
    const host = healthyHost();
    host.document.visibilityState = "hidden";
    const app = await mountOn(host);
    expect(app.state).toBe("paused");
    host.document.setVisibility("visible");
    expect(app.state).toBe("running");
    app.dispose();
  });
});

describe("mountMtek inputs before M3", () => {
  it("reports MTEK-E8040 for every key through onDiagnostic and still resolves", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const options: MtekMountOptions<{ tint: string; speed: number }> = {
      inputs: { tint: "#ff0000", speed: 2 },
      onDiagnostic: (d) => seen.push(d),
    };
    const app = await mountOn(host, options);
    expect(app.state).toBe("running");
    expect(seen.map((d) => d.code)).toEqual(["MTEK-E8040", "MTEK-E8040"]);
    expect(seen[0]?.message).toContain("'speed'");
    expect(seen[1]?.message).toContain("'tint'");
    expect(seen.every((d) => d.severity === "error" && d.phase === "runtime:input")).toBe(true);
    // Not fatal: no overlay.
    expect(overlayOf(host)).toBeUndefined();
    app.dispose();
  });

  it("reports nothing when no inputs are passed", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    expect(seen).toEqual([]);
    app.dispose();
  });
});

describe("mountMtek option validation", () => {
  it("rejects programmer errors synchronously-in-effect with TypeError/RangeError and acquires nothing", async () => {
    const host = healthyHost();
    const bad: Array<[MtekMountOptions, RegExp]> = [
      [{ failureDisplay: "banner" as unknown as "none" }, /failureDisplay/],
      [{ devicePixelRatio: 0 }, /devicePixelRatio/],
      [{ devicePixelRatio: Number.NaN }, /devicePixelRatio/],
      [{ seed: Number.POSITIVE_INFINITY }, /seed/],
      [{ test: { renderTarget: { width: 0, height: 8 } } }, /renderTarget\.width/],
      [{ test: { renderTarget: { width: 8, height: 1.5 } } }, /renderTarget\.height/],
    ];
    for (const [options, pattern] of bad) {
      await expect(mountOn(host, options)).rejects.toThrow(pattern);
    }
    expect(host.fetched).toEqual([]);
    expect(host.adapter?.devices).toEqual([]);
  });

  it("rejects a render target above the device's maxTextureDimension2D and leaves nothing behind", async () => {
    const host = healthyHost();
    await expect(mountOn(host, { test: { renderTarget: { width: 9000, height: 8 } } })).rejects.toThrow(
      /maxTextureDimension2D/,
    );
    expect(host.device.destroyed).toBe(true);
    expect(host.context.unconfigureCalls).toBe(host.context.configureCalls);
  });
});

interface FailureCase {
  readonly name: string;
  readonly kind: MtekMountErrorKind;
  readonly code: string;
  readonly host: () => FakeHost;
  /** A text the message must contain. */
  readonly mention: string;
  /** Extra mount options. */
  readonly options?: MtekMountOptions;
}

function hostWith(options: FakeHostOptions, edit?: (manifest: Record<string, unknown>) => void): FakeHost {
  const host = new FakeHost(options);
  installProgram(host, edit);
  return host;
}

const FAILURE_CASES: readonly FailureCase[] = [
  {
    name: "no navigator.gpu",
    kind: "webgpu-unavailable",
    code: "MTEK-E8004",
    host: () => hostWith({ noGpu: true }),
    mention: "",
  },
  {
    name: "a big-endian platform",
    kind: "webgpu-unavailable",
    code: "MTEK-E8001",
    host: () => hostWith({ littleEndian: false }),
    mention: "big-endian",
  },
  {
    name: "a canvas that already has another context type",
    kind: "webgpu-unavailable",
    code: "MTEK-E8004",
    host: () => {
      const host = healthyHost();
      host.canvas.claimContext("2d");
      return host;
    },
    mention: "WebGPU context",
  },
  {
    name: "requestAdapter resolving null",
    kind: "adapter-unavailable",
    code: "MTEK-E8005",
    host: () => hostWith({ adapter: null }),
    mention: "",
  },
  {
    name: "a required feature the adapter lacks",
    kind: "device-failed",
    code: "MTEK-E8002",
    host: () =>
      hostWith({}, (manifest) => {
        manifest["requiredCapabilities"] = { features: ["timestamp-query"], limits: {}, wgslLanguageFeatures: [] };
      }),
    mention: "timestamp-query",
  },
  {
    name: "a required limit above the adapter's",
    kind: "device-failed",
    code: "MTEK-E8002",
    host: () =>
      hostWith({}, (manifest) => {
        manifest["requiredCapabilities"] = { features: [], limits: { maxBufferSize: 999_999_999_999 }, wgslLanguageFeatures: [] };
      }),
    mention: "maxBufferSize",
  },
  {
    name: "a required WGSL language feature the browser lacks",
    kind: "device-failed",
    code: "MTEK-E8002",
    host: () =>
      hostWith({}, (manifest) => {
        manifest["requiredCapabilities"] = { features: [], limits: {}, wgslLanguageFeatures: ["packed_4x8_integer_dot_product"] };
      }),
    mention: "packed_4x8_integer_dot_product",
  },
  {
    name: "requestDevice rejecting",
    kind: "device-failed",
    code: "MTEK-E8002",
    host: () => hostWith({ adapter: { requestDeviceError: new Error("device busy") } }),
    mention: "device could not be created",
  },
  {
    name: "a manifest with a future runtimeAbi",
    kind: "incompatible-program",
    code: "MTEK-E8003",
    host: () =>
      hostWith({}, (manifest) => {
        manifest["runtimeAbi"] = 2;
      }),
    mention: "runtimeAbi",
  },
  {
    name: "a manifest with another languageVersion",
    kind: "incompatible-program",
    code: "MTEK-E8003",
    host: () =>
      hostWith({}, (manifest) => {
        manifest["languageVersion"] = "0.2";
      }),
    mention: "languageVersion",
  },
  {
    name: "a manifest that is both incompatible and schema-invalid (compatibility is reported first)",
    kind: "incompatible-program",
    code: "MTEK-E8003",
    host: () =>
      hostWith({}, (manifest) => {
        manifest["runtimeAbi"] = 2;
        delete manifest["scene"];
      }),
    mention: "runtimeAbi",
  },
  {
    name: "a manifest that violates the schema",
    kind: "manifest-invalid",
    code: "MTEK-E8006",
    host: () =>
      hostWith({}, (manifest) => {
        delete manifest["scene"];
      }),
    mention: "scene",
  },
  {
    name: "a manifest that is not JSON",
    kind: "manifest-invalid",
    code: "MTEK-E8006",
    host: () => {
      const host = healthyHost();
      host.files.set(MANIFEST_URL, "{ not json");
      return host;
    },
    mention: "not valid JSON",
  },
  {
    name: "a manifest URL answering 404",
    kind: "manifest-invalid",
    code: "MTEK-E8006",
    host: () => {
      const host = healthyHost();
      host.files.delete(MANIFEST_URL);
      return host;
    },
    mention: "HTTP 404",
  },
  {
    name: "a network failure fetching the manifest",
    kind: "manifest-invalid",
    code: "MTEK-E8006",
    host: () => {
      const host = healthyHost();
      host.files.set(MANIFEST_URL, new Error("offline"));
      return host;
    },
    mention: "offline",
  },
  {
    name: "a shader that fails to compile",
    kind: "shader-failed",
    code: "MTEK-E8051",
    host: () => {
      const host = healthyHost();
      host.files.set(SHADER_URL, BROKEN_WGSL);
      return host;
    },
    mention: "unexpected token",
  },
  {
    name: "a missing shader file",
    kind: "shader-failed",
    code: "MTEK-E8051",
    host: () => {
      const host = healthyHost();
      host.files.delete(SHADER_URL);
      return host;
    },
    mention: "could not be loaded",
  },
  {
    name: "a render pipeline that cannot be created",
    kind: "shader-failed",
    code: "MTEK-E8051",
    host: () => hostWith({ adapter: { pipelineError: () => "vertex attribute location 0 is not provided" } }),
    mention: "vertex attribute location 0",
  },
  {
    name: "a scene structure whose references do not resolve",
    kind: "manifest-invalid",
    code: "MTEK-E8006",
    host: () =>
      hostWith({}, (manifest) => {
        const entity = (manifest["scene"] as { entities: Record<string, unknown>[] }).entities[0];
        if (entity !== undefined) entity["mesh"] = "mesh:7";
      }),
    mention: "mesh:7",
  },
  {
    name: "a program module from another build (no such entry scene)",
    kind: "incompatible-program",
    code: "MTEK-E8003",
    host: () =>
      hostWith({}, (manifest) => {
        manifest["entryScene"] = "Elsewhere";
        (manifest["scene"] as Record<string, unknown>)["name"] = "Elsewhere";
      }),
    mention: "no scene 'Elsewhere'",
  },
  {
    name: "an out-of-memory depth texture",
    kind: "allocation-failed",
    code: "MTEK-E8063",
    host: () => hostWith({ adapter: { failAllocations: 1 } }),
    mention: "out of memory",
  },
];

describe("mountMtek failures (kind, diagnostics, overlay, cleanup)", () => {
  for (const testCase of FAILURE_CASES) {
    it(`${testCase.name} rejects with ${testCase.kind} and ${testCase.code}`, async () => {
      const host = testCase.host();
      const reported: MtekDiagnostic[] = [];
      const error = await rejection(mountOn(host, { onDiagnostic: (d) => reported.push(d) }));

      // The documented kind and code (spec/runtime-abi.md 6.1).
      expect(error.kind).toBe(testCase.kind);
      expect(error.name).toBe("MtekMountError");
      expect(codes(error.diagnostics)).toContain(testCase.code);
      expect(error.diagnostics[0]?.message).toContain(testCase.mention);
      expect(error.diagnostics.every((d) => d.phase === "runtime:mount" && d.severity === "error")).toBe(true);

      // Every fatal diagnostic reached onDiagnostic.
      expect(codes(reported)).toEqual(codes(error.diagnostics));

      // Failure visibility (spec/testing.md 6.7): the overlay is in the DOM, accessible, with the code.
      const overlay = overlayOf(host);
      expect(overlay, "overlay element").toBeDefined();
      expect(overlay?.getAttribute("role")).toBe("alert");
      expect(overlay?.textContent).toContain(testCase.code);
      expect(overlay?.textContent).toContain(error.diagnostics[0]?.message ?? "<no message>");

      // Nothing is left running or allocated, and nothing was drawn.
      expect(host.pendingFrames).toBe(0);
      expect(host.document.listenerCount).toBe(0);
      if (host.adapter !== null && host.adapter.devices.length > 0) {
        expect(host.device.destroyed).toBe(true);
        expect(host.device.textures.every((t) => t.destroyed)).toBe(true);
        expect(host.device.buffers.every((b) => b.destroyed)).toBe(true);
        expect(host.device.queue.submits).toBe(0);
        expect(host.device.openErrorScopes).toBe(0);
      }
      if (host.canvas.context !== null) {
        expect(host.context.configuration).toBeNull();
      }
    });
  }

  it("shows no overlay with failureDisplay 'none', but still rejects and reports", async () => {
    const host = hostWith({ adapter: null });
    const reported: MtekDiagnostic[] = [];
    const error = await rejection(mountOn(host, { failureDisplay: "none", onDiagnostic: (d) => reported.push(d) }));
    expect(error.kind).toBe("adapter-unavailable");
    expect(overlayOf(host)).toBeUndefined();
    expect(codes(reported)).toEqual(["MTEK-E8005"]);
  });

  it("rejects a program module whose abi is not 1 with incompatible-program, before any fetch", async () => {
    const host = healthyHost();
    const program = { ...fakeProgram(), abi: 2 as unknown as 1 };
    const error = await rejection(mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), program));
    expect(error.kind).toBe("incompatible-program");
    expect(error.diagnostics[0]?.notes).toContain("field: abi");
    expect(host.fetched).toEqual([]);
  });

  it("names the mismatching field in a note (E8003, E8006)", async () => {
    const host = hostWith({}, (manifest) => {
      manifest["runtimeAbi"] = 3;
    });
    const error = await rejection(mountOn(host));
    expect(error.diagnostics[0]?.notes).toContain("field: runtimeAbi");

    const invalid = hostWith({}, (manifest) => {
      delete manifest["scene"];
    });
    const error2 = await rejection(mountOn(invalid));
    expect(error2.diagnostics.some((d) => d.notes.includes("field: scene"))).toBe(true);
  });

  it("maps a shader error through the span map to the Mtek source span", async () => {
    const host = healthyHost();
    host.files.set(SHADER_URL, BROKEN_WGSL);
    const error = await rejection(mountOn(host));
    const diagnostic = error.diagnostics[0];
    // WGSL 2:16 lies in two entries; the narrower one (span 2, bytes 40..58) wins.
    expect(diagnostic?.source).toEqual({
      file: "src/main.mtek",
      startByte: 40,
      endByte: 58,
      startLine: 2,
      startColumn: 1,
      endLine: 2,
      endColumn: 19,
    });
    expect(diagnostic?.notes).toContain(`generated from ${MATERIAL}.fragment.expr`);
    expect(diagnostic?.notes.some((n) => n.includes(":2:16"))).toBe(true);
  });

  it("falls back to the material declaration when the span map is missing, and says so", async () => {
    const host = healthyHost();
    host.files.set(SHADER_URL, BROKEN_WGSL);
    host.files.delete(SHADER_MAP_URL);
    const error = await rejection(mountOn(host));
    const diagnostic = error.diagnostics[0];
    expect(diagnostic?.code).toBe("MTEK-E8051");
    // The material symbol resolves to span 3 (bytes 60..71, 2:21 in the fixture).
    expect(diagnostic?.source?.startByte).toBe(60);
    expect(diagnostic?.notes.some((n) => n.includes("span map could not be loaded"))).toBe(true);
  });

  it("is repeatable: a failed mount on a canvas does not poison the next mount", async () => {
    const host = healthyHost();
    host.files.set(SHADER_URL, BROKEN_WGSL);
    await rejection(mountOn(host));
    expect(overlayOf(host)).toBeDefined();
    host.files.set(SHADER_URL, "// fixed\n");
    const app = await mountOn(host);
    // The earlier failure's overlay is gone once the same canvas mounts again.
    expect(overlayOf(host)).toBeUndefined();
    app.dispose();
  });

  it("reports a device loss that happens while mounting", async () => {
    const host = healthyHost();
    const promise = mountOn(host);
    // The device exists after the first awaits; lose it before the mount settles.
    const poll = (): void => {
      if (host.adapter !== null && host.adapter.devices.length > 0) host.device.loseDevice("unknown", "gpu process crashed");
      else queueMicrotask(poll);
    };
    poll();
    const error = await rejection(promise);
    expect(error.kind).toBe("device-failed");
    expect(error.diagnostics[0]?.message).toContain("gpu process crashed");
  });
});
