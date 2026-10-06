import { describe, expect, it } from "vitest";
import { ResourceRegistry, type RegistryDevice } from "../gpu/registry.js";
import { FakeDevice, asGpu } from "../test-support/fake-gpu.js";
import { FakeCanvas, FakeDocument, FakeEventTarget } from "../test-support/fake-host.js";
import { asDom } from "../test-support/fake-host.js";
import { attachInputListeners, pointerPosition } from "./dom.js";
import { InputState, type InputTransition } from "./input.js";

function setup(handled: readonly string[] = ["Space"]) {
  const document = new FakeDocument();
  const canvas = new FakeCanvas(document);
  canvas.clientWidth = 200;
  canvas.clientHeight = 100;
  const window = new FakeEventTarget();
  const input = new InputState();
  const registry = new ResourceRegistry(asGpu<RegistryDevice>(new FakeDevice()));
  attachInputListeners(input, {
    canvas: asDom<HTMLCanvasElement>(canvas),
    document: asDom<EventTarget>(document),
    window: asDom<EventTarget>(window),
    registry,
    handledKeys: new Set(handled),
  });
  return { document, canvas, window, input, registry };
}

const codes = (transitions: readonly InputTransition[]): string[] =>
  transitions.map((t) => ("code" in t ? `${t.kind}:${t.code}` : `${t.kind}:${String(t.button)}`));

describe("keyboard listeners", () => {
  it("turns keydown and keyup of mapped codes into transitions, ignoring auto-repeat", () => {
    const { document, input } = setup();
    document.dispatch("keydown", { code: "KeyW", repeat: false });
    document.dispatch("keydown", { code: "KeyW", repeat: true });
    document.dispatch("keyup", { code: "KeyW" });
    expect(codes(input.deliver())).toEqual(["key_down:KeyW", "key_up:KeyW"]);
  });

  it("ignores codes the language does not know", () => {
    const { document, input } = setup();
    document.dispatch("keydown", { code: "F5", repeat: false });
    document.dispatch("keydown", { code: "MediaPlayPause", repeat: false });
    expect(input.pending).toBe(0);
  });

  it("calls preventDefault only for keys some handler names", () => {
    const { document } = setup(["Space"]);
    expect(document.dispatch("keydown", { code: "Space", repeat: false }).defaultPrevented).toBe(true);
    expect(document.dispatch("keydown", { code: "Space", repeat: true }).defaultPrevented).toBe(true);
    expect(document.dispatch("keyup", { code: "Space" }).defaultPrevented).toBe(true);
    expect(document.dispatch("keydown", { code: "KeyW", repeat: false }).defaultPrevented).toBe(false);
    expect(document.dispatch("keydown", { code: "F5", repeat: false }).defaultPrevented).toBe(false);
  });

  it("window blur releases everything held at the next frame", () => {
    const { document, window, input } = setup();
    document.dispatch("keydown", { code: "KeyA", repeat: false });
    input.deliver();
    window.dispatch("blur");
    expect(codes(input.deliver())).toEqual(["key_up:KeyA"]);
  });
});

describe("pointer listeners", () => {
  const down = { isPrimary: true, pointerId: 1, button: 0, clientX: 100, clientY: 50 };

  it("reports positions in NDC: x right, y up", () => {
    const { canvas, input } = setup();
    canvas.dispatch("pointerdown", { ...down, clientX: 0, clientY: 0 });
    canvas.dispatch("pointerup", { ...down, clientX: 200, clientY: 100 });
    canvas.dispatch("pointermove", { ...down, clientX: 100, clientY: 25 });
    expect(input.deliver()).toEqual([
      { kind: "pointer_down", x: -1, y: 1, button: 0 },
      { kind: "pointer_up", x: 1, y: -1, button: 0 },
      { kind: "pointer_move", x: 0, y: 0.5, button: 0 },
    ]);
  });

  it("ignores non-primary pointers", () => {
    const { canvas, input } = setup();
    canvas.dispatch("pointerdown", { ...down, isPrimary: false });
    canvas.dispatch("pointermove", { ...down, isPrimary: false });
    expect(input.pending).toBe(0);
  });

  it("captures the pointer on a recognised press so its release is not lost", () => {
    const { canvas } = setup();
    const captured: number[] = [];
    (canvas as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = (id) => captured.push(id);
    canvas.dispatch("pointerdown", { ...down, pointerId: 7 });
    canvas.dispatch("pointerdown", { ...down, pointerId: 8 }); // a second press of the same button is not news
    expect(captured).toEqual([7]);
  });

  it("pointercancel releases only the pointer", () => {
    const { document, canvas, input } = setup();
    document.dispatch("keydown", { code: "KeyA", repeat: false });
    canvas.dispatch("pointerdown", down);
    input.deliver();
    canvas.dispatch("pointercancel", {});
    expect(codes(input.deliver())).toEqual(["pointer_up:0"]);
    expect(input.isKeyDown("KeyA")).toBe(true);
  });
});

describe("listener lifetime", () => {
  it("every listener goes through the registry and is removed by destroyAll", () => {
    const { document, canvas, window, registry } = setup();
    expect(registry.snapshot()["liveListeners"]).toBe(7);
    expect(document.listenerCount).toBe(2);
    expect(window.listenerCount).toBe(1);
    expect(canvas.listenerCount).toBe(4);
    registry.destroyAll();
    expect(registry.snapshot()["liveListeners"]).toBe(0);
    expect(document.listenerCount + window.listenerCount + canvas.listenerCount).toBe(0);
  });

  it("without a document or window only the pointer listeners exist", () => {
    const document = new FakeDocument();
    const canvas = new FakeCanvas(document);
    const registry = new ResourceRegistry(asGpu<RegistryDevice>(new FakeDevice()));
    attachInputListeners(new InputState(), {
      canvas: asDom<HTMLCanvasElement>(canvas),
      document: undefined,
      window: undefined,
      registry,
      handledKeys: new Set(),
    });
    expect(registry.snapshot()["liveListeners"]).toBe(4);
  });
});

describe("pointerPosition", () => {
  it("clamps to [-1, 1] and rounds to binary32", () => {
    const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 150 }) };
    expect(pointerPosition(canvas, -1000, -1000)).toEqual({ x: -1, y: 1 });
    expect(pointerPosition(canvas, 5000, 5000)).toEqual({ x: 1, y: -1 });
    const third = pointerPosition(canvas, 10 + 100, 20 + 50);
    expect(third.x).toBe(Math.fround(-1 / 3));
    expect(third.y).toBe(Math.fround(1 / 3));
  });

  it("survives a canvas with no size", () => {
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) };
    expect(Number.isFinite(pointerPosition(canvas, 5, 5).x)).toBe(true);
  });
});
