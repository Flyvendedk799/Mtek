// Mutants of the Mtek references of interaction-09 .. interaction-11 (decision 0088): the reference with one plausible
// mistake each. `edits` are exact substring replacements of reference/mtek/src/main.mtek (the first occurrence of
// each, in order); `whole` replaces the file. Every mutant must FAIL the task's fixtures.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const reference = (task) => readFileSync(join(REPO, "benchmarks", "tasks", task, "reference", "mtek", "src", "main.mtek"), "utf8");

/** The reference up to `marker`, then `replacement` (which must close what the marker opened). */
function upTo(task, marker, replacement, edits = []) {
  let text = reference(task);
  const index = text.indexOf(marker);
  if (index < 0) throw new Error(`${task}: '${marker}' is not in the reference`);
  text = text.slice(0, index) + replacement;
  for (const [from, to] of edits) {
    if (!text.includes(from)) throw new Error(`${task}: '${from}' is not in the text`);
    text = text.replace(from, to);
  }
  return text;
}

const LAUNCH = "Stone.position = vec3(min(Stone.position.x + 2.0 * f32(power), RIGHT_LIMIT), 0.0, 0.0);";

// ---- interaction-09: a spring-loaded launcher (key release) ----
const t09 = "interaction-09";
const pollingLauncher = upTo(
  t09,
  "    on key_down(Key.Space) {",
  `    update(dt: f32) {
        let space = is_key_down(Key.Space);
        let up = is_key_down(Key.ArrowUp);
        if space && !was_space {
            pulled = true;
        }
        if up && !was_up && pulled {
            power = min(power + 1, MAX_POWER);
        }
        if !space && was_space {
            pulled = false;
            ${LAUNCH}
            power = 0;
        }
        was_space = space;
        was_up = up;
    }
}
`,
  [["    state pulled: bool = false;", "    state pulled: bool = false;\n    state was_space: bool = false;\n    state was_up: bool = false;"]],
);

// ---- interaction-10: held keys ----
const t10 = "interaction-10";
const ship10 = "        update(dt: f32) {";
const stickyShip = upTo(
  t10,
  ship10,
  `        update(dt: f32) {
            self.position = vec3(
                clamp(self.position.x + dir_x * SPEED * dt, -LIMIT, LIMIT),
                clamp(self.position.y + dir_y * SPEED * dt, -LIMIT, LIMIT),
                0.0,
            );
        }
    }

    on key_down(Key.ArrowRight) {
        dir_x = 1.0;
    }

    on key_down(Key.ArrowLeft) {
        dir_x = -1.0;
    }

    on key_down(Key.ArrowUp) {
        dir_y = 1.0;
    }

    on key_down(Key.ArrowDown) {
        dir_y = -1.0;
    }
}
`,
  [["    clear_color: #202020;", "    clear_color: #202020;\n    state dir_x: f32 = 0.0;\n    state dir_y: f32 = 0.0;"]],
);
const perPressShip = upTo(
  t10,
  ship10,
  `    }

    on key_down(Key.ArrowRight) {
        Ship.position = vec3(min(Ship.position.x + 0.5, LIMIT), Ship.position.y, 0.0);
    }

    on key_down(Key.ArrowLeft) {
        Ship.position = vec3(max(Ship.position.x - 0.5, -LIMIT), Ship.position.y, 0.0);
    }

    on key_down(Key.ArrowUp) {
        Ship.position = vec3(Ship.position.x, min(Ship.position.y + 0.5, LIMIT), 0.0);
    }

    on key_down(Key.ArrowDown) {
        Ship.position = vec3(Ship.position.x, max(Ship.position.y - 0.5, -LIMIT), 0.0);
    }
}
`,
);

// ---- interaction-11: two clocks ----
const t11 = "interaction-11";
const NO_FIXED = ["    fixed_update(dt: f32) {\n        ticks += 1;\n    }\n\n", ""];
const ownClock = (body) => ({
  task: t11,
  whole: upTo(t11, "    fixed_update(dt: f32) {", `    update(dt: f32) {\n        glide += 6.0 * dt;\n${body}    }\n}\n`, [
    ["    state glide: f32 = 0.0;", "    state glide: f32 = 0.0;\n    state acc: f32 = 0.0;"],
  ]),
});

