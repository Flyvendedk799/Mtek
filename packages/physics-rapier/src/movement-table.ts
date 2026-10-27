/**
 * Renders the operating-ranges document (`movement-ranges.ts`) as the Markdown tables of `spec/physics.md` section 7.2.
 * Pure: the same document gives the same text, so `ranges:check` can compare it with the committed section.
 */
import { SHAPES } from "./movement-harness.ts";
import { MIN_WIDTHS, STAIR_STEP_HEIGHTS, STAIR_TREADS, cleanRiser, topRiser } from "./movement-ranges.ts";
import type { RangesDoc } from "./movement-ranges.ts";

export const TABLE_BEGIN = "<!-- movement-ranges:begin -->";
export const TABLE_END = "<!-- movement-ranges:end -->";

type Obj = { [key: string]: unknown };
const at = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((value, key) => (value as Obj)[key], o);
const num = (o: unknown, ...path: string[]): number => at(o, ...path) as number;
const str = (o: unknown, ...path: string[]): string => at(o, ...path) as string;
const fixed = (x: number): string => x.toFixed(2);

function table(header: string[], rows: string[][]): string[] {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`), ""];
}

const mm = (metres: number): string => `${(metres * 1000).toFixed(metres * 1000 < 10 ? 1 : 0)} mm`;

/** The text between the markers (exclusive). */
export function renderTable(doc: RangesDoc): string {
  const out: string[] = [];
  const stairs = doc["stairs"];
  const slopes = at(doc, "slopes", "byShape");
  const obstacles = doc["obstacles"];
  const platforms = doc["platforms"];
  const variable = at(doc, "variableStep", "byShape");

  out.push(
    `Generated from \`evidence/movement/operating-ranges.json\` (adapter ${str(doc, "adapter")}, decision 0215) by \`npm run ranges -w @mtek/physics-rapier\`; do not edit by hand. Fixed step 1/60 s unless stated; options are the decision 0214 defaults (skin 0.01 m, snap 0.2 m, max slope 45 degrees, step height 0.25 m, minimum step width 0.1 m, carry on) unless a row varies them. Characters: capsule (radius 0.3 m, height 1.8 m), sphere (radius 0.5 m), box (0.6 x 1.8 x 0.6 m).`,
    "",
  );

  out.push("**Stairs, ascending.** Six steps, walking 2 m/s. Each cell lists risers 0.05 to 0.50 m by 0.05: `C` reaches the landing within 1.3 times the unobstructed time, `S` reaches it more slowly, `-` does not. The last column is the largest riser that climbs cleanly with every smaller riser also clean, and the largest riser that climbs at all.", "");
  const stairRows: string[][] = [];
  for (const shape of SHAPES) {
    for (const h of STAIR_STEP_HEIGHTS) {
      const cells = STAIR_TREADS.map((t) => str(stairs, "climb", shape, `stepHeight ${fixed(h)}`, `tread ${fixed(t)}`));
      const summary = STAIR_TREADS.map((_, i) => `${fixed(cleanRiser(cells[i]!))}/${fixed(topRiser(cells[i]!))}`).join(", ");
      stairRows.push([shape, fixed(h), ...cells.map((c) => `\`${c}\``), summary]);
    }
  }
  out.push(...table(["character", "stepHeight (m)", "tread 0.15 m", "tread 0.30 m", "tread 0.60 m", "clean / any riser per tread (m)"], stairRows));

  out.push("**Stairs, minimum step width** (stepHeight 0.3 m, risers 0.05 to 0.40 m).", "");
  const minRows: string[][] = [];
  for (const shape of SHAPES) {
    for (const t of STAIR_TREADS) {
      minRows.push([shape, fixed(t), ...MIN_WIDTHS.map((w) => `\`${str(stairs, "minWidth", shape, `tread ${fixed(t)}`, `stepMinWidth ${fixed(w)}`)}\``)]);
    }
  }
  out.push(...table(["character", "tread (m)", "stepMinWidth 0.10 m", "stepMinWidth 0.30 m", "stepMinWidth 0.60 m"], minRows));

  out.push("**Stairs, stepping disabled and descending.** `stepHeight` 0 on risers 0.05 to 0.50 m (tread 0.6 m); descending a flight (tread 0.4 m, stepHeight 0.25 m) with `G` grounded on every tick and `a` airborne on some tick, with snap-to-ground 0.2 m and 0.", "");
  out.push(...table(
    ["character", "stepHeight 0, climbed", "descend, snap 0.2 m", "descend, snap 0"],
    SHAPES.map((s) => [s, `\`${str(stairs, "stepHeightZero", s)}\``, `\`${str(stairs, "descend", s, "snap 0.20")}\``, `\`${str(stairs, "descend", s, "snap 0.00")}\``]),
  ));

  out.push("**Slopes.** A ramp rising along the walk; the character walks at 2 m/s for 3.5 s (climb) or is pushed down at 3 m/s for 1 s on it (slide). Angles 5 to 85 degrees by 5; `C` climbs, `S` slides 0.5 m or more downhill. The fine columns are measured on a 0.25 degree grid around the limit.", "");
  const slopeRows: string[][] = [];
  for (const shape of SHAPES) {
    for (const limit of [30, 45, 60]) {
      const e = at(slopes, shape, `maxSlope ${limit}`);
      slopeRows.push([shape, String(limit), `\`${str(e, "climbs")}\``, `\`${str(e, "slides")}\``, `${num(e, "climbsUpToDeg")}`, `${num(e, "slidesFromDeg")}`, `${num(e, "heightRatioTenDegBelow")}`]);
    }
  }
  out.push(...table(["character", "maxSlope (deg)", "climbs (5..85)", "slides (5..85)", "climbs up to (deg)", "slides from (deg)", "height gained / predicted, 10 deg below limit"], slopeRows));
  out.push(...table(
    ["character", "descent grounded, snap 0.2 m (5, 15, 25, 35, 45 deg)", "descent grounded, snap 0", "largest ground-normal error (rad)"],
    SHAPES.map((s) => [s, `\`${str(doc["slopes"], "descent", s, "snap 0.20", "grounded")}\``, `\`${str(doc["slopes"], "descent", s, "snap 0.00", "grounded")}\``, `${num(doc["slopes"], "descent", s, "snap 0.20", "maxNormalErrorRad")}`]),
  ));

  out.push("**Walls and corners.** Walking at 3 m/s for 3 s into a wall whose normal is 0, 15, 45 or 75 degrees off the walking direction; then into an inside corner of 90, 45 and 30 degrees for 8 s (straight and 20 degrees to either side). Penetration is measured against the wall planes with the shape's own extent.", "");
  const wallRows: string[][] = SHAPES.map((s) => {
    const walls = [0, 15, 45, 75].map((i) => at(obstacles, "walls", s, `incidence ${i}`));
    const corners = [90, 45, 30].map((w) => at(obstacles, "corners", s, `wedge ${w}`));
    return [
      s,
      mm(Math.max(...walls.map((w) => num(w, "penetration")), ...corners.map((c) => num(c, "penetration")))),
      walls.map((w) => String(num(w, "slideRatio"))).join(", "),
      corners.map((c) => mm(num(c, "jitter"))).join(", "),
    ];
  });
  out.push(...table(["character", "largest penetration", "slide ratio at 0, 15, 45, 75 deg", "jitter in the last 2 s at 90, 45, 30 deg"], wallRows));

  out.push("**Ceilings, gaps, thin walls and bumps.** Passable thresholds are the smallest margin on a 5 mm grid over the character's height (ceiling) or width (gap). Thin walls are 0.01 m thick; the character is asked for the given distance per tick towards one, head-on and at 45 degrees, from eight phases each (16 runs); a pass is the centre ending beyond the wall. Bumps are 0.3 m deep blocks of 0.05 to 0.35 m (stepHeight 0.25 m) with gravity applied by the program.", "");
  out.push(...table(
    ["character", "ceiling passable from (m over height)", "gap passable from (m over width)", "no thin-wall pass up to (m per tick)", "thin-wall passes at 2, 5, 25, 100 m per tick", "bumps 0.05..0.35 (P passes)"],
    SHAPES.map((s) => [
      s,
      String(num(obstacles, "ceilings", s, "minClearanceOverHeight")),
      String(num(obstacles, "gaps", s, "minGapOverWidth")),
      String(num(obstacles, "thinWalls", s, "noPassUpToMetresPerTick")),
      ["2", "5", "25", "100"].map((d) => str(obstacles, "thinWalls", s, "passes", `${d} m/tick`)).join(", "),
      `\`${str(obstacles, "bumps", "byShape", s)}\``,
    ]),
  ));

  out.push("**Moving platforms** (kinematic 12 x 12 m deck, carry on). The platform moves for 1.5 s and then rests for 1.5 s, so each run measures an abrupt start and an abrupt stop. Drift is the largest distance, in the platform's frame, between where the character stands and where it should stand (0 means exact to 0.1 mm). Horizontal 0.5 to 10 m/s, vertical up and down 0.5 to 5 m/s, yaw 0.1 to 3 rad/s with the character 0 to 4 m from the centre; walking runs add a character walking 1 to 1.5 m/s on the deck (and, for the vertical run, program gravity).", "");
  out.push(...table(
    ["character", "horizontal drift", "vertical drift", "yaw drift", "walking drift", "airborne ticks (all runs)", "carry false: character moved while the platform moved 3 m"],
    SHAPES.map((s) => {
      const p = at(platforms, s);
      return [
        s,
        mm(num(p, "horizontal", "maxDrift")),
        mm(num(p, "vertical", "maxDrift")),
        mm(num(p, "yaw", "maxDrift")),
        mm(num(p, "walking", "maxDrift")),
        String(Math.max(num(p, "horizontal", "airborneTicks"), num(p, "vertical", "airborneTicks"), num(p, "yaw", "airborneTicks"), num(p, "walking", "airborneTicks"))),
        `${num(p, "carryFalse", "characterMetresMoved")} m`,
      ];
    }),
  ));

  out.push("**Variable fixed step.** The same velocity-driven course for 3 s at 1/30, 1/60, 1/120 and 1/144 s (displacement = velocity x step): flat walk at 4 m/s, a six-step flight at 2 m/s (riser 0.15 m, tread 0.3 m), a 25 degree ramp at 2 m/s, a platform at 2 m/s carrying a character walking 1 m/s. The spread is the largest difference between the four final positions.", "");
  const spread = (s: string, course: string): string => {
    const e = at(variable, s, course);
    return mm(Math.max(num(e, "spreadX"), num(e, "spreadY"), num(e, "spreadZ")));
  };
  out.push(...table(["character", "flat", "stairs", "slope", "platform"], SHAPES.map((s) => [s, spread(s, "flat"), spread(s, "stairs"), spread(s, "slope"), spread(s, "platform")])));
  return out.join("\n").trimEnd();
}
