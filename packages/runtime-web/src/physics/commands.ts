/**
 * The body-command queue of `spec/physics.md` sections 3 and 4 (decision 0066).
 *
 * A command issued by a handler or a lifecycle function is queued, never applied at once. At the start of the
 * next fixed tick (after the lifecycle flush, before `fixed_update`) the whole queue is applied **once**,
 * **grouped by category in a fixed order** (teleports, linear velocities, kinematic targets, character moves, impulses, forces)
 * and **in issue order within a category**, so a teleport issued after an impulse in the same tick still happens
 * first, deterministically. Commands issued while a tick runs (`fixed_update`, collision handlers) go into the
 * next batch: {@link CommandQueue.take} hands the current batch out and leaves the queue empty.
 *
 * The queue knows nothing about worlds or entities beyond the reference a command was aimed at; whether that
 * reference still names a body is decided when the batch is applied.
 */
import type { EntityRef } from "../scene/slots.js";
import type { Pose, Quat, Vec3 } from "./types.js";

/**
 * The categories in the order they are applied (`spec/physics.md` section 4, step 2). `characterMove` (decision
 * 0217) comes after the kinematic targets, so the pose change of a platform issued in the same tick is already
 * known when a character standing on it is resolved, and before the impulses.
 */
export const COMMAND_CATEGORIES = ["teleport", "linearVelocity", "kinematicTarget", "characterMove", "impulse", "force"] as const;

export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];

/** A queued command: what to do and the entity (slot and generation) it was aimed at. */
export type QueuedCommand =
  | { readonly category: "teleport"; readonly target: EntityRef; readonly pose: Pose; readonly keepVelocity: boolean }
  | { readonly category: "linearVelocity"; readonly target: EntityRef; readonly vector: Vec3 }
  | { readonly category: "kinematicTarget"; readonly target: EntityRef; readonly pose: Pose }
  | { readonly category: "characterMove"; readonly target: EntityRef; readonly displacement: Vec3; readonly rotation: Quat }
  | { readonly category: "impulse"; readonly target: EntityRef; readonly vector: Vec3 }
  | { readonly category: "force"; readonly target: EntityRef; readonly vector: Vec3 };

export class CommandQueue {
  private readonly lanes: Record<CommandCategory, QueuedCommand[]> = {
    teleport: [],
    linearVelocity: [],
    kinematicTarget: [],
    characterMove: [],
    impulse: [],
    force: [],
  };
  private count = 0;

  /** The number of commands waiting. */
  get size(): number {
    return this.count;
  }

  push(command: QueuedCommand): void {
    this.lanes[command.category].push(command);
    this.count += 1;
  }

  /**
   * Removes every queued command and returns them in application order: by category, each category in the
   * order its commands were pushed. Commands pushed after this call belong to the next batch.
   */
  take(): QueuedCommand[] {
    const batch: QueuedCommand[] = [];
    for (const category of COMMAND_CATEGORIES) {
      const lane = this.lanes[category];
      for (const command of lane) batch.push(command);
      lane.length = 0;
    }
    this.count = 0;
    return batch;
  }

  /** Drops everything that is queued (the world was disposed or rebuilt). */
  clear(): void {
    for (const category of COMMAND_CATEGORIES) this.lanes[category].length = 0;
    this.count = 0;
  }
}
