# Tutorial: catch the crates

{{generated}}

This tutorial builds one small program in seven steps. You will end up with a lit room, a cart that you drive with the arrow keys, crates that fall from the sky when you press the space bar, a score shown as two bars, a material of your own and a second file. Each step adds one idea and links to the page that explains it.

You need a working toolchain; [Getting started](getting-started.md) installs it and shows how to run, break and repair a program. Create a project and replace its program:

```console
$ mtek new catcher
$ cd catcher
$ mtek dev
```

`mtek dev` serves the project and rebuilds when you save. Open the address it prints in a browser with WebGPU. The new project mounts a scene called `Demo`, so every program below declares `scene Demo`. In each step, change `src/main.mtek` as shown. A block with lines that start with `-` and `+` is a change to the file you already have: lines that start with `-` go away, lines that start with `+` come in, and the other lines show where the change goes.

Every program and every change on this page is compiled by the test suite of the documentation, in this order, so each step starts from a program that compiles. What the tests cannot do is look at the picture; the descriptions of what you see are what the program is specified to do.

## Step 1: a lit scene

Put this in `src/main.mtek`:

```mtek project=tutorial file=src/main.mtek
scene Demo {
    clear_color: #101418;
    ambient_color: #6070a0;
    ambient_intensity: 0.4;

    camera Main {
        position: vec3(0.0, 3.0, 9.0);
        target: vec3(0.0, 1.5, 0.0);
    }

    entity Sun {
        light: DirectionalLight { intensity: 2.0 };
        rotation: quat.euler(-0.9, 0.4, 0.0);
    }

    entity Floor {
        position: vec3(0.0, -0.5, 0.0);
        mesh: Box { size: vec3(12.0, 1.0, 6.0) };
        material: Pbr { base_color: #3a4150; roughness: 0.9 };
    }
}
```

The room is a dark blue-grey floor under a light from above and to one side. What the file says:

- The *scene* is the thing that runs. `clear_color` is the background, and `ambient_color` and `ambient_intensity` are the light that comes from everywhere. Scene fields are constants.
- The *camera* is at `position`, looking at `target`. A scene needs exactly one active camera.
- The *Sun* is an entity with a `DirectionalLight`. Its `intensity` is in lux, and with the default camera exposure 1 lux makes a white surface come out exactly white, so 2.0 is twice that, which suits the dark materials of this scene. The light shines along the entity's `-Z` axis; `quat.euler(-0.9, 0.4, 0.0)` tilts that axis down and turns it. See [Lighting, units and colour](concepts/lighting-and-units.md) for the units and for what to change when you want a sunny day (the intensity becomes 100 000 and the camera gets an `exposure`).
- The *Floor* is an entity with a box-shaped mesh and a `Pbr` material, the lit material. Colours such as `#3a4150` are written in sRGB and stored as linear light.

## Step 2: something you can steer

Add a cart. It reads the keyboard every frame and moves along `x`:

```diff project=tutorial
         material: Pbr { base_color: #3a4150; roughness: 0.9 };
     }
+
+    entity Cart {
+        position: vec3(0.0, 0.5, 0.0);
+        mesh: Box { size: vec3(2.0, 0.4, 1.5) };
+        material: Pbr { base_color: #2f9e8f; roughness: 0.5 };
+
+        update(dt: f32) {
+            var direction = 0.0;
+            if is_key_down(Key.ArrowLeft) {
+                direction -= 1.0;
+            }
+            if is_key_down(Key.ArrowRight) {
+                direction += 1.0;
+            }
+            self.position.x = clamp(self.position.x + direction * 6.0 * dt, -5.0, 5.0);
+        }
+    }
 }
```

The arrow keys now move the cart. Three things to notice:

- `update(dt: f32)` runs once per frame, and `dt` is the time since the last frame in seconds, so `6.0 * dt` is a speed of six metres per second whatever the frame rate. The duration is clamped, so a stalled frame does not throw the cart across the room.
- `is_key_down(Key.ArrowLeft)` is true while the key is held. `on key_down(...)` would run once per press instead. Key names are the members of `Key`; `Key.Left` does not exist.
- `var` declares something you will assign; `direction -= 1.0` is shorthand for `direction = direction - 1.0`. `self` is the entity the code belongs to.

See [Time and input](concepts/time-and-input.md).

## Step 3: things that fall

A *prefab* is a template for entities that you create while the program runs. This one describes a crate that falls under gravity and removes itself when it falls out of the world. Add it above the scene:

```diff project=tutorial
+prefab Crate {
+    param origin: vec3 = vec3(0.0, 8.0, 0.0);
+    param tint: color = #e0a526;
+
+    position: origin;
+    mesh: Box { size: vec3(0.6, 0.6, 0.6) };
+    material: Pbr { base_color: tint; roughness: 0.6 };
+    body: Dynamic { mass: 1.0 };
+    collider: BoxCollider { size: vec3(0.6, 0.6, 0.6) };
+
+    fixed_update(dt: f32) {
+        if self.position.y < -5.0 {
+            destroy(self);
+        }
+    }
+}
+
 scene Demo {
     clear_color: #101418;
```

