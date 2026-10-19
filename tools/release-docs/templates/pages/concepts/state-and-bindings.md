# State and bindings

{{generated}}

A Mtek program keeps its data in `state` and shows it on the screen with `bind`. Every field of every entity has exactly one writer, and the compiler checks which one. This page explains the three ways to give a field a value, what a binding may read and call, and how to derive one value from another.

## Rules

1. **State is declared data.** `state name: T = value;` appears in a scene, an entity or a prefab and has a type and an initial value. Scene state is read and written by its bare name in the scene and in every entity of it. Entity state is `self.name` inside the entity and `EntityName.name` elsewhere in the scene. A prefab cannot see scene state, because a prefab is not inside a scene (`MTEK-E2003`). Entity state cannot be named like a field of an entity (`state position: ...` is `MTEK-E2002`).
2. **Initial values.** A `state` initialiser may use constants, earlier state and any function, including `random()`. It may not read a field of an entity (`MTEK-E5081`) or call `spawn` (`MTEK-E5080`). The initial value of a *field* of a scene entity or camera, and of a material parameter of an instance, must be a constant expression in this build; anything else is `MTEK-E9010` ("specified but not implemented"). To get a field to follow state, bind it, or set it from a handler.
3. **Three writers, one per field.** A field gets its value from exactly one of: its initial value together with assignments in handlers (the default), a `bind(...)` expression, or the physics engine (an entity with a `body`). Assigning a bound field anywhere is `MTEK-E5070`; assigning or binding the pose of a body is `MTEK-E5071` and `MTEK-E5072`.
4. **Assignment** is a statement of a handler or a lifecycle function. `=`, `+=`, `-=`, `*=` and `/=` work on state, on writable fields (`self.rotation *= q`) and on one component of a vector field (`self.position.y = 0.0`).
5. **`bind(expression)` is a live link.** The expression is evaluated every frame, after all handlers have run, and written to the field. It is allowed only as the *whole* value of a field that is bindable, or of a value parameter in a material instance (`MTEK-E5004` otherwise, and `MTEK-E1001` where a statement stands, because `bind` is not a value). Which fields are bindable is in the *After construction* column of the tables below.
6. **A binding is pure.** It may read constants, scene state, `frame.delta`, `frame.time`, `frame.index`, the fields and state of named entities, parameters and `self`, and may call `fn`s and pure intrinsics. Calling a `cpu fn` or a CPU-only intrinsic (`random`, `is_key_down`, `alive`, `print`) is `MTEK-E5005`. A binding cannot depend on a camera field or a body property (`MTEK-E5005`) or on a field read through an `entity_ref` (`MTEK-E5074`). Its type must be exactly the type of the field (`MTEK-E3102`; no implicit conversion, so write `f32(count)`).
7. **No cycles.** If `A.position` is bound to something that reads `B.position`, and `B.position` is bound to something that reads `A.position`, the program is rejected (`MTEK-E5075`).
8. **Deriving a value.** Put the formula in a pure `fn` and call it inside `bind`: the dependency on state stays visible and the function can be shared with a shader. If the formula needs a CPU-only function, compute the value in a handler and store it in a second `state`, then bind that.
9. **Bound is not the same as initial.** `phase: bind(frame.time)` follows time. `phase: frame.time` is evaluated once, when the entity is created, and then never changes.
10. **What a handler sees.** A bound field has a value before the first frame; a handler that reads it sees the value from the previous evaluation, not what this frame's bindings will compute. All bindings are evaluated in dependency order, once per frame, after `update`.
11. **Inspecting.** `mtek inspect --bindings` prints the GPU slots of every material instance with the update class of each parameter (`initial`, `imperative`, `bound`, `resource`) and the state and frame values a bound parameter depends on.

The fields of an entity, a camera and a light, and whether a field can be bound or assigned:

{{fields Entity}}

{{fields Camera}}

## Why

- With one writer per field you can answer "who changes this?" by reading the declaration. Two writers would have to be ordered, and the order would be a rule for you to remember; a bound field and a handler that fights it are rejected instead.
- A binding is pure because it runs for every frame and must be repeatable: it cannot read the keyboard, roll dice or spawn. The same restriction lets the compiler record what each binding depends on, so that a value can be uploaded to the GPU only when it changed.
- Parameters of a material are never part of the shader code. A value that changes at run time is written into a buffer, and a change never needs a new shader or pipeline.
- Evaluating all bindings after the handlers means that what you see is consistent: no frame draws a field computed from half of the state that changed.

## Examples

A gauge whose bar follows a level. The colour is derived by a pure function, the size is derived inline, and the keys change the state.

