# Time and input

{{generated}}

A Mtek program does not own a loop. The runtime calls your code in a fixed order once per rendered frame, and tells it how much time has passed. This page explains which function runs when, what the duration you receive means, and how keyboard and pointer input reach your handlers.

## Rules

1. **Two clocks.** `update(dt: f32)` runs once per rendered frame. `fixed_update(dt: f32)` runs zero or more times per frame, always with the same `dt` (a fixed step of {{project-default FIXED_STEP}} seconds, one sixtieth), and is where physics runs. Both can be declared in a scene, an entity or a prefab. The parameter takes any name but must be one `f32` (`MTEK-E5050`), and each can be declared once per body (`MTEK-E5051`). No other lifecycle names exist: there is no `start` (`MTEK-E5052`); set initial values in the declarations.
2. **The duration is clamped.** The `dt` of `update` is the time since the previous frame, never more than `max_frame_delta` ({{project-default MAX_FRAME_DELTA}} seconds unless `mtek.toml` says otherwise). After a stall, such as a hidden tab or a slow frame, the program runs slow for a moment instead of jumping. The fixed clock catches up with at most {{project-default MAX_CATCH_UP_STEPS}} steps per frame (`max_catch_up_steps`); the rest of the backlog is dropped.
3. **Frame values.** `frame.delta` is the clamped delta of the current frame (the `dt` of `update`), `frame.time` is the sum of all clamped deltas since the program was mounted, without paused time, and `frame.index` is a frame counter. They are read in handlers and in `bind` expressions. `frame.time` is an `f32` read from a 64-bit sum, so after a few hours of running it moves in steps of a millisecond or more; for long-running effects bind a wrapped value such as `fract(frame.time / 10.0) * 10.0`.
4. **The order of a frame**, which decides what a handler sees:
   1. host inputs and input events, in the order they happened: scene handlers first, then entities in declaration order;
   2. the fixed ticks: queued spawns and removals, queued physics commands, `fixed_update`, the physics step, then collision events;
   3. `update`, scene first, then entities;
   4. spawns and removals queued by `update`;
   5. bindings, in dependency order;
   6. transforms, then the draw.

   A binding therefore sees the state that handlers and `update` left behind in this frame, while a handler that reads a bound field sees the value of the previous frame.
5. **Multiply by `dt`.** Motion per second is `speed * dt` in `update` and in `fixed_update`. Use `fixed_update` for code that talks to the physics engine (forces, velocities, kinematic targets) and `update` for everything else.
6. **Pausing.** A page that is hidden is paused; time and the fixed clock stop, and the first frame after resuming has `dt` of 0, so the paused interval is never simulated. `pause_when_hidden` in `[runtime]` turns that off. Input that happens while paused is discarded.
7. **Key events.** `on key_down(Key.Space)` runs once when the key goes down, and `on key_up(Key.Space)` once when it is released. The operating system's key repeat is ignored. The key in the parentheses is a *filter*: it must be a constant member of `Key` (`MTEK-E5061` for a string, a number or a state). Several handlers for one key run in declaration order. If a key goes down and up within one frame, both are delivered, in that order.
8. **Held keys.** `is_key_down(Key.W)` tells whether the key is down now, as of the start of the frame. It is a CPU-only function: call it in handlers, lifecycle functions and `cpu fn`s. It cannot be called in a `fn` (`MTEK-E4002`) or in a `bind` expression (`MTEK-E5005`).
9. **Key names** are the members of the registry enum `Key`, mapped from the physical key (the DOM `KeyboardEvent.code`, so `Key.W` is the key at the W position of a US keyboard on every layout): {{enum Key}}. There are no lowercase names, no `Key.Up` and no `Key.Shift` (write `Key.ShiftLeft` and `Key.ShiftRight`). A key outside the list is ignored by the runtime.
10. **Pointer events.** `on pointer_down(event: PointerEvent)`, `on pointer_up(...)` and `on pointer_move(...)` receive a `PointerEvent` with `position: vec2` in normalised device coordinates of the canvas (`x` to the right and `y` up, both from -1 to 1) and `button: i32` (0 primary, 1 middle, 2 secondary). Moves are merged to one per frame with the latest position.
11. **Focus.** When the page loses focus, every held key is released at the start of the next frame, so a key never stays stuck.
12. **Shaders cannot read frame values.** A material's `fragment` cannot read `frame.time` (`MTEK-E4040`). Give the material a `param` and bind it: `phase: bind(frame.time)`.

The events of this build:

{{events}}

The settings of `mtek.toml` that change the clocks, shown with the values used in this example (the defaults are the numbers above):

```toml manifest
[project]
name = "demo"
language = "{{language-version}}"

[runtime]
fixed_step = 0.01
max_frame_delta = 0.05
max_catch_up_steps = 2
pause_when_hidden = false
```

## Why