export default [
  // 09
  {
    task: t09,
    name: "launch-on-press",
    what: "the Stone is launched when Space is pressed (nothing happens on release)",
    edits: [
      ["    on key_down(Key.Space) {\n        pulled = true;\n    }", `    on key_down(Key.Space) {\n        pulled = true;\n        ${LAUNCH}\n        power = 0;\n    }`],
      [`        pulled = false;\n        ${LAUNCH}\n        power = 0;\n`, "        pulled = false;\n"],
    ],
  },
  { task: t09, name: "no-right-limit", what: "a launch is not cut off at x = 5", edits: [["min(Stone.position.x + 2.0 * f32(power), RIGHT_LIMIT)", "Stone.position.x + 2.0 * f32(power)"]] },
  {
    task: t09,
    name: "up-counts-without-space",
    what: "Up adds power also while Space is not held",
    edits: [["        if pulled {\n            power = min(power + 1, MAX_POWER);\n        }", "        power = min(power + 1, MAX_POWER);"]],
  },
  { task: t09, name: "power-not-reset", what: "power stays after a launch", edits: [[`${LAUNCH}\n        power = 0;`, LAUNCH]] },
  { task: t09, name: "release-ignored-for-state", what: "the held state is never cleared by the release (colour and Up stay as if held)", edits: [["        pulled = false;\n        Stone.position", "        Stone.position"]] },
  { task: t09, name: "cap-six", what: "power is capped at 6 instead of 5", edits: [["const MAX_POWER: i32 = 5;", "const MAX_POWER: i32 = 6;"]] },
  { task: t09, name: "one-unit-per-point", what: "a launch moves 1 unit per point of power instead of 2", edits: [["2.0 * f32(power)", "f32(power)"]] },
  {
    task: t09,
    name: "up-release-also-launches",
    what: "the release of Up launches as well",
    edits: [["    on key_up(Key.Space) {", `    on key_up(Key.ArrowUp) {\n        ${LAUNCH}\n        power = 0;\n    }\n\n    on key_up(Key.Space) {`]],
  },
  { task: t09, name: "is-key-down-in-the-up-handler", what: "the Up handler asks is_key_down(Space) instead of the tracked state", edits: [["        if pulled {", "        if is_key_down(Key.Space) {"]] },
  { task: t09, name: "polling-edges-in-update", what: "key events are not handled; Space and Up are polled in update and compared with the previous frame", whole: pollingLauncher },
  // 10
  { task: t10, name: "move-once-per-press", what: "each press moves the Ship 0.5 unit; nothing happens while held", whole: perPressShip },
  {
    task: t10,
    name: "half-a-unit-per-frame",
    what: "the Ship moves 0.5 per frame instead of 8 times the frame duration",
    edits: [["SPEED * dt", "0.5"], ["SPEED * dt", "0.5"], ["SPEED * dt", "0.5"], ["SPEED * dt", "0.5"]],
  },
  {
    task: t10,
    name: "no-clamp",
    what: "the Ship is not limited to the Field",
    edits: [["clamp(self.position.x + dx, -LIMIT, LIMIT)", "self.position.x + dx"], ["clamp(self.position.y + dy, -LIMIT, LIMIT)", "self.position.y + dy"]],
  },
  { task: t10, name: "limit-five", what: "the limit is 5 instead of 4", edits: [["const LIMIT: f32 = 4.0;", "const LIMIT: f32 = 5.0;"]] },
  {
    task: t10,
    name: "right-and-up-win",
    what: "opposite keys do not cancel: Right wins over Left and Up over Down (else-if chains)",
    edits: [
      ["            }\n            if is_key_down(Key.ArrowLeft) {", "            } else if is_key_down(Key.ArrowLeft) {"],
      ["            }\n            if is_key_down(Key.ArrowDown) {", "            } else if is_key_down(Key.ArrowDown) {"],
    ],
  },
  {
    task: t10,
    name: "no-diagonal",
    what: "only one axis moves at a time (vertical keys are ignored while a horizontal key is held)",
    edits: [["            if is_key_down(Key.ArrowUp) {", "            if dx == 0.0 && is_key_down(Key.ArrowUp) {"], ["            if is_key_down(Key.ArrowDown) {", "            if dx == 0.0 && is_key_down(Key.ArrowDown) {"]],
  },
  { task: t10, name: "release-ignored", what: "the direction is set by the press and never cleared by the release", whole: stickyShip },
  { task: t10, name: "moves-in-fixed-update", what: "the movement is in fixed_update (once per tick, not per frame)", edits: [["        update(dt: f32) {", "        fixed_update(dt: f32) {"]] },
  {
    task: t10,
    name: "previous-frame-state",
    what: "movement uses the key state of the previous frame (the press frame is skipped, the release frame counts)",
    edits: [
      ["    clear_color: #202020;", "    clear_color: #202020;\n    state pr: bool = false;\n    state pl: bool = false;\n    state pu: bool = false;\n    state pd: bool = false;"],
      ["if is_key_down(Key.ArrowRight) {", "if pr {"],
      ["if is_key_down(Key.ArrowLeft) {", "if pl {"],
      ["if is_key_down(Key.ArrowUp) {", "if pu {"],
      ["if is_key_down(Key.ArrowDown) {", "if pd {"],
      [
        "                0.0,\n            );\n",
        "                0.0,\n            );\n            pr = is_key_down(Key.ArrowRight);\n            pl = is_key_down(Key.ArrowLeft);\n            pu = is_key_down(Key.ArrowUp);\n            pd = is_key_down(Key.ArrowDown);\n",
      ],
    ],
  },
  {
    task: t10,
    name: "press-also-moves",
    what: "polling is right, but a press of Down also moves the Ship one extra step",
    edits: [["        }\n    }\n}\n", "        }\n    }\n\n    on key_down(Key.ArrowDown) {\n        Ship.position = vec3(Ship.position.x, max(Ship.position.y - 0.5, -LIMIT), 0.0);\n    }\n}\n"]],
  },
  // 11
  {
    task: t11,
    name: "one-tick-per-frame",
    what: "the Ticker moves once per frame (update), not once per fixed tick",
    edits: [NO_FIXED, ["        glide += 6.0 * dt;", "        glide += 6.0 * dt;\n        ticks += 1;"]],
  },
  {
    task: t11,
    name: "whole-steps-of-this-frame-only",
    what: "ticks = whole steps in the frame's own duration; the leftover is not carried",
    edits: [NO_FIXED, ["        glide += 6.0 * dt;", "        glide += 6.0 * dt;\n        ticks += i32(floor(dt * 60.0));"]],
  },
  {
    task: t11,
    name: "rounded-steps-per-frame",
    what: "ticks = the frame duration in steps, rounded",
    edits: [NO_FIXED, ["        glide += 6.0 * dt;", "        glide += 6.0 * dt;\n        ticks += i32(round(dt * 60.0));"]],
  },
  {
    ...ownClock(
      "        acc += dt;\n        let whole = floor(acc / 0.016666668);\n        ticks += i32(whole);\n        acc = acc - whole * 0.016666668;\n",
    ),
    name: "own-clock-no-cap",
    what: "an own accumulator in update that runs every whole step (no limit of 4 per frame)",
  },
  {
    ...ownClock(
      "        acc += dt;\n        let whole = floor(acc / 0.016666668);\n        ticks += i32(min(whole, 4.0));\n        if whole > 4.0 {\n            acc = 0.0;\n        } else {\n            acc = acc - whole * 0.016666668;\n        }\n",
    ),
    name: "own-clock-drops-the-fraction-too",
    what: "an own accumulator with the cap of 4 that empties the whole accumulator when it drops steps",
  },
  {
    ...ownClock(
      "        acc += dt;\n        let whole = floor(acc / 0.016666668);\n        let run = min(whole, 4.0);\n        ticks += i32(run);\n        acc = acc - run * 0.016666668;\n",
    ),
    name: "own-clock-keeps-the-backlog",
    what: "an own accumulator with the cap of 4 that keeps the steps it did not run for later frames",
  },
  {
    task: t11,
    name: "glider-moves-per-tick",
    what: "the Glider is moved in fixed_update, 0.1 unit per tick, instead of by the frame duration",
    edits: [["        ticks += 1;", "        ticks += 1;\n        glide += 0.1;"], ["        glide += 6.0 * dt;", ""]],
  },
  { task: t11, name: "glider-moves-per-frame", what: "the Glider moves 0.1 unit per frame instead of 6 times the frame duration", edits: [["glide += 6.0 * dt;", "glide += 0.1;"]] },
  {
    task: t11,
    name: "ticks-from-program-time",
    what: "the Ticker follows program time (floor(frame.time * 60)) instead of counting ticks",
    edits: [NO_FIXED, ["        glide += 6.0 * dt;", "        glide += 6.0 * dt;\n        ticks = i32(floor(frame.time * 60.0));"]],
  },
];
