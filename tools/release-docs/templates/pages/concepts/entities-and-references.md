# Entities, references and spawning

{{generated}}

An entity is a named node of a scene. You can reach the entities you declared by name, and the ones you create while the program runs only through a reference. This page explains both, what a reference can do (less than you might expect), how to model "no entity", and how `spawn` and `destroy` behave.

## Rules

1. **An entity** is `entity Name { ... }` inside a scene. Its fields are position, rotation, scale, visible, mesh, material, light, body and collider (see the table in [State and bindings](state-and-bindings.md)); everything else it holds is `state`, functions of the lifecycle and event handlers. A field is written `name: value;`. An entity with no `mesh` draws nothing, and a `material` without a `mesh` is `MTEK-E5020`.
2. **Names are unique** in the whole scene, nested entities included (`MTEK-E2002`), and an entity is reached by its bare name from anywhere in the scene: `Cube.position`, `Cube.hits` (its state), `Cube.material.tint`, `Lamp.light.intensity`, `Ball.body.apply_impulse(v)`. Fields are read and, if they are writable and not bound, assigned.
3. **Nesting is parenting.** An entity declared inside another has a transform relative to its parent. It does not inherit fields, state or handlers. Re-parenting at run time does not exist, and a body is allowed on a root entity only (`MTEK-E5091`).
4. **Declared entities live as long as the scene.** `destroy(Cube)` is `MTEK-E5030`. Hide an entity with `visible: false` instead.
5. **`entity_ref` is a handle type.** A reference comes from `spawn(...)`, from the parameter of a collision handler, from naming an entity where a reference is expected (`other == Floor`), and from `self`. A reference can be stored in `state`, in an array and in a prefab `param`, and passed to a function.
6. **What a reference can do.** Compare with `==` and `!=`, ask `alive(r)`, remove with `destroy(r)`, and issue body commands (`r.body.apply_impulse(v)`). That is all. Reading or writing a field or state through a reference is `MTEK-E5074`: every access to an entity is checked by the compiler against a declaration, and a reference could point at anything.
7. **References do not dangle.** A reference is a slot number and a generation. When an entity is destroyed, the generation of its slot moves on, so an old reference never reaches the entity that later reuses the slot: `alive(r)` stays `false`, `destroy(r)` is a no-op and a body command is dropped, each with a warning at run time.
8. **There is no `null`, and no optional type.** To model "no entity", keep a `bool` next to the reference, or let `alive` answer. A `state` of type `entity_ref` needs an initial value, which must be a declared entity: use an empty one (`entity Nothing {}`, which draws nothing) as the placeholder, and a flag such as `has_target` to say whether the reference means anything.
9. **`spawn(Prefab { ... })`** creates an instance of a prefab at run time. It may be called in a handler or a lifecycle function only (`MTEK-E5080` in an initialiser or a `cpu fn`), takes a prefab literal (the parameters may be run-time values) and returns an `entity_ref` that is valid at once. The entity itself is created at the next flush point (the start of the next fixed tick, or the end of this frame), so `alive(r)` is `false` until then, and a spawned entity first runs in the phase after it was created. It is a root entity of the scene.
10. **`destroy(r)`** queues the removal. From that call on `alive(r)` is `false`, the entity's handlers do not run again, body commands for it are dropped, and no more collision events involving it are delivered; the entity, its children and its resources are removed at the next flush point. Destroying an entity twice is a no-op with a warning.
11. **A spawned entity cannot reach the scene.** A prefab sees its own parameters, state and functions, not the scene's state and not the named entities (`MTEK-E2003`); see [Prefabs and scenes](prefabs-and-scenes.md). Information goes in through parameters when it is spawned. The scene reaches the instance through the reference it kept.
12. **A limit** of {{project-default MAX_ENTITIES}} live entities applies (`max_entities` in `mtek.toml`); beyond it `spawn` returns a dead reference and the runtime reports a diagnostic.

## Why

- Static names make every field access checkable when the program is compiled: a typo is an error with a position, not a black canvas. The price is that dynamic entities cannot be used by name, and the language gives the smallest set of things you can do with a handle that keeps every access checkable.
- Generation-checked references mean that "I kept a reference to a bullet and it was destroyed" can never turn into "I moved a different bullet", which is the classic failure of slot-based entity systems.
- No `null` removes a whole class of "forgot to check" errors; the cost is the flag. The flag is visible in the code and in a reviewer's eyes, and `alive` covers the case where the entity may be gone.
- Spawn and destroy are queued so that a handler never sees the set of entities change while it is running. The order is fixed (removals first, then creations in spawn order), so the same inputs produce the same frame.

## Examples

Hold the most recent spawned entity in `state`, with a flag instead of `null`. Pressing Space replaces the previous bullet; pressing D removes the current one.

