// Correct alternative solutions of the Mtek side: different from the references in structure, equal in
// behaviour. Each must pass the task's fixtures (they must not over-constrain the way a task is solved).

export default [
  {
    task: "interaction-02",
    name: "alt-imperative",
    what: "the Handle's position is written by the handlers; only the colour is bound",
    whole: `const YELLOW: color = #ffd24a;
const RED: color = #ef4444;

scene Demo {
    clear_color: #202020;
    state slot: f32 = 0.0;

    camera Main {
        position: vec3(0.0, 0.0, 10.0);
        target: vec3(0.0, 0.0, 0.0);
        projection: Orthographic { height: 12.8 };
    }

    entity Track {
        position: vec3(0.0, -1.0, 0.0);
        mesh: Box { size: vec3(10.0, 0.2, 0.2) };
        material: Unlit { color: #404040 };
    }

    entity Handle {
        position: vec3(0.0, 0.0, 0.0);
        mesh: Box { size: vec3(0.8, 0.8, 0.5) };
        material: Unlit { color: bind(color.linear(mix(YELLOW.rgb, RED.rgb, step(4.0, abs(slot))), 1.0)) };
    }

    on key_down(Key.ArrowRight) {
        if slot < 4.0 {
            slot += 1.0;
            Handle.position.x = slot;
        }
    }

    on key_down(Key.ArrowLeft) {
        if slot > -4.0 {
            slot -= 1.0;
            Handle.position.x = slot;
        }
    }

    on key_down(Key.Enter) {
        slot = 0.0;
        Handle.position = vec3(0.0, 0.0, 0.0);
    }
}
`,
  },
  {
    task: "interaction-03",
    name: "alt-bool-states",
    what: "bool states and a pure function from state to colour",
    whole: `fn lamp_color(on: bool) -> color {
    if on {
        return #ffd24a;
    }
    return #3a3a3a;
}

scene Demo {
    clear_color: #202020;
    state a_on: bool = false;
    state b_on: bool = false;

    camera Main {
        position: vec3(0.0, 0.0, 10.0);
        target: vec3(0.0, 0.0, 0.0);
        projection: Orthographic { height: 12.8 };
    }

    entity LampA {
        position: vec3(-3.0, 0.0, 0.0);
        mesh: Box { size: vec3(2.0, 2.0, 0.5) };
        material: Unlit { color: bind(lamp_color(a_on)) };
    }

    entity LampB {
        position: vec3(3.0, 0.0, 0.0);
        mesh: Box { size: vec3(2.0, 2.0, 0.5) };
        material: Unlit { color: bind(lamp_color(b_on)) };
    }

    on key_down(Key.A) {
        a_on = !a_on;
    }

    on key_down(Key.B) {
        b_on = !b_on;
    }

    on key_down(Key.Space) {
        a_on = !a_on;
        b_on = !b_on;
    }

    on key_down(Key.Enter) {
        a_on = false;
        b_on = false;
    }
}
`,
  },
  {
    task: "interaction-04",
    name: "alt-frame-time",
    what: "the run is timed with frame.time at the press instead of summing dt",
    whole: `const RUN_SECONDS: f32 = 1.5;

fn phase_color(phase: i32) -> color {
    if phase == 1 {
        return #ffb000;
    }
    if phase == 2 {
        return #22c55e;
    }
    return #3a3a3a;
}

scene Demo {
    clear_color: #202020;
    state phase: i32 = 0;
    state started: f32 = 0.0;

    camera Main {
        position: vec3(0.0, 0.0, 10.0);
        target: vec3(0.0, 0.0, 0.0);
        projection: Orthographic { height: 12.8 };
    }

    entity Beacon {
        mesh: Box { size: vec3(4.0, 4.0, 0.5) };
        material: Unlit { color: bind(phase_color(phase)) };
    }

    on key_down(Key.Space) {
        if phase == 0 {
            phase = 1;
            started = frame.time;
        } else if phase == 2 {
            phase = 0;
        }
    }

    update(dt: f32) {
        if phase == 1 && frame.time - started >= RUN_SECONDS {
            phase = 2;
        }
    }
}
`,
  },
  {
    task: "interaction-05",
    name: "alt-update-writes",
    what: "the Marker's position is written every frame in update instead of being bound",
    whole: `const LIMIT: f32 = 4.5;

scene Demo {
    clear_color: #202020;
    state cursor: vec2 = vec2(0.0, 0.0);

    camera Main {
        position: vec3(0.0, 0.0, 10.0);
        target: vec3(0.0, 0.0, 0.0);
        projection: Orthographic { height: 12.8 };
    }

    entity Panel {
        position: vec3(0.0, 0.0, -1.0);
        mesh: Box { size: vec3(10.0, 10.0, 0.1) };
        material: Unlit { color: #2a2a2a };
    }

    entity Marker {
        mesh: Box { size: vec3(1.0, 1.0, 0.5) };
        material: Unlit { color: #38bdf8 };
    }

    update(dt: f32) {
        Marker.position = vec3(clamp(cursor.x, -LIMIT, LIMIT), clamp(cursor.y, -LIMIT, LIMIT), 0.0);
    }

    on key_down(Key.Space) {
        cursor = vec2(0.0, 0.0);
    }
}
`,
  },
  {
    task: "interaction-06",
    name: "alt-clamp-after",
    what: "the cap is applied by an if after each operation",
    whole: `scene Demo {
    clear_color: #202020;
    state value: i32 = 1;

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

    on key_down(Key.D) {
        value = value * 2;
        if value > 8 {
            value = 8;
        }
    }

    on key_down(Key.P) {
        value += 3;
        if value > 8 {
            value = 8;
        }
    }

    on key_down(Key.R) {
        value = 1;
    }
}
`,
  },
  {
    task: "interaction-08",
    name: "alt-state-bound",
    what: "the Runner's x is scene state, bound to the position",
    whole: `scene Demo {
    clear_color: #202020;
    state moving: bool = false;
    state x: f32 = -5.0;

    camera Main {
        position: vec3(0.0, 0.0, 10.0);
        target: vec3(0.0, 0.0, 0.0);
        projection: Orthographic { height: 12.8 };
    }

    entity Track {
        position: vec3(0.0, -1.0, 0.0);
        mesh: Box { size: vec3(12.0, 0.2, 0.2) };
        material: Unlit { color: #404040 };
    }

    entity Runner {
        position: bind(vec3(x, 0.0, 0.0));
        mesh: Box { size: vec3(1.0, 1.0, 0.5) };
        material: Unlit { color: #f97316 };
    }

    update(dt: f32) {
        if moving {
            x += 4.0 * dt;
            if x >= 6.0 {
                x -= 12.0;
            }
        }
    }

    on key_down(Key.Space) {
        moving = !moving;
    }
}
`,
  },
];