```mtek
fn fill(level: f32) -> color {
    return color.linear(vec3(1.0 - level, level, 0.1), 1.0);
}

scene Demo {
    state level: f32 = 0.25;

    camera Main {
        position: vec3(0.0, 1.0, 6.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Bar {
        mesh: Box {};
        position: bind(vec3(0.0, level, 0.0));
        scale: bind(vec3(0.4, max(level * 2.0, 0.01), 0.4));
        material: Unlit { color: bind(fill(level)) };
    }

    on key_down(Key.ArrowUp) {
        level = min(level + 0.1, 1.0);
    }

    on key_down(Key.ArrowDown) {
        level = max(level - 0.1, 0.0);
    }
}
```

An entity with its own state, and a second entity that follows the first one:

```mtek
scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 6.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Counter {
        mesh: Box {};
        state hits: i32 = 0;

        on key_down(Key.Space) {
            self.hits += 1;
        }
    }

    entity Follower {
        mesh: Sphere { radius: 0.3 };
        position: bind(Counter.position + vec3(0.0, 1.0 + f32(Counter.hits), 0.0));
    }
}
```

## Common mistakes

### Assigning a field that is bound

```mtek wrong=MTEK-E5070
scene Demo {
    state level: f32 = 0.5;

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Bar {
        mesh: Box {};
        position: bind(vec3(0.0, level, 0.0));

        update(dt: f32) {
            self.position.y = 1.0;
        }
    }
}
```

`Bar.position` is bound, so it cannot be assigned (`MTEK-E5070`; the message points at the `bind`). Update what it reads: `level`.

### Calling something impure in a binding

```mtek wrong=MTEK-E5005 wrap=entity
mesh: Box {};
position: bind(vec3(random(), 0.0, 0.0));
```

`random` is CPU-only (`MTEK-E5005`). The same holds for a `cpu fn` and for `is_key_down`. Compute the number in a handler, store it in a `state` and bind the state.

### Binding a field that is fixed at construction

```mtek wrong=MTEK-E5004 wrap=entity
mesh: bind(Box {});
```

`mesh`, `body`, `collider` and the instance of a `material` are fixed when the entity is created (`MTEK-E5004`). The parameters of a material are bindable: `material: Pbr { roughness: bind(shine) }`.

### Binding with the wrong type

```mtek wrong=MTEK-E3102 wrap=entity
mesh: Box {};
position: bind(1.0);
```

The binding gives an `f32`, the field wants a `vec3` (`MTEK-E3102`). A wrong type inside the expression, such as a `vec3` built from an `i32`, is `MTEK-E3001`.

### Using bind where a statement stands

```mtek wrong=MTEK-E1001 wrap=entity
mesh: Box {};

update(dt: f32) {
    self.position = bind(vec3(0.0, 1.0, 0.0));
}
```

`bind` is not a value (`MTEK-E1001`). It can be the value of a field declaration only; in a handler, assign the value itself.

### Two bindings that need each other

```mtek wrong=MTEK-E5075
scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity A {
        mesh: Box {};
        position: bind(B.position);
    }

    entity B {
        mesh: Box {};
        position: bind(A.position);
    }
}
```

The two fields depend on each other (`MTEK-E5075`); the message lists every binding of the cycle. Make one of them the source and bind the other to it.

### A field initial value that is not a constant

```mtek wrong=MTEK-E9010
scene Demo {
    state x: f32 = 2.0;

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity A {
        mesh: Box {};
        position: vec3(x, 0.0, 0.0);
    }
}
```

This build folds the initial value of an entity field at compile time, so `vec3(x, ...)` with a state is `MTEK-E9010`. Write `position: bind(vec3(x, 0.0, 0.0))`, or assign it in a handler. A `state` can be initialised from other state, and a prefab field can use its parameters (see [Prefabs and scenes](prefabs-and-scenes.md)).

### Reading an entity while initialising state

```mtek wrong=MTEK-E5081
scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity A {
        mesh: Box {};
        position: vec3(1.0, 0.0, 0.0);
    }

    state start_x: f32 = A.position.x;
}
```

Entity fields do not exist yet while state is initialised (`MTEK-E5081`). Use a constant, or read the field in `update`.

### Giving entity state the name of a field

```mtek wrong=MTEK-E2002 wrap=entity
mesh: Box {};
state position: f32 = 0.0;
```

`self.position` would be ambiguous (`MTEK-E2002`). Call it `height` or `offset`.

## See also

- [Time and input](time-and-input.md): when bindings are evaluated during a frame.
- [Entities and references](entities-and-references.md): reading other entities.
- [Materials and shaders](materials-and-shaders.md): binding material parameters.
- [Projects and modules](modules-and-projects.md): exposing state to the page that embeds the program.
- [Scenes specification](../../spec/scenes.md): sections 8 and 11, the normative rules.

## Diagnostics on this page

{{cited-codes}}
