# Physics

{{generated}}

Physics in Mtek is a subsystem with one rule: the engine owns the pose of a body, and your program talks to it with commands. This page covers bodies and colliders, the commands, collision events and the limits you should know about.

## Rules

1. **A body and a collider come together.** An entity that takes part in physics declares `body: ...` and `collider: ...` (`MTEK-E5121` for a body without a collider, `MTEK-E5120` for the other way round). A program with no body never loads the physics code.
2. **Three body kinds.** `Static {}` never moves: its pose is the one it was created with. `Dynamic { ... }` is moved by the solver under gravity, forces and collisions. `Kinematic {}` is moved by you, with a target pose each tick (`set_kinematic_target`) or with collisions (`move_character`, rule 14). The collider is `BoxCollider`, `SphereCollider` or `CapsuleCollider`; sizes are *full* extents (`size` of a box is its width, height and depth; a sphere takes a `radius`; a capsule takes a `radius` and a `height` that includes both caps and must exceed twice the radius, `MTEK-E5124`).
3. **Roots only.** A body is allowed on a root entity (`MTEK-E5091` for a nested one, including a static instance of a prefab that has a body). The visual parts of a body entity are its children.
4. **Scale.** A `Dynamic` or `Kinematic` body has the constant scale `vec3(1.0)` (`MTEK-E5122`). A `Static` body may be scaled, which changes only what is drawn: the collider is sized by its own descriptor.
5. **One writer for the pose.** The solver owns `position` and `rotation` of an entity with a body. Assigning them is `MTEK-E5071` and binding them `MTEK-E5072`, whatever the kind. Move bodies with the commands below, and read the pose with `self.position`, `self.rotation`.
6. **Commands.** They are called as `Name.body.command(...)`, `self.body.command(...)` or `ref.body.command(...)`, only in handlers and lifecycle functions (`MTEK-E5080` in a function, `MTEK-E5005` in a `bind`). They are queued and applied at the start of the next fixed tick, in a fixed order (teleports, velocities, kinematic targets, character moves, impulses, forces). A command on a body of the wrong kind is `MTEK-E5123`; through a reference the kind is unknown to the compiler, so the runtime drops the command and reports `MTEK-E8101`.

   The two velocities are readable (`self.body.linear_velocity`) as of the last completed tick; assigning one is `MTEK-E5071`.
7. **Gravity** is the scene field `gravity` (default {{default Scene.gravity}}), a constant.
8. **Collision events.** `on collision_enter(other: entity_ref)` and `on collision_exit(other: entity_ref)` are handlers of an entity or a prefab that has a collider (`MTEK-E5062` otherwise). After each physics step the engine reports the pairs that started or stopped touching, and each of the two entities receives an event whose `other` is the partner. Compare `other` with a declared entity (`other == Floor`). `position`, `rotation`, `scale` and `visible` can be read; any other field is `MTEK-E5074`. Events come in a deterministic order, all `enter` events before all `exit` events.
9. **Sensors.** A collider with `sensor: true` detects overlap without pushing anything; it gives the same events. A static sensor is a trigger zone.
10. **Time.** The physics step is the fixed tick (see [Time and input](time-and-input.md)). Put code that calls body commands in `fixed_update` when it should apply every tick (a thrust), and in an event handler when it is a single action (a jump).
11. **Values are checked.** Mass must be greater than 0 and finite, damping and friction at least 0, restitution between 0 and 1, sizes greater than 0 (`MTEK-E5006`). Collider sizes are fixed at construction; to change one, spawn another entity.
12. **Continuous collision detection is opt-in.** Without it a small, fast body can pass through a *thin moving* obstacle. A static wall is safe at any speed that was measured. Write `Dynamic { continuous: true }` for a body that needs it (the `physics.continuousCollision` mount option turns it on for every dynamic body); it does not sweep teleports. Otherwise keep thin obstacles static, make them thicker, or clamp speeds with `set_linear_velocity` (see [Limitations](../limitations.md)).
13. **Destroying inside events is safe.** Removal is queued and applied at the next flush point, never in the middle of a delivery.
14. **Characters.** `self.body.move_character(displacement, rotation)` moves a `Kinematic` body by `displacement` metres this tick (`velocity * dt` in `fixed_update`): it slides along walls, steps up stairs, stays on slopes up to `max_slope`, snaps down to the ground and rides a moving kinematic platform (its translation and yaw) without any host code. Gravity is not applied; add your own vertical motion. Several calls in a tick add up, the last rotation wins, and a move replaces a `set_kinematic_target` of the same body in the same tick. `self.body.grounded` and `self.body.ground_normal` are the result of the last completed move (assigning them is `MTEK-E5071`). The settings `max_slope`, `step_height`, `step_min_width`, `snap_to_ground`, `skin` and `carry` are optional; the defaults are in the table below. A spawned collider is seen by character moves from the next tick. An adapter without character support drops the command with `MTEK-E8105`.