- A fixed step keeps physics and any code that depends on it independent of the display. A 144 Hz screen gets the same simulation as a 60 Hz one, and a test can run it frame by frame.
- Clamping the delta is the same idea seen from the other side. A frame that took two seconds must not move a falling body through a floor, and the bound is a setting, so a program that wants to run slow can say so.
- Events are edges (`key_down`, `key_up`) and polling is a level (`is_key_down`). A handler reacts once to something that happened; a loop that moves a ship while a key is held reads the level. Key repeat would turn edges into a rate set by the operating system, so it is ignored.
- Key names follow the physical key because layouts differ and a game's controls belong to the position of the keys.
- One fixed frame order makes handlers repeatable: the same inputs always produce the same state, whatever the order in which the browser delivered the events.

## Examples

A ship that moves while an arrow key is held, and jumps once per press of the space bar. The motion is read each frame; the jump is an event.

```mtek
scene Demo {
    state jumps: i32 = 0;

    camera Main {
        position: vec3(0.0, 2.0, 8.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Ship {
        mesh: Box {};
        position: vec3(0.0, 0.5, 0.0);

        update(dt: f32) {
            var direction = 0.0;
            if is_key_down(Key.ArrowLeft) {
                direction -= 1.0;
            }
            if is_key_down(Key.ArrowRight) {
                direction += 1.0;
            }
            self.position.x += direction * 4.0 * dt;
        }
    }

    on key_down(Key.Space) {
        jumps += 1;
        Ship.position.y += 1.0;
    }
}
```

Counting fixed ticks and showing the time in a material through a bound parameter:

```mtek
material Clock {
    param time: f32 = 0.0;

    fragment(input: SurfaceInput) -> color {
        return color.linear(vec3(fract(time)), 1.0);
    }
}

scene Demo {
    state ticks: i32 = 0;

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Panel {
        mesh: Box {};
        material: Clock { time: bind(frame.time) };
    }

    fixed_update(dt: f32) {
        ticks += 1;
    }
}
```

Aiming with the pointer: the position arrives in the range -1 to 1.

```mtek
scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Marker {
        mesh: Sphere { radius: 0.1 };
    }

    on pointer_move(event: PointerEvent) {
        Marker.position = vec3(event.position.x * 3.0, event.position.y * 2.0, 0.0);
    }
}
```

## Common mistakes

### A key name that does not exist

```mtek wrong=MTEK-E2003,MTEK-E5061 wrap=scene
on key_down(Key.Up) {
    print("up");
}
```

The built-in enum `Key` has no member `Up` (`MTEK-E2003`), and since the filter is then not a `Key` constant the compiler adds `MTEK-E5061`; the arrows are `Key.ArrowUp`, `Key.ArrowDown`, `Key.ArrowLeft` and `Key.ArrowRight`.

### A key given as text or as a variable

```mtek wrong=MTEK-E5061 wrap=scene
on key_down("w") {
    print("w");
}
```

The filter has to be a constant member of `Key` (`MTEK-E5061`). To bind a key you can change at run time, test `is_key_down` on state in `update` instead.

### An event that does not exist

```mtek wrong=MTEK-E5060 wrap=scene
on key_held(Key.W) {
    print("w");
}
```

There is no `key_held` event (`MTEK-E5060`). A held key is polled with `is_key_down(Key.W)` in `update`.

### Polling the keyboard where only pure code may go

```mtek wrong=MTEK-E5005 wrap=entity
mesh: Box {};
visible: bind(is_key_down(Key.A));
```

A binding is pure (`MTEK-E5005`). Set a `state` from `key_down` and `key_up` handlers, or in `update`, and bind that.

### Reading the clock in a shader

```mtek wrong=MTEK-E4040
material Fade {
    fragment(input: SurfaceInput) -> color {
        return color.linear(vec3(fract(frame.time)), 1.0);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

Stage code cannot capture `frame.time` (`MTEK-E4040`): a material only sees its parameters. Add `param time: f32 = 0.0;` and write `time: bind(frame.time)` in the instance, as the example above does.

### A lifecycle function that is not one

```mtek wrong=MTEK-E5052 wrap=scene
start() {
    print("start");
}
```

Only `update` and `fixed_update` exist (`MTEK-E5052`). Initial values belong in the declarations of `state` and of the fields.

### A time step of the wrong shape

```mtek wrong=MTEK-E5050 wrap=scene
update(dt: f32, total: f32) {
    print("tick");
}
```

`update` takes one `f32` (`MTEK-E5050`). The total time is `frame.time`.

### A collision handler on an entity without a collider

```mtek wrong=MTEK-E5062 wrap=entity
mesh: Box {};

on collision_enter(other: entity_ref) {
    print("hit");
}
```

Collision events are delivered to entities and prefabs that have a collider (`MTEK-E5062`); see [Physics](physics.md).

## See also

- [State and bindings](state-and-bindings.md): when a binding sees a changed value.
- [Physics](physics.md): the fixed tick and collision events.
- [Projects and modules](modules-and-projects.md): the `[runtime]` table of `mtek.toml`.
- [Scenes specification](../../spec/scenes.md): the normative frame order, section 10.

## Diagnostics on this page

{{cited-codes}}
