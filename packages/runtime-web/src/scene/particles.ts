/**
 * Bounded CPU particles (decision 0155).
 *
 * Each emitter keeps at most {@link PARTICLE_CAPACITY} particles. They are spawned at `rate` per
 * second in the upper hemisphere around the entity's world position, then fall under `gravity`
 * (metres per second squared, downward). Drawing is the renderer's job: a particle with no mesh
 * is still counted.
 *
 * The particles draw their numbers from a stream of their own, not from the program's `random()` (decision 0173), so
 * that adding an emitter does not move the sequence a seeded run gives to the gameplay.
 */

export const PARTICLE_CAPACITY = 64;

/** The seed of the particle stream: fixed, so a run is reproducible whatever the program's seed is. */
export const PARTICLE_SEED = 0x70a27c1e;

/** A small seeded generator (mulberry32): numbers in `[0, 1)`. */
export function particleStream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EmitterSpec {
  readonly slot: number;
  readonly rate: number;
  readonly lifetime: number;
  readonly speed: number;
  readonly size: number;
  readonly gravity: number;
  readonly meshId: string | null;
  readonly materialId: string | null;
  readonly instanceIndex: number | null;
}

export interface ParticlePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly size: number;
}

/** One emitter's living particles, ready to draw. Absent when the emitter has no mesh. */
export interface ParticleDraw {
  readonly meshId: string;
  readonly materialId: string;
  readonly instanceIndex: number;
  readonly points: readonly ParticlePoint[];
}

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
}

interface Emitter {
  spec: EmitterSpec;
  acc: number;
  sparks: Spark[];
  /** What `draws` hands out for this emitter: `points` is `sparks` itself (a spark has the fields of a point). */
  draw: ParticleDraw | undefined;
}

/** The scene's emitters. `add` replaces an emitter already registered for the same slot. */
export class ParticleSim {
  private readonly emitters: Emitter[] = [];
  private readonly stream = particleStream(PARTICLE_SEED);
  private readonly drawn: ParticleDraw[] = [];

  add(spec: EmitterSpec): void {
    this.remove(spec.slot);
    this.emitters.push({ spec, acc: 0, sparks: [], draw: undefined });
  }

  remove(slot: number): void {
    const index = this.emitters.findIndex((emitter) => emitter.spec.slot === slot);
    if (index >= 0) this.emitters.splice(index, 1);
  }

  count(): number {
    let total = 0;
    for (const emitter of this.emitters) total += emitter.sparks.length;
    return total;
  }

  /**
   * Ages the living particles, then spawns. `origin` is the entity's world position. A fraction of
   * a particle carries in the accumulator, so `rate * dt` of 1.5 spawns 1, then 2, then 1.
   */
  advance(dt: number, origin: (slot: number) => { x: number; y: number; z: number }, random: () => number = this.stream): void {
    for (const emitter of this.emitters) {
      const { spec, sparks } = emitter;
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i] as Spark;
        spark.vy -= spec.gravity * dt;
        spark.x += spark.vx * dt;
        spark.y += spark.vy * dt;
        spark.z += spark.vz * dt;
        spark.age += dt;
        if (spark.age >= spark.life) sparks.splice(i, 1);
      }
      emitter.acc += spec.rate * dt;
      let spawn = Math.floor(emitter.acc);
      emitter.acc -= spawn;
      const at = origin(spec.slot);
      while (spawn > 0 && sparks.length < PARTICLE_CAPACITY) {
        spawn -= 1;
        // Uniform on the upper hemisphere: y is the up component in [0, 1].
        const up = random();
        const ring = Math.sqrt(Math.max(0, 1 - up * up));
        const azimuth = random() * Math.PI * 2;
        const speed = spec.speed;
        sparks.push({
          x: at.x,
          y: at.y,
          z: at.z,
          vx: ring * Math.cos(azimuth) * speed,
          vy: up * speed,
          vz: ring * Math.sin(azimuth) * speed,
          age: 0,
          life: spec.lifetime,
          size: spec.size,
        });
      }
    }
  }

  /** The emitters with living particles that can be drawn. The array and its records are reused: valid until the next call. */
  draws(): readonly ParticleDraw[] {
    const out = this.drawn;
    out.length = 0;
    for (const emitter of this.emitters) {
      const { spec, sparks } = emitter;
      if (spec.meshId === null || spec.materialId === null || spec.instanceIndex === null || sparks.length === 0) continue;
      emitter.draw ??= { meshId: spec.meshId, materialId: spec.materialId, instanceIndex: spec.instanceIndex, points: sparks };
      out.push(emitter.draw);
    }
    return out;
  }
}
