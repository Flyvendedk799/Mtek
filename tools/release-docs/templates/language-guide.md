# Mtek language guide (v0.1)

{{generated}}

- Generated from `tools/release-docs/templates/language-guide.md`; `npm run check:release` fails when this file is stale or larger than 16 384 bytes (decision 0118).
- Language {{language-version}}. Compiler: {{compiler-version-line}}.
- One rule, one correct pattern. The reasons, longer examples and the common mistakes with their diagnostic codes are on the [concept pages](README.md#concepts). Lists of names and defaults are read from the registry. Every code block is compiled by the tests; a block marked `wrap=` is the inside of a scene that has a camera.

## 1. Program shape

{{example examples/pulse-cube/mtek.toml}}

{{excerpt examples/pulse-cube/src/main.mtek :: ^scene Demo :: ^\}$}}

- A file is a module of items: `import`, `const`, `fn`, `cpu fn`, `struct`, `material`, `prefab`, `scene`. A scene holds scene fields, `const`, `state`, `camera`, `entity`, `update`, `fixed_update` and `on` handlers; an entity the same plus fields and nested entities. Anything else is `MTEK-E1040`.
- One scene runs (`scene = "Name"` in `mtek.toml` if the entry file has several), with exactly one active camera. Entity names are unique in the scene.
- Fields and statements end in `;`. A descriptor separates its fields with `;` too (`Box { size: vec3(1.0, 1.0, 1.0) }`; a comma is `MTEK-E1001`). `state` and `param` need a type.
- Metres, seconds, radians, kilograms; right-handed, `+Y` up, a camera or light looks along its `-Z`. An entity with a `mesh` and no `material` is `Unlit {}`; a `material` without a `mesh` is `MTEK-E5020`.
- Not in the language: `while`, closures, generics, null, ternary, string joining, user enums. {{reserved-count}} words are reserved (`move`, `type`, `use`, `loop`, `static`, `mod`, ...): `MTEK-E0013`.

## 2. Values

```mtek wrap=update
let n: i32 = 3;
// No implicit i32, u32 or f32 mixing: convert.
let seconds = f32(n) * dt;
// vec op vec and vec * f32 work; vec + f32 and vec == vec are errors.
let v = vec3(1.0, 0.0, 0.0) * seconds + vec3(0.0);
// Swizzles use xyzw; .rgb is for color. One component can be assigned: v.y = 0.0.
let flipped = v.zyx;
// A color is linear and has no arithmetic; literals are sRGB.
let dim = color.linear(#336699.rgb * 0.5, 1.0);
// a * b applies b first; q * vec3 rotates.
let turn = quat.axis_angle(vec3(0.0, 1.0, 0.0), 0.5) * quat.identity();
// Arrays have a fixed length and no .length; a run-time index is clamped.
let ring: array<f32, 3> = [1.0, 2.0, 3.0];
let first = ring[n % 3];
// There is no PI. Floats need digits on both sides: 1.0, not 1.
let tau = 6.2831855;
// Loops: for i in a..b (end excluded) and for x in array. `const` needs a constant value.
const STEPS: i32 = 4;
var total = 0.0;
for i in 0..STEPS {
    total += f32(i) * dt;
}
```

- `let` is never reassigned, `var` is. `if` needs a `bool`. A name cannot be declared where it is already visible (`MTEK-E2001`). `struct S { a: f32; }` is built `S { a: 1.0 }`. Strings are CPU-only.

## 3. Functions and effects

```mtek
fn smooth(t: f32) -> f32 {
    return t * t * (3.0 - 2.0 * t);
}

cpu fn jitter(range: f32) -> f32 {
    return (random() - 0.5) * range;
}
```

- `fn` is pure and may run on the CPU and on the GPU. `cpu fn` and handlers may use the CPU-only intrinsics. A `cpu fn` sees no scene: pass values in. A `fn` that calls CPU code is `MTEK-E4002`; recursion is `MTEK-E4001`; a `const` cannot call your functions (`MTEK-E3090`).
- Both domains: {{intrinsics both}}. CPU only: {{intrinsics cpu}}. GPU only: {{intrinsics gpu}}. `spawn` and `destroy` go directly in handlers and in `update` or `fixed_update` (`MTEK-E5080`).

## 4. State and bind

