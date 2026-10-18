// Alternate CORRECT solutions of interaction-09 .. interaction-11 in Mtek (decision 0088): a different way to meet the
// same prompt. Every alternate must PASS the task's fixtures, else the fixtures over-constrain the solution.

const scene = (head, body) => `${head}
    camera Main {
        position: vec3(0.0, 0.0, 10.0);
        target: vec3(0.0, 0.0, 0.0);
        projection: Orthographic { height: 12.8 };
    }
${body}`;

export default [
  {
    task: "interaction-09",
    name: "alt-stone-x-as-state",
    what: "the Stone's x is scene state that the position binds to; the colour is a mix of a 0/1 state; the cap is an if",
    whole: `const YELLOW: color = #ffd24a;

const ORANGE: color = #ff7a1a;

${scene(
  `scene Demo {
    clear_color: #202020;
    state power: i32 = 0;
    state pulled: f32 = 0.0;
    state stone_x: f32 = -4.0;
`,
  `
    entity Rail {
        position: vec3(0.0, -1.1, 0.0);
        mesh: Box { size: vec3(12.0, 0.2, 0.2) };
        material: Unlit { color: #404040 };
    }

    entity Stone {
        position: bind(vec3(stone_x, 0.0, 0.0));
        mesh: Box { size: vec3(2.0, 2.0, 0.5) };
        material: Unlit { color: bind(color.linear(mix(YELLOW.rgb, ORANGE.rgb, pulled), 1.0)) };
    }

    entity Power {
        position: bind(vec3(-5.5 + f32(power), 3.5, 0.0));
        mesh: Box { size: vec3(1.0, 1.0, 0.5) };
        material: Unlit { color: #38bdf8 };
    }

    on key_down(Key.Space) {
        pulled = 1.0;
    }

    on key_down(Key.ArrowUp) {
        if pulled > 0.5 && power < 5 {
            power += 1;
        }
    }

    on key_up(Key.Space) {
        pulled = 0.0;
        stone_x += 2.0 * f32(power);
        if stone_x > 5.0 {
            stone_x = 5.0;
        }
        power = 0;
    }
}
`,
)}`,
  },
  {
    task: "interaction-10",
    name: "alt-held-flags-from-events",
    what: "the held state is tracked from key_down and key_up handlers (flags) and the motion is bound scene state written in update",
    whole: `const SPEED: f32 = 8.0;

${scene(
  `scene Demo {
    clear_color: #202020;
    state x: f32 = 0.0;
    state y: f32 = 0.0;
    state right: bool = false;
    state left: bool = false;
    state up: bool = false;
    state down: bool = false;
`,
  `
    entity Field {
        position: vec3(0.0, 0.0, -1.0);
        mesh: Box { size: vec3(10.0, 10.0, 0.2) };
        material: Unlit { color: #303030 };
    }

    entity Ship {
        position: bind(vec3(x, y, 0.0));
        mesh: Box { size: vec3(2.0, 2.0, 0.5) };
        material: Unlit { color: #38bdf8 };
    }

    on key_down(Key.ArrowRight) {
        right = true;
    }

    on key_up(Key.ArrowRight) {
        right = false;
    }

    on key_down(Key.ArrowLeft) {
        left = true;
    }

    on key_up(Key.ArrowLeft) {
        left = false;
    }

    on key_down(Key.ArrowUp) {
        up = true;
    }

    on key_up(Key.ArrowUp) {
        up = false;
    }

    on key_down(Key.ArrowDown) {
        down = true;
    }

    on key_up(Key.ArrowDown) {
        down = false;
    }

    update(dt: f32) {
        if right {
            x += SPEED * dt;
        }
        if left {
            x -= SPEED * dt;
        }
        if up {
            y += SPEED * dt;
        }
        if down {
            y -= SPEED * dt;
        }
        x = min(max(x, -4.0), 4.0);
        y = min(max(y, -4.0), 4.0);
    }
}
`,
)}`,
  },
  {
    task: "interaction-11",
    name: "alt-own-clock-in-update",
    what: "no fixed_update: an own accumulator in update (cap of 4, whole steps beyond dropped, the fraction kept)",
    whole: `${scene(
      `scene Demo {
    clear_color: #202020;
    state ticks: i32 = 0;
    state glide: f32 = 0.0;
    state acc: f32 = 0.0;
`,
      `
    entity Ticker {
        position: bind(vec3(-5.5 + 0.1 * f32(ticks), 3.0, 0.0));
        mesh: Box { size: vec3(1.0, 1.0, 0.5) };
        material: Unlit { color: #ef4444 };
    }

    entity Glider {
        position: bind(vec3(-5.5 + glide, -3.0, 0.0));
        mesh: Box { size: vec3(1.0, 1.0, 0.5) };
        material: Unlit { color: #38bdf8 };
    }

    update(dt: f32) {
        glide += 6.0 * dt;
        acc += dt;
        let whole = floor(acc / 0.016666668);
        ticks += i32(min(whole, 4.0));
        acc = acc - whole * 0.016666668;
    }
}
`,
    )}`,
  },
  {
    task: "interaction-11",
    name: "alt-positions-written-in-the-handlers",
    what: "fixed_update and update write the entities' positions directly (no state, no bind)",
    whole: `${scene(
      `scene Demo {
    clear_color: #202020;
`,
      `
    entity Ticker {
        position: vec3(-5.5, 3.0, 0.0);
        mesh: Box { size: vec3(1.0, 1.0, 0.5) };
        material: Unlit { color: #ef4444 };

        fixed_update(dt: f32) {
            self.position.x += 0.1;
        }
    }

    entity Glider {
        position: vec3(-5.5, -3.0, 0.0);
        mesh: Box { size: vec3(1.0, 1.0, 0.5) };
        material: Unlit { color: #38bdf8 };

        update(dt: f32) {
            self.position.x += 6.0 * dt;
        }
    }
}
`,
    )}`,
  },
];