```mtek
prefab Bullet {
    param at: vec3 = vec3(0.0, 0.0, 0.0);
    position: at;
    mesh: Sphere { radius: 0.15 };
}

scene Demo {
    state has_bullet: bool = false;
    state bullet: entity_ref = Nothing;

    camera Main {
        position: vec3(0.0, 2.0, 6.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Nothing {}

    entity Gun {
        mesh: Box { size: vec3(0.5, 0.5, 1.0) };
        position: vec3(0.0, 1.0, 0.0);
    }

    on key_down(Key.Space) {
        if has_bullet && alive(bullet) {
            destroy(bullet);
        }
        bullet = spawn(Bullet { at: Gun.position + vec3(0.0, 0.0, -1.0) });
        has_bullet = true;
    }

    on key_down(Key.D) {
        if has_bullet && alive(bullet) {
            destroy(bullet);
            has_bullet = false;
        }
    }
}
```

`alive(bullet)` is also `false` for a bullet that was spawned in this frame and has not been created yet; the check above destroys only a bullet that exists.

Keep several references in a fixed array. The array is the pool, and `used` counts the slots in use:

```mtek
prefab Marker {
    param at: vec3 = vec3(0.0, 0.0, 0.0);
    position: at;
    mesh: Sphere { radius: 0.1 };
}

scene Demo {
    state slots: array<entity_ref, 4> = [Nothing, Nothing, Nothing, Nothing];
    state used: i32 = 0;

    camera Main {
        position: vec3(0.0, 2.0, 6.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Nothing {}

    on key_down(Key.Space) {
        if used < 4 {
            slots[used] = spawn(Marker { at: vec3(f32(used) - 1.5, 0.0, 0.0) });
            used += 1;
        }
    }

    on key_down(Key.Escape) {
        for i in 0..4 {
            if i < used {
                destroy(slots[i]);
            }
        }
        used = 0;
    }
}
```

A spawned entity that checks on the one that created it. The creator passes itself as a parameter and the child asks `alive`:

```mtek
prefab Follower {
    param owner: entity_ref;
    mesh: Sphere { radius: 0.2 };

    update(dt: f32) {
        if !alive(owner) {
            destroy(self);
        }
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 6.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Boss {
        mesh: Box {};
    }

    on key_down(Key.Space) {
        spawn(Follower { owner: Boss });
    }
}
```

## Common mistakes

### Reading a field through a reference

```mtek wrong=MTEK-E5074
prefab Crate {
    mesh: Box {};
}

scene Demo {
    state last: entity_ref = Floor;

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Floor {
        mesh: Box {};
    }

    on key_down(Key.P) {
        last = spawn(Crate {});
    }

    on key_down(Key.R) {
        last.position = vec3(0.0, 0.0, 0.0);
    }
}
```

A field cannot be read or written through an `entity_ref` (`MTEK-E5074`). Give the prefab a parameter for what the scene needs to tell it, or let the instance move itself in its own `update`. A body command such as `last.body.teleport(...)` is allowed.

### Destroying a declared entity

```mtek wrong=MTEK-E5030
scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Floor {
        mesh: Box {};
    }

    on key_down(Key.D) {
        destroy(Floor);
    }
}
```

`Floor` is declared in the scene and lives as long as it does (`MTEK-E5030`). Set `Floor.visible = false;`, or declare a prefab and spawn it.

### Spawning where no event is running

```mtek wrong=MTEK-E5080
prefab Crate {
    mesh: Box {};
}

scene Demo {
    state first: entity_ref = spawn(Crate {});

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

`spawn` runs in handlers and lifecycle functions (`MTEK-E5080` here, in a state initialiser). Spawn in an `on` handler or in `update`. A reference must start as a declared entity, as in the examples.

### A reference without a value

```mtek wrong=MTEK-E1001
scene Demo {
    state chosen: entity_ref;

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

Every `state` has an initial value (`MTEK-E1001`: the parser expects `=` after the type). There is no null reference; start with an empty entity and a flag, as in the examples.

### A prefab that looks for a declared entity

```mtek wrong=MTEK-E2003
prefab Follower {
    mesh: Box {};

    update(dt: f32) {
        self.position = Boss.position;
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Boss {
        mesh: Box {};
    }
}
```

A prefab is a module item and does not know the scene around it (`MTEK-E2003`, unknown name `Boss`). Pass the position in as a parameter when you spawn it, or pass the entity as an `entity_ref` to ask `alive`; fields still cannot be read through the reference.

### The same name twice

```mtek wrong=MTEK-E2002
scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Wheel {
        mesh: Sphere { radius: 0.3 };
    }

    entity Car {
        mesh: Box {};

        entity Wheel {
            mesh: Sphere { radius: 0.3 };
        }
    }
}
```

Names are unique across the scene, nested entities included (`MTEK-E2002`). Name the second `FrontWheel`.

## See also

- [Prefabs and scenes](prefabs-and-scenes.md): what a prefab may contain.
- [State and bindings](state-and-bindings.md): the fields of an entity and who may write them.
- [Physics](physics.md): collision handlers and body commands through a reference.
- [Scenes specification](../../spec/scenes.md): sections 4, 8.3 and 9.

## Diagnostics on this page

{{cited-codes}}