```mtek wrap=scene
// Scene state: bare name, always typed and initialised.
state level: f32 = 0.5;
entity Bar {
    mesh: Box {};
    // Entity state: self.hits inside, Bar.hits elsewhere.
    state hits: i32 = 0;
    // bind is live, pure and the whole value of a bindable field.
    position: bind(vec3(0.0, level, 0.0));
    scale: bind(vec3(0.4, max(level * 2.0, 0.01), 0.4));
    material: Unlit { color: bind(color.linear(vec3(level), 1.0)) };
}
on key_down(Key.ArrowUp) {
    // Write state in handlers; a bound field is never assigned.
    level = min(level + 0.1, 1.0);
}
```

- The first value of an entity field, a camera field or a material parameter of the scene must be a constant (`MTEK-E9010`); to follow state, bind it. A bound field cannot be assigned (`MTEK-E5070`). A binding cannot call a `cpu fn`, `random`, `is_key_down` or read a camera (`MTEK-E5005`), must have exactly the field's type (`MTEK-E3102`), and is not allowed on `mesh`, `body` or `exposure` (`MTEK-E5004`).
- `phase: bind(frame.time)` follows time; `phase: frame.time` is frozen at creation. A shader reads only its parameters (`MTEK-E4040`): add a `param` and bind it.

## 5. Entities, references, spawn

```mtek
prefab Bullet {
    param at: vec3 = vec3(0.0, 0.0, 0.0);
    position: at;
    mesh: Sphere { radius: 0.15 };
}

scene Demo {
    // No null: start at an empty entity and keep a flag.
    state has_bullet: bool = false;
    state bullet: entity_ref = Nothing;

    camera Main {
        position: vec3(0.0, 2.0, 6.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Nothing {}

    on key_down(Key.Space) {
        if has_bullet && alive(bullet) {
            destroy(bullet);
        }
        // spawn: handlers only. alive() is false until the next flush.
        bullet = spawn(Bullet { at: vec3(0.0, 1.0, 0.0) });
        has_bullet = true;
    }
}
```

- An `entity_ref` is compared (`other == Floor`), tested with `alive`, passed to `destroy`, given body commands, and kept in state, arrays and prefab params. Reading or writing a field through it is `MTEK-E5074`. A declared entity cannot be destroyed (`MTEK-E5030`): set `visible = false`.
- A prefab is one entity (`MTEK-E5040`), has no light (`MTEK-E5110`) and does not see the scene (`MTEK-E2003`): pass values in as `param`s. `entity E: Prefab { param: constant; }` sets params only (`MTEK-E5042`, `MTEK-E3090`).

## 6. Time and input

```mtek wrap=entity
mesh: Box {};
// Per frame. dt is in seconds, at most {{project-default MAX_FRAME_DELTA}}; multiply motion by dt.
update(dt: f32) {
    // Held key: CPU only, not in a fn or a bind.
    if is_key_down(Key.ArrowLeft) {
        self.position.x -= 4.0 * dt;
    }
}
// Fixed {{project-default FIXED_STEP}} s step before update; body commands go here.
fixed_update(dt: f32) { }
// key_down and key_up fire once per press; the key must be a constant Key.
on key_up(Key.Space) { }
// position.x and .y are in -1..1, +y up.
on pointer_move(event: PointerEvent) { }
```

- Keys: {{enum Key}}. `Key.Up`, `"w"` and `Key.Shift` do not exist (`MTEK-E2003`, `MTEK-E5061`). Events: {{features event:}}. `update` and `fixed_update` take one `f32` (`MTEK-E5050`); there is no `start` (`MTEK-E5052`).

## 7. Lighting and units

```mtek wrap=scene
camera Sun {
    position: vec3(0.0, 8.0, 12.0);
    target: vec3(0.0, 0.0, 0.0);
    // EV100, a constant. Lit results are multiplied by 1 / (1.2 * 2^exposure).
    exposure: 15.0;
    active: true;
}
entity Light {
    // Lux. Shines along its -Z axis: aim by rotating.
    light: DirectionalLight { intensity: 100000.0 };
    rotation: quat.euler(-0.9, 0.4, 0.0);
}
entity Lamp {
    // Candela, inverse square falloff; range 0 is unlimited.
    light: PointLight { intensity: 60.0; range: 10.0 };
    position: vec3(0.0, 2.0, 0.0);
}
```

- The default exposure {{default Camera.exposure}} turns 1 lux into a white diffuse surface. For `E` lux use `exposure: log2(E / 3.77)` ({{exposure-for 500}} for 500 lux, {{exposure-for 100000}} for the sun). Ambient light (`ambient_intensity`, default {{default Scene.ambient_intensity}}) is scaled by the exposure too, and `A` is as bright as `pi * A` lux. Nothing is tone mapped: above 1.0 clips. At most 4 lights, only on named entities (`MTEK-E5111`, `MTEK-E5110`). `Pbr` and `lighting.pbr` are lit; `Unlit` is not.
- A camera has a `target` or a `rotation` (`MTEK-E5010`). Colour parameters are opaque (`MTEK-E5100`); a returned alpha is ignored.