`param` lines are the inputs of the prefab; a crate gets its position from `origin`. `body: Dynamic` makes the physics engine move it, and `collider` gives it a shape (sizes are full widths). The prefab is one entity: it cannot contain other entities, and it cannot see the scene. See [Prefabs and scenes](concepts/prefabs-and-scenes.md).

Crates need something to land on, so make the floor a static body:

```diff project=tutorial
         material: Pbr { base_color: #3a4150; roughness: 0.9 };
+        body: Static {};
+        collider: BoxCollider { size: vec3(12.0, 1.0, 6.0) };
     }
 
```

And add a handler that creates a crate when you press the space bar:

```diff project=tutorial
             self.position.x = clamp(self.position.x + direction * 6.0 * dt, -5.0, 5.0);
         }
     }
+
+    on key_down(Key.Space) {
+        spawn(Crate { origin: vec3(random() * 8.0 - 4.0, 8.0, 0.0) });
+    }
 }
```

Every press of the space bar drops a crate at a random place above the floor. `spawn` is allowed in handlers and in `update`, `random()` too; neither is allowed in a binding or in a function that must be pure. The crate falls through the cart, because the cart is not a body yet. See [Entities, references and spawning](concepts/entities-and-references.md) and [Physics](concepts/physics.md).

## Step 4: reading an error

Make the cart a body too, so that crates land on it. A kinematic body is a body that you move yourself, with a target for the next physics tick. Its target will come from a variable of the scene, so first add the variable:

```diff project=tutorial
 scene Demo {
+    state cart_x: f32 = 0.0;
+
     clear_color: #101418;
```

Now give the cart the body and its collider:

```diff project=tutorial wrong=MTEK-E5071
         material: Pbr { base_color: #2f9e8f; roughness: 0.5 };
+        body: Kinematic {};
+        collider: BoxCollider { size: vec3(2.0, 0.4, 1.5) };
 
         update(dt: f32) {
```

The compiler refuses the program with `MTEK-E5071`: the cart's `position` now belongs to the physics engine, and `update` still assigns it. That is the rule of single ownership: a field has one writer, and the pose of a body is written by the engine. The diagnostic names the way to move a kinematic body, `set_kinematic_target`. That command applies once per physics tick, so it goes into `fixed_update`, while `update` keeps the wanted position in `cart_x`:

```diff project=tutorial
                 direction += 1.0;
             }
-            self.position.x = clamp(self.position.x + direction * 6.0 * dt, -5.0, 5.0);
+            cart_x = clamp(cart_x + direction * 6.0 * dt, -5.0, 5.0);
+        }
+
+        fixed_update(dt: f32) {
+            self.body.set_kinematic_target(vec3(cart_x, 0.5, 0.0), quat.identity());
         }
     }
```

Crates now land on the cart. If the compiler stops you with a code you do not know, look it up in the table at the end of the page that explains the feature, or in [the catalogue](../spec/diagnostics.md); the message names the rule and, where the compiler can prove one, a repair.

## Step 5: keep score

Two counters, and a handler on the floor and on the cart. A collision handler receives the other entity as a reference; `destroy(other)` removes it. Crates should not bounce, so give their collider a `restitution` of 0:

```diff project=tutorial
     body: Dynamic { mass: 1.0 };
-    collider: BoxCollider { size: vec3(0.6, 0.6, 0.6) };
+    collider: BoxCollider { size: vec3(0.6, 0.6, 0.6); restitution: 0.0 };
 
     fixed_update(dt: f32) {
```

```diff project=tutorial
     state cart_x: f32 = 0.0;
+    state caught: i32 = 0;
+    state missed: i32 = 0;
 
     clear_color: #101418;
```

```diff project=tutorial
         collider: BoxCollider { size: vec3(12.0, 1.0, 6.0) };
+
+        on collision_enter(other: entity_ref) {
+            missed += 1;
+            destroy(other);
+        }
     }
 
```

```diff project=tutorial
             self.body.set_kinematic_target(vec3(cart_x, 0.5, 0.0), quat.identity());
         }
+
+        on collision_enter(other: entity_ref) {
+            caught += 1;
+            destroy(other);
+        }
     }
 
```

The counts change, but nothing shows them yet. Two bars at the top of the picture will: their size and position are *bound* to the counters, so they follow without a handler. A bound field is re-evaluated every frame, may only read, and cannot also be assigned; `f32(caught)` converts the integer, because Mtek never mixes `i32` and `f32`:

