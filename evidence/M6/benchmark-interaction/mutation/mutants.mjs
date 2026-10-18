// Mutants of the Mtek references: the reference with one plausible mistake each. `edits` are exact
// substring replacements of reference/mtek/src/main.mtek; `whole` replaces the file.

const lampsPolling = `const ON: color = #ffd24a;
const OFF: color = #3a3a3a;

scene Demo {
    clear_color: #202020;
    state lamp_a: f32 = 0.0;
    state lamp_b: f32 = 0.0;

    camera Main {
        position: vec3(0.0, 0.0, 10.0);
        target: vec3(0.0, 0.0, 0.0);
        projection: Orthographic { height: 12.8 };
    }

    entity LampA {
        position: vec3(-3.0, 0.0, 0.0);
        mesh: Box { size: vec3(2.0, 2.0, 0.5) };
        material: Unlit { color: bind(color.linear(mix(OFF.rgb, ON.rgb, lamp_a), 1.0)) };
    }

    entity LampB {
        position: vec3(3.0, 0.0, 0.0);
        mesh: Box { size: vec3(2.0, 2.0, 0.5) };
        material: Unlit { color: bind(color.linear(mix(OFF.rgb, ON.rgb, lamp_b), 1.0)) };
    }

    state held_a: bool = false;
    state held_b: bool = false;
    state held_space: bool = false;
    state held_enter: bool = false;

    update(dt: f32) {
        let a = is_key_down(Key.A);
        let b = is_key_down(Key.B);
        let s = is_key_down(Key.Space);
        let e = is_key_down(Key.Enter);
        if a && !held_a { lamp_a = 1.0 - lamp_a; }
        if b && !held_b { lamp_b = 1.0 - lamp_b; }
        if s && !held_space { lamp_a = 1.0 - lamp_a; lamp_b = 1.0 - lamp_b; }
        if e && !held_enter { lamp_a = 0.0; lamp_b = 0.0; }
        held_a = a;
        held_b = b;
        held_space = s;
        held_enter = e;
    }
}
`;

const barPolling = `const MAX_VALUE: i32 = 8;

scene Demo {
    clear_color: #202020;
    state value: i32 = 1;
    state held_d: bool = false;
    state held_p: bool = false;
    state held_r: bool = false;

    camera Main {
        position: vec3(0.0, 0.0, 10.0);
        target: vec3(0.0, 0.0, 0.0);
        projection: Orthographic { height: 12.8 };
    }

    entity Bar {
        position: bind(vec3(-6.0 + f32(value) * 0.5, 0.0, 0.0));
        scale: bind(vec3(f32(value), 1.0, 1.0));
        mesh: Box { size: vec3(1.0, 1.0, 0.5) };
        material: Unlit { color: #ffd24a };
    }

    update(dt: f32) {
        let d = is_key_down(Key.D);
        let p = is_key_down(Key.P);
        let r = is_key_down(Key.R);
        if d && !held_d { value = min(value * 2, MAX_VALUE); }
        if p && !held_p { value = min(value + 3, MAX_VALUE); }
        if r && !held_r { value = 1; }
        held_d = d;
        held_p = p;
        held_r = r;
    }
}
`;

