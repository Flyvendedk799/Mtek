// M5-06: sensor enter and exit counts on the real physics engine (spec/physics.md sections 6 and 7, decision 0068).
// `fixtures/m5/physics_sensor` sends four balls (radius 0.25) through a sensor zone (a static box, y from 3 to 5) on
// paths whose crossings are known from the flight alone, and counts every delivery from both sides: the zone's
// handlers and the balls' own. Every expected number is derived here from the program, not read from the runtime:
//   a ball touches the zone when its centre is within the radius of it, i.e. at y = 5.25 and y = 2.75;
//   free flight y(t) = y0 + v0 t - g t^2 / 2 gives the times of the crossings (physics-support.ts);
//   the engine reports a contact one step after the poses that make it (decision 0063 item 5: "events lag by one
//   step") and the runtime delivers it in the tick of that step, so a crossing at time t after the tick that applied
//   the start velocity is delivered in tick  offset + ceil(t / step) + 1.
// A ball dropped from rest has offset 0; the balls thrown with Space (pressed after five ticks, so the commands
// land at the start of tick 6) have offset 5. Delivery order inside one tick is enter before exit, then by slot.
import { expect, test } from "../../support/fixtures.ts";
import { PHYSICS_SENSOR } from "../../support/m5-fixtures.ts";
import { GRAVITY, STEP, TARGET, crossingTimes, openFixture, type AppLike, type DiagnosticLike } from "./physics-support.ts";

const FIXTURE = PHYSICS_SENSOR;
const RADIUS = 0.25;
const ZONE = { bottom: 3, top: 5 } as const;
const SETTLE_TICKS = 5;
const TOTAL_TICKS = 360;

interface Crossing {
  who: number;
  kind: "enter" | "exit";
  tick: number;
}

/** What each ball does (1 = A, 2 = B, 3 = C, 4 = D): where it starts, its start velocity, the tick that applies it. */
const FLIGHTS = [
  { who: 1, y0: 9, v0: 0, offset: 0, stopsAt: 0.25 },
  { who: 2, y0: 0.25, v0: 12, offset: SETTLE_TICKS, stopsAt: 0.25 },
  { who: 3, y0: 0.25, v0: 8.5, offset: SETTLE_TICKS, stopsAt: 0.25 },
  // D lands on the ledge (top face y = 4) and rests inside the zone: it never leaves it.
  { who: 4, y0: 9, v0: 0, offset: 0, stopsAt: 4.25 },
] as const;

/**
 * The crossings of the zone by one flight, in the order they happen: the zone is entered when the centre comes within
 * `RADIUS` of it and left when it goes farther than that, so along a flight the sign of (distance - radius) changes at
 * the roots of y(t) = top + RADIUS and y(t) = bottom - RADIUS. Only roots before the ball stops count.
 */
function crossings(flight: (typeof FLIGHTS)[number]): Crossing[] {
  const upper = crossingTimes(flight.y0, flight.v0, ZONE.top + RADIUS).map((t) => ({ t, level: "top" as const }));
  const lower = crossingTimes(flight.y0, flight.v0, ZONE.bottom - RADIUS).map((t) => ({ t, level: "bottom" as const }));
  const events: Array<{ t: number; level: "top" | "bottom" }> = [...upper, ...lower].sort((p, q) => p.t - q.t);
  // The ball is outside the zone before the first crossing and alternates after it. A ball that lands on the ledge at
  // y = stopsAt stops before it can cross the bottom level (stopsAt > bottom - RADIUS): drop those roots.
  const reachable = flight.stopsAt > ZONE.bottom - RADIUS ? events.filter((event) => event.level === "top" && event.t <= firstTime(flight, flight.stopsAt)) : events;
  return reachable.map((event, index) => ({
    who: flight.who,
    kind: index % 2 === 0 ? "enter" : "exit",
    tick: flight.offset + Math.ceil(event.t / STEP) + 1,
  }));
}

/** The first time the flight is at `level` going down (the moment it touches down on a surface whose contact height is `level`). */
function firstTime(flight: (typeof FLIGHTS)[number], level: number): number {
  const times = crossingTimes(flight.y0, flight.v0, level);
  return times[times.length - 1] ?? Number.POSITIVE_INFINITY;
}