## 8. Materials, textures, assets

```mtek
// Path: a literal, relative to this file, exact case. Use linear_texture for data.
const WOOD = asset.texture("../textures/wood.png");

material Textured {
    param base: texture = texture.white();
    // Presets: linear or nearest, repeat or clamp. Fixed at construction.
    param smp: sampler = sampler.nearest_repeat();
    param tint: color = #ffffff;

    // One stage: returns color and reads only the parameters and the input.
    fragment(input: SurfaceInput) -> color {
        // sample gives a vec4: use .xyz. Textures and samplers appear only as its arguments.
        let texel = sample(base, smp, input.uv);
        return lighting.pbr(input, color.linear(texel.xyz * tint.rgb, 1.0), 0.0, 0.6);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Crate {
        mesh: Box {};
        material: Textured { base: WOOD; tint: #ffd9a0 };

        // A material parameter is written like a field, unless it is bound.
        on key_down(Key.Space) {
            self.material.tint = #ff0000;
        }
    }
}
```

- `*` marks fields fixed at construction. {{field-list Pbr}} {{field-list Unlit}} Meshes: {{schemas mesh}}. A model: `const M = asset.glb("../m.glb");`, then `M.mesh("Name")`, `M.material("Name")`, `M.node_position("Name")`; the names are checked (`MTEK-E7024`).
- Shader code: constant loop bounds, no strings, no CPU intrinsics (`MTEK-E4010` to `MTEK-E4012`); `sample` is GPU-only (`MTEK-E4013`).

## 9. Physics

```mtek wrap=scene
entity Floor {
    mesh: Box { size: vec3(10.0, 1.0, 10.0) };
    position: vec3(0.0, -0.5, 0.0);
    body: Static {};
    // Sizes are full extents.
    collider: BoxCollider { size: vec3(10.0, 1.0, 10.0) };
}
entity Ball {
    mesh: Sphere { radius: 0.5 };
    position: vec3(0.0, 3.0, 0.0);
    body: Dynamic { mass: 2.0 };
    collider: SphereCollider { radius: 0.5; restitution: 0.6 };
    // Entities and prefabs with a collider receive collision events.
    on collision_enter(other: entity_ref) {
        if other == Floor {
            print("landed");
        }
    }
}
on key_down(Key.Space) {
    // Move bodies with commands; assigning their position is MTEK-E5071.
    Ball.body.apply_impulse(vec3(0.0, 8.0, 0.0));
}
```

- A body and a collider come together (`MTEK-E5120`, `MTEK-E5121`), on root entities (`MTEK-E5091`), with scale 1 when dynamic or kinematic (`MTEK-E5122`). Commands: {{features body-command:}}; readable: {{features body-property:}}.

## 10. Modules and host inputs

```mtek project=guide file=src/theme.mtek
export const GOLD: color = #e0a526;
```

```mtek project=guide file=src/main.mtek
import { GOLD } from "./theme.mtek";

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Cube {
        mesh: Box {};
        material: Unlit { color: GOLD };
    }
}
```

- An import path starts with `./` or `../`, ends in `.mtek` and names exported items; no `as`, `*` or packages (`MTEK-E2030` to `MTEK-E2036`). `[host.inputs] name = "Scene.state"` exposes a state through these codecs: {{codecs}}.
- Commands: {{commands}}. Run `mtek check` after every edit and fix the errors in report order; apply a suggested edit only when the diagnostic carries one.

## 11. Fixing errors

- `MTEK-E1001`, `MTEK-E1003`: a missing `;`, a `,` between descriptor fields, a reserved word used as a name, a `state` without a type.
- `MTEK-E2003`: unknown name. Scene state and named entities are not visible in a `cpu fn`, a material or a prefab; check the member of `Key`.
- `MTEK-E3001`, `MTEK-E3014`: types do not match; convert with `f32(x)` (a literal adapts, a variable does not).
- `MTEK-E5001`, `MTEK-E5003`: an unknown or missing field or parameter; the message lists the valid ones.
- `MTEK-E4040`, `MTEK-E4002`, `MTEK-E5005`: code in a place that may not do that (section 3 to 5): pass the value in as a `param` or a function argument.

## 12. Pages

[Getting started](getting-started.md), [tutorial](tutorial.md), [concept pages](README.md#concepts), [language reference](language-reference.md), [limitations](limitations.md).