```diff project=tutorial
             caught += 1;
             destroy(other);
         }
     }
+
+    entity CaughtBar {
+        position: bind(vec3(-5.5 + 0.25 * f32(caught), 5.5, 0.0));
+        scale: bind(vec3(0.5 * f32(caught) + 0.05, 0.3, 0.3));
+        mesh: Box {};
+        material: Unlit { color: #2f9e8f };
+    }
+
+    entity MissedBar {
+        position: bind(vec3(-5.5 + 0.25 * f32(missed), 5.0, 0.0));
+        scale: bind(vec3(0.5 * f32(missed) + 0.05, 0.3, 0.3));
+        mesh: Box {};
+        material: Unlit { color: #e0527a };
+    }
 
     on key_down(Key.Space) {
```

The green bar grows with every crate you catch and the red one with every crate that reaches the floor. `Unlit` shows its colour as written, whatever the light. See [State and bindings](concepts/state-and-bindings.md).

## Step 6: a material of your own

A material is a typed parameter list and one function that runs for every pixel, on the GPU. This one paints stripes and uses the same lighting as `Pbr`:

```diff project=tutorial
+fn stripe(v: f32, bands: f32) -> f32 {
+    return step(0.5, fract(v * bands));
+}
+
+material Stripes {
+    param tint: color = #e0a526;
+    param bands: f32 = 3.0;
+
+    fragment(input: SurfaceInput) -> color {
+        let dark = tint.rgb * 0.35;
+        let albedo = color.linear(mix(tint.rgb, dark, stripe(input.uv.y, bands)), 1.0);
+        return lighting.pbr(input, albedo, 0.0, 0.6);
+    }
+}
+
 prefab Crate {
     param origin: vec3 = vec3(0.0, 8.0, 0.0);
```

The stage can only read its parameters and the surface input. Use the material in the prefab, and give every crate a random colour when it is created:

```diff project=tutorial
     mesh: Box { size: vec3(0.6, 0.6, 0.6) };
-    material: Pbr { base_color: tint; roughness: 0.6 };
+    material: Stripes { tint: tint };
     body: Dynamic { mass: 1.0 };
```

```diff project=tutorial
     on key_down(Key.Space) {
-        spawn(Crate { origin: vec3(random() * 8.0 - 4.0, 8.0, 0.0) });
+        let tint = color.linear(vec3(random(), random(), random()), 1.0);
+        spawn(Crate { origin: vec3(random() * 8.0 - 4.0, 8.0, 0.0); tint: tint });
     }
 }
```

`stripe` is a plain `fn`, so it could be called from CPU code as well. `random()` is not allowed in a material, but it is in the handler, which passes the result in as a parameter. See [Materials and shaders](concepts/materials-and-shaders.md) and [Functions and effects](concepts/functions-and-effects.md).

## Step 7: a second file

A file is a module, and `export` shares an item. Put a second kind of falling object in its own file, `src/gem.mtek`:

```mtek project=tutorial file=src/gem.mtek
export prefab Gem {
    param origin: vec3 = vec3(0.0, 8.0, 0.0);

    position: origin;
    mesh: Sphere { radius: 0.3 };
    material: Pbr { base_color: #e0527a; metallic: 0.8; roughness: 0.3 };
    body: Dynamic { mass: 0.5 };
    collider: SphereCollider { radius: 0.3; restitution: 0.0 };

    fixed_update(dt: f32) {
        if self.position.y < -5.0 {
            destroy(self);
        }
    }
}
```

Import it at the top of `src/main.mtek`, and drop one when you press `G`:

```diff project=tutorial
+import { Gem } from "./gem.mtek";
+
 fn stripe(v: f32, bands: f32) -> f32 {
     return step(0.5, fract(v * bands));
```

```diff project=tutorial
         spawn(Crate { origin: vec3(random() * 8.0 - 4.0, 8.0, 0.0); tint: tint });
     }
+
+    on key_down(Key.G) {
+        spawn(Gem { origin: vec3(random() * 8.0 - 4.0, 8.0, 0.0) });
+    }
 }
```

Imports name what they take, start with `./` or `../` and end in `.mtek`. See [Modules, projects and host inputs](concepts/modules-and-projects.md), which also shows how a web page can set values of the scene.

## What you built, and where to go next

You used a scene, a camera, a light, entities, a prefab, `state`, `bind`, a handler, `spawn` and `destroy`, a body and its commands, a material and a module. The compact [language guide](language-guide.md) lists the rules of all of them in one page, and the [concept pages](README.md#concepts) explain each with its common mistakes. Ideas to try: make the crates heavier as the score rises (a `state` and a multiplication in the handler), show the score with a bar in a different colour per tens, make the sun a `PointLight` that swings with `bind`, or give the crates a texture ([Textures, samplers and assets](concepts/textures-samplers-and-assets.md)).

For a game with a title scene, a saved best score, tags and a pause key, start from `mtek new my-game --template game`, or open `examples/small-game`. Sprites, fades and easing are in `examples/sprite-pop`.