test.describe("sensor enter and exit counts on the real engine (M5-06)", () => {
  test("every crossing of the zone is one enter and one exit, delivered once to each side, in the derived tick", async ({ page, gpu }, testInfo) => {
    void gpu;
    await openFixture(page, FIXTURE);
    const run = await page.evaluate(
      async ({ target, dt, settle, total }) => {
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        const reported: DiagnosticLike[] = [];
        const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
        // Settle B and C on the floor, then throw them: the commands of the key land at the start of the next tick.
        app.debug.step(settle, dt);
        app.debug.pressKey("Space");
        app.debug.step(1, dt);
        app.debug.releaseKey("Space");
        app.debug.step(total - settle - 1, dt);
        const scene = app.debug.scene();
        const counters = { ...app.debug.counters() };
        const state = JSON.parse(JSON.stringify(scene.state)) as Record<string, number | number[]>;
        const ys = Object.fromEntries(scene.entities.map((entity) => [entity.name, entity.position.y]));
        app.dispose();
        return { reported, state, counters, ys };
      },
      { target: TARGET, dt: STEP, settle: SETTLE_TICKS, total: TOTAL_TICKS },
    );
    expect(run.reported, "no runtime diagnostics").toEqual([]);
    expect(run.counters).toMatchObject({ physicsSteps: TOTAL_TICKS, physicsBodies: 7, physicsColliders: 7, physicsFrozenBodies: 0 });

    // The derived crossings, in delivery order (tick, enter before exit, then the ball's slot).
    const expected = FLIGHTS.flatMap(crossings).sort((p, q) => p.tick - q.tick || (p.kind === q.kind ? p.who - q.who : p.kind === "enter" ? -1 : 1));
    const counts = (kind: "enter" | "exit"): number[] => FLIGHTS.map((flight) => expected.filter((event) => event.who === flight.who && event.kind === kind).length);
    // The numbers the fixture's comment states: A 1/1, B 2/2, C 1/1, D 1/0.
    expect(counts("enter")).toEqual([1, 2, 1, 1]);
    expect(counts("exit")).toEqual([1, 2, 1, 0]);

    // The counts: exactly these, at the zone and at the balls (each pair is delivered once to each side).
    expect(run.state["zone_enter"]).toEqual(counts("enter"));
    expect(run.state["zone_exit"]).toEqual(counts("exit"));
    expect(run.state["ball_enter"]).toEqual(counts("enter"));
    expect(run.state["ball_exit"]).toEqual(counts("exit"));
    // Nothing else touched the zone: the ledge is inside it, but two static bodies never make a pair.
    expect(run.state["strangers"]).toBe(0);

    // The deliveries at the zone happened in the derived order, each within one tick of the derived tick.
    const logLen = run.state["log_len"] as number;
    expect(logLen).toBe(expected.length);
    const who = (run.state["log_who"] as number[]).slice(0, logLen);
    const ticks = (run.state["log_tick"] as number[]).slice(0, logLen);
    expect(who).toEqual(expected.map((event) => event.who * 10 + (event.kind === "enter" ? 1 : 2)));
    ticks.forEach((tick, index) => {
      const want = expected[index]?.tick ?? Number.NaN;
      expect(Math.abs(tick - want), `delivery ${String(index)} (${String(who[index])}) at tick ${String(tick)}, derived ${String(want)}`).toBeLessThanOrEqual(1);
    });

    // Where the balls ended: the three on the floor, D on the ledge inside the zone (rest height within 10 mm).
    for (const flight of FLIGHTS) {
      const name = ["A", "B", "C", "D"][flight.who - 1] ?? "?";
      expect(Math.abs((run.ys[name] ?? Number.NaN) - flight.stopsAt), `${name} rests at ${String(flight.stopsAt)}`).toBeLessThan(0.01);
    }

    testInfo.annotations.push({
      type: "m5-sensor",
      description: `g=${String(GRAVITY)} step=${String(STEP)}; log (who*10+1 enter, +2 exit) ${JSON.stringify(who)} at ticks ${JSON.stringify(ticks)}; derived ticks ${JSON.stringify(expected.map((event) => event.tick))}`,
    });
  });
});