The descriptors:

**`Dynamic`**

{{fields Dynamic}}

**`Kinematic`**

{{fields Kinematic}}

**`BoxCollider`**

{{fields BoxCollider}}

**`SphereCollider`**

{{fields SphereCollider}}

**`CapsuleCollider`**

{{fields CapsuleCollider}}

The commands and properties:

{{body-commands}}

## Why

- A physics engine integrates positions with its own timestep and resolves contacts together. If your code also wrote the position, one of you would be right about where the body is, and which one would depend on the order of the frame. The language removes the question: there is one writer and the compiler checks it.
- Commands are queued for the next tick so that a handler never changes the world a step is working on, and so that two commands issued in different handlers have a defined effect.
- Roots-only bodies and constant scale keep poses in the world frame and colliders the size the physics engine thinks they are.
- Events are delivered with references that cannot be read, in a fixed order, so that handlers cannot create a dependency on the engine's internal ordering.

## Examples

A ball that bounces on a floor, jumps on the space bar, and reports its landing:

```mtek
scene Demo {
    gravity: vec3(0.0, -9.81, 0.0);

    camera Main {
        position: vec3(0.0, 3.0, 8.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Floor {
        position: vec3(0.0, -0.5, 0.0);
        mesh: Box { size: vec3(10.0, 1.0, 10.0) };
        body: Static {};
        collider: BoxCollider { size: vec3(10.0, 1.0, 10.0) };
    }

    entity Ball {
        position: vec3(0.0, 3.0, 0.0);
        mesh: Sphere { radius: 0.5 };
        body: Dynamic { mass: 2.0 };
        collider: SphereCollider { radius: 0.5; restitution: 0.6 };

        on collision_enter(other: entity_ref) {
            if other == Floor {
                print("landed");
            }
        }
    }

    on key_down(Key.Space) {
        Ball.body.apply_impulse(vec3(0.0, 8.0, 0.0));
    }
}
```

A lift moved by a kinematic target, and a trigger zone that counts what is inside:

```mtek
scene Demo {
    state inside: i32 = 0;

    camera Main {
        position: vec3(0.0, 3.0, 9.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Lift {
        mesh: Box { size: vec3(2.0, 0.2, 2.0) };
        body: Kinematic {};
        collider: BoxCollider { size: vec3(2.0, 0.2, 2.0) };

        fixed_update(dt: f32) {
            self.body.set_kinematic_target(vec3(0.0, 1.0 + sin(frame.time), 0.0), quat.identity());
        }
    }

    entity Zone {
        position: vec3(4.0, 1.5, 0.0);
        body: Static {};
        collider: BoxCollider { size: vec3(4.0, 2.0, 6.0); sensor: true };

        on collision_enter(other: entity_ref) {
            inside += 1;
        }

        on collision_exit(other: entity_ref) {
            inside -= 1;
        }
    }
}
```

A character that walks with the arrow keys, falls under its own gravity and jumps when it stands on something:

```mtek
scene Demo {
    state vertical: f32 = 0.0;

    camera Main {
        position: vec3(0.0, 4.0, 10.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Floor {
        position: vec3(0.0, -0.5, 0.0);
        mesh: Box { size: vec3(20.0, 1.0, 20.0) };
        body: Static {};
        collider: BoxCollider { size: vec3(20.0, 1.0, 20.0) };
    }

    entity Hero {
        position: vec3(0.0, 1.0, 0.0);
        mesh: Box { size: vec3(0.8, 1.8, 0.8) };
        body: Kinematic { step_height: 0.3 };
        collider: CapsuleCollider { radius: 0.4; height: 1.8 };

        fixed_update(dt: f32) {
            var walk = 0.0;
            if is_key_down(Key.ArrowRight) {
                walk = 3.0;
            }
            if is_key_down(Key.ArrowLeft) {
                walk = -3.0;
            }
            if self.body.grounded {
                vertical = 0.0;
                if is_key_down(Key.Space) {
                    vertical = 6.0;
                }
            } else {
                vertical = vertical - 9.81 * dt;
            }
            self.body.move_character(vec3(walk * dt, vertical * dt, 0.0), quat.identity());
        }
    }
}
```

Crates that fall from the sky and clean up after themselves. A prefab with a body removes its own instances when they fall out of the world:

