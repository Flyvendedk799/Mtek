import { describe, expect, it } from "vitest";
import { COMMAND_CATEGORIES, CommandQueue, type QueuedCommand } from "./commands.js";

const A = Object.freeze({ slot: 1, gen: 0 });
const B = Object.freeze({ slot: 2, gen: 0 });
const V = { x: 1, y: 2, z: 3 };
const POSE = { position: V, rotation: { x: 0, y: 0, z: 0, w: 1 } };

function command(category: QueuedCommand["category"], target = A): QueuedCommand {
  switch (category) {
    case "teleport":
      return { category, target, pose: POSE, keepVelocity: false };
    case "kinematicTarget":
      return { category, target, pose: POSE };
    default:
      return { category, target, vector: V };
  }
}

describe("CommandQueue (spec/physics.md section 4, step 2)", () => {
  it("applies teleports, linear velocities, kinematic targets, impulses, forces, in that order", () => {
    expect([...COMMAND_CATEGORIES]).toEqual(["teleport", "linearVelocity", "kinematicTarget", "impulse", "force"]);
    const queue = new CommandQueue();
    // Pushed in the opposite order on purpose: a teleport issued after an impulse still comes first.
    for (const category of [...COMMAND_CATEGORIES].reverse()) queue.push(command(category));
    expect(queue.take().map((c) => c.category)).toEqual([...COMMAND_CATEGORIES]);
  });

  it("keeps the issue order within a category, across entities", () => {
    const queue = new CommandQueue();
    queue.push({ category: "impulse", target: A, vector: { x: 1, y: 0, z: 0 } });
    queue.push({ category: "force", target: B, vector: { x: 9, y: 0, z: 0 } });
    queue.push({ category: "impulse", target: B, vector: { x: 2, y: 0, z: 0 } });
    queue.push({ category: "impulse", target: A, vector: { x: 3, y: 0, z: 0 } });
    expect(queue.take().map((c) => [c.category, c.target.slot, "vector" in c ? c.vector.x : -1])).toEqual([
      ["impulse", 1, 1],
      ["impulse", 2, 2],
      ["impulse", 1, 3],
      ["force", 2, 9],
    ]);
  });

  it("hands a batch out once: commands pushed afterwards belong to the next batch", () => {
    const queue = new CommandQueue();
    queue.push(command("impulse"));
    queue.push(command("teleport"));
    expect(queue.size).toBe(2);
    const first = queue.take();
    expect(first).toHaveLength(2);
    expect(queue.size).toBe(0);
    queue.push(command("force"));
    expect(queue.take().map((c) => c.category)).toEqual(["force"]);
    expect(queue.take()).toEqual([]);
  });

  it("clear drops everything", () => {
    const queue = new CommandQueue();
    for (const category of COMMAND_CATEGORIES) queue.push(command(category));
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.take()).toEqual([]);
  });
});