export default [
  { task: "interaction-02", name: "no-clamp", what: "arrow keys without the range limit", edits: [["slot = min(slot + 1.0, 4.0);", "slot = slot + 1.0;"], ["slot = max(slot - 1.0, -4.0);", "slot = slot - 1.0;"]] },
  { task: "interaction-02", name: "limit-five", what: "range limit 5 instead of 4", edits: [["min(slot + 1.0, 4.0)", "min(slot + 1.0, 5.0)"], ["max(slot - 1.0, -4.0)", "max(slot - 1.0, -5.0)"]] },
  { task: "interaction-02", name: "red-only-right", what: "red only at the right end", edits: [["step(4.0, abs(slot))", "step(4.0, slot)"]] },
  { task: "interaction-02", name: "enter-does-not-centre", what: "Enter goes to x = 1 instead of the centre", edits: [["        slot = 0.0;", "        slot = 1.0;"]] },
  { task: "interaction-03", name: "space-copies-state", what: "Space flips A and gives B the same state (instead of flipping B)", edits: [["lamp_a = 1.0 - lamp_a;\n        lamp_b = 1.0 - lamp_b;", "lamp_a = 1.0 - lamp_a;\n        lamp_b = lamp_a;"]] },
  { task: "interaction-03", name: "enter-toggles", what: "Enter flips the lamps instead of switching them off", edits: [["lamp_a = 0.0;\n        lamp_b = 0.0;", "lamp_a = 1.0 - lamp_a;\n        lamp_b = 1.0 - lamp_b;"]] },
  { task: "interaction-03", name: "polling-fixed-order", what: "key edges polled in update, applied in a fixed key order instead of arrival order", whole: lampsPolling },
  { task: "interaction-04", name: "restart-while-running", what: "Space while running restarts the run", edits: [["if phase == 0 {", "if phase == 0 || phase == 1 {"]] },
  { task: "interaction-04", name: "stale-timer", what: "a new run does not reset the elapsed time", edits: [["            elapsed = 0.0;\n", ""]] },
  { task: "interaction-04", name: "one-second", what: "run of 1.0 s instead of 1.5 s", edits: [["const RUN_SECONDS: f32 = 1.5;", "const RUN_SECONDS: f32 = 1.0;"]] },
  { task: "interaction-04", name: "two-seconds", what: "run of 2.0 s instead of 1.5 s", edits: [["const RUN_SECONDS: f32 = 1.5;", "const RUN_SECONDS: f32 = 2.0;"]] },
  { task: "interaction-04", name: "done-stays-done", what: "Space while done does not return to idle", edits: [["} else if phase == 2 {\n            phase = 0;", "} else if phase == 2 {\n            phase = 2;"]] },
  { task: "interaction-05", name: "limit-five", what: "limit 5 instead of 4.5", edits: [["const LIMIT: f32 = 4.5;", "const LIMIT: f32 = 5.0;"]] },
  { task: "interaction-05", name: "y-unclamped", what: "only x is limited", edits: [["clamp(cursor.y, -LIMIT, LIMIT)", "cursor.y"]] },
  { task: "interaction-05", name: "space-does-nothing", what: "Space does not recentre", edits: [["cursor = vec2(0.0, 0.0);\n    }", "cursor = cursor;\n    }"]] },
  { task: "interaction-06", name: "no-cap", what: "no cap at 8", edits: [["min(value * 2, MAX_VALUE)", "value * 2"], ["min(value + 3, MAX_VALUE)", "value + 3"]] },
  { task: "interaction-06", name: "adds-two", what: "P adds 2 instead of 3", edits: [["value + 3", "value + 2"]] },
  { task: "interaction-06", name: "polling-fixed-order", what: "key edges polled in update, applied in a fixed key order instead of arrival order", whole: barPolling },
  { task: "interaction-06", name: "r-does-not-reset", what: "R leaves the value alone", edits: [["        value = 1;", "        value = value;"]] },
  { task: "interaction-07", name: "no-cap", what: "a sixth Pip is added", edits: [["if count < SLOTS {", "if count < 6 {"]] },
  { task: "interaction-07", name: "enter-removes-one", what: "Enter removes one Pip but forgets the count", edits: [["for i in 0..count {", "for i in 0..1 {"]] },
  { task: "interaction-07", name: "off-by-one-place", what: "the n-th Pip is placed at -6 + 2(n-1)", edits: [["-6.0 + 2.0 * f32(count + 1)", "-6.0 + 2.0 * f32(count)"]] },
  { task: "interaction-07", name: "count-not-decremented", what: "Backspace destroys the Pip but keeps the count", edits: [["count -= 1;", "count -= 0;"]] },
  { task: "interaction-08", name: "no-wrap", what: "no wrap-around", edits: [["x -= LAP;", "x -= 0.0;"]] },
  { task: "interaction-08", name: "frame-dependent-step", what: "4/60 per frame instead of 4 per second of frame time", edits: [["SPEED * dt", "SPEED / 60.0"]] },
  { task: "interaction-08", name: "never-stops", what: "Space only starts the Runner", edits: [["moving = !moving;", "moving = true;"]] },
  { task: "interaction-08", name: "wraps-at-five", what: "wraps at x = 5 instead of 6", edits: [["const RIGHT_END: f32 = 6.0;", "const RIGHT_END: f32 = 5.0;"]] },
  { task: "interaction-08", name: "stop-resets-position", what: "stopping sends the Runner back to the start", edits: [["moving = !moving;", "moving = !moving;\n        if !moving {\n            Runner.position.x = -5.0;\n        }"]] },
];
