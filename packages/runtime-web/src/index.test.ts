import { describe, expect, it } from "vitest";
import { RUNTIME_ABI, RUNTIME_VERSION } from "./index.js";

describe("runtime constants", () => {
  it("match the specification", () => {
    expect(RUNTIME_ABI).toBe(1);
    expect(RUNTIME_VERSION).toBe("0.1.0-dev");
  });
});