```mtek
prefab Crate {
    param origin: vec3 = vec3(0.0, 4.0, 0.0);
    position: origin;
    mesh: Box {};
    body: Dynamic { mass: 1.0 };
    collider: BoxCollider { size: vec3(1.0, 1.0, 1.0) };

    fixed_update(dt: f32) {
        if self.position.y < -10.0 {
            destroy(self);
        }
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 4.0, 12.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Floor {
        position: vec3(0.0, -0.5, 0.0);
        mesh: Box { size: vec3(10.0, 1.0, 10.0) };
        body: Static {};
        collider: BoxCollider { size: vec3(10.0, 1.0, 10.0) };
    }

    on key_down(Key.C) {
        let crate = spawn(Crate { origin: vec3(0.0, 6.0, 0.0) });
        crate.body.apply_impulse(vec3(1.0, 0.0, 0.0));
    }
}
```

## Common mistakes

### Moving a body by assigning its position

```mtek wrong=MTEK-E5071
scene Demo {
    camera Main {
        position: vec3(0.0, 3.0, 8.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Ball {
        mesh: Sphere { radius: 0.5 };
        body: Dynamic {};
        collider: SphereCollider { radius: 0.5 };

        update(dt: f32) {
            self.position.y += dt;
        }
    }
}
```

The solver owns the position (`MTEK-E5071`; the message names the allowed operations). Use `apply_impulse`, `set_linear_velocity` or `teleport`. A `Kinematic` body is moved with `set_kinematic_target`.

### Binding the position of a body

```mtek wrong=MTEK-E5072 wrap=entity
mesh: Sphere { radius: 0.5 };
body: Dynamic {};
collider: SphereCollider { radius: 0.5 };
position: bind(vec3(0.0, frame.time, 0.0));
```

A body's pose cannot be driven by a binding (`MTEK-E5072`).

### A body without its collider, or the reverse

```mtek wrong=MTEK-E5121 wrap=entity
mesh: Sphere { radius: 0.5 };
body: Dynamic {};
```

`body` needs `collider` (`MTEK-E5121`), and `collider` needs `body` (`MTEK-E5120`; write `body: Static {}` for a fixed collider).

### A body inside another entity

```mtek wrong=MTEK-E5091
scene Demo {
    camera Main {
        position: vec3(0.0, 3.0, 8.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Parent {
        mesh: Box {};

        entity Ball {
            mesh: Sphere { radius: 0.5 };
            body: Dynamic {};
            collider: SphereCollider { radius: 0.5 };
        }
    }
}
```

Physics poses are world poses, so a body must be a root entity (`MTEK-E5091`). Make `Ball` a sibling and give it its own visual children if you need parts.

### A scaled dynamic body

```mtek wrong=MTEK-E5122 wrap=entity
mesh: Sphere { radius: 0.5 };
scale: vec3(2.0, 2.0, 2.0);
body: Dynamic {};
collider: SphereCollider { radius: 0.5 };
```

Dynamic and kinematic bodies are not scaled (`MTEK-E5122`). Make the mesh and the collider the size you need: `Sphere { radius: 1.0 }` and `SphereCollider { radius: 1.0 }`.

### A command for the wrong kind of body

```mtek wrong=MTEK-E5123
scene Demo {
    camera Main {
        position: vec3(0.0, 3.0, 8.0);
        target: vec3(0.0, 1.0, 0.0);
    }

    entity Wall {
        mesh: Box {};
        body: Static {};
        collider: BoxCollider { size: vec3(1.0, 1.0, 1.0) };
    }

    on key_down(Key.Space) {
        Wall.body.apply_impulse(vec3(0.0, 8.0, 0.0));
    }
}
```

`apply_impulse` applies to dynamic bodies (`MTEK-E5123`). A static body cannot move.

### Handling collisions on an entity with no collider

```mtek wrong=MTEK-E5062 wrap=entity
mesh: Box {};

on collision_enter(other: entity_ref) {
    print("hit");
}
```

There is nothing to collide (`MTEK-E5062`). Add a `body` and a `collider`.

### A value out of range

```mtek wrong=MTEK-E5006 wrap=entity
mesh: Sphere { radius: 0.5 };
body: Dynamic { mass: 0.0 };
collider: SphereCollider { radius: 0.5 };
```

The mass must be greater than 0 (`MTEK-E5006`).

## See also

- [Time and input](time-and-input.md): the fixed tick.
- [Entities and references](entities-and-references.md): spawning bodies and commanding them through a reference.
- [Prefabs and scenes](prefabs-and-scenes.md): bodies in prefabs.
- [Physics specification](../../spec/physics.md): the normative text and the measured limits.

## Diagnostics on this page

{{cited-codes}}
