# Materials and shaders

{{generated}}

A material is the one place where Mtek code runs on the GPU. It is a list of typed parameters and a single `fragment` function that computes the colour of a pixel. This page covers what the stage may read, how the built-in materials are defined, and how an entity uses a material.

## Rules

1. **Shape.** `material Name { param ...; fragment(input: SurfaceInput) -> color { ... } }`. A material has zero or more parameters and exactly one `fragment` stage (`MTEK-E4020` if it has none, `MTEK-E2002` for a second one). It has no state, no handlers and no CPU code (`MTEK-E1040`). A `vertex` or `compute` stage is `MTEK-E4901`: the vertex stage is fixed in this version.
2. **The stage.** `fragment` takes one parameter of type `SurfaceInput`, with any name, and returns a `color` (`MTEK-E4021` otherwise). `SurfaceInput` has the fields {{type-fields SurfaceInput}}. `world_normal` is re-normalised for you; `uv` has its origin at the top left. The compiler notices which fields the stage reads, and only those are passed from the vertex stage; a mesh that lacks an attribute the stage reads is rejected when the program is compiled (`MTEK-E7010`).
3. **Alpha comes from the colour params.** The pixel is written with the alpha you return. It blends with what is behind it only while a `color` param of the instance has an alpha below 1: the draw is then translucent, drawn after the opaque ones and back to front (decision 0138). A constant returned alpha other than 1.0 gives the warning `MTEK-W5101`.
4. **Parameters.** `param name: T = default;`. `T` is `bool`, `i32`, `u32`, `f32`, `vec2`, `vec3`, `vec4`, `mat4`, `quat`, `color`, a `struct` of those, an array of those, `texture` or `sampler` (anything else, such as `string`, is `MTEK-E4030`). The default is a constant (`MTEK-E4031`). Inside the stage a parameter is a read-only value (`MTEK-E3061` on assignment). A `color` parameter takes any alpha; below 1 the draw is translucent. A material has at most 8 texture and sampler parameters together (`MTEK-E6002`).
5. **The stage reads nothing else.** It may use the input, the parameters, constants and pure functions. It cannot capture scene state, entity fields, `frame.*`, `self` or a `cpu fn` (`MTEK-E4040`). To use `frame.time` in a material, add a parameter and bind it in the instance: `phase: bind(frame.time)`.
6. **GPU rules apply to the stage and everything it calls**: constant loop bounds, no strings, no CPU-only intrinsics, no recursion. See [Functions and effects](functions-and-effects.md).
7. **Parameters are never compiled into the shader.** A value that changes at run time is written to a buffer. Changing a parameter, even every frame, never builds a new shader or pipeline.
8. **Instances.** An entity uses a material through a descriptor: `material: Pulse { tint: #6b5cff; phase: bind(frame.time) };`. Every parameter without a default must be given (`MTEK-E5003`); an unknown name is `MTEK-E5001` and a wrong type `MTEK-E3102`. A value is either evaluated once or a `bind(...)`. Each entity gets its own parameter storage. A handler may assign a parameter (`Cube.material.phase = 0.5;`) unless it is bound (`MTEK-E5070`). The material itself is fixed at construction (`MTEK-E5073`), and so are texture and sampler parameters.
9. **Built-in materials.** `Unlit` writes its `color`, unaffected by lights and exposure. `Pbr` is the lit material. Both are ordinary Mtek source in the compiler's prelude, and an entity with a `mesh` and no `material` gets `Unlit {}`. Their parameters are listed below the rules.
10. **Lit shading in your own material** uses the GPU intrinsic {{signature lighting.pbr}}. It reads `world_position` and `world_normal` of the input and applies every light of the scene, the ambient light and the camera's exposure (see [Lighting, units and colour](lighting-and-units.md)). Without it, a material is not lit and not scaled by exposure.
11. **Names.** A material or prefab parameter may share its name with a prelude type, as `Unlit` does with `color`. Inside, the name means the parameter in expressions, and `color.linear(...)` would then be `MTEK-E2005`. Choose another name for your own parameters.
12. **Glb materials.** `MODEL.material("Name")` gives a `Pbr` instance with the factors and base colour texture of a material in a glTF file (see [Textures, samplers and assets](textures-samplers-and-assets.md)).

The parameters of the built-in materials:

**`Unlit`**

{{fields Unlit}}

**`Pbr`**

{{fields Pbr}}

## Why

- Only the stage function and its pure callees reach the GPU, so you can read a program and know exactly which code runs where. Nothing is moved to the GPU because it looks mathematical.
- A stage cannot capture state, because capturing would hide how a value gets to the GPU. Passing it through a parameter makes the transport visible in the entity that uses the material, where a `bind` shows which state feeds it.
- Parameters outside the shader code mean no recompiling and no stalls on the first frame in which a colour changes, which is what makes live tuning cheap.
- The fixed vertex stage and the single colour target keep every material interchangeable on every mesh the language can draw.

## Examples

An animated material: the parameters carry the data in, a pure function is shared with CPU code.

```mtek
fn pulse(t: f32) -> f32 {
    return 0.65 + 0.35 * sin(t);
}

material Pulse {
    param tint: color = #6b5cff;
    param phase: f32 = 0.0;

    fragment(input: SurfaceInput) -> color {
        return color.linear(tint.rgb * pulse(phase), tint.a);
    }
}

scene Demo {
    state tint: color = #6b5cff;

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Cube {
        mesh: Box {};
        material: Pulse { tint: bind(tint); phase: bind(frame.time) };
    }
}
```

A lit material of your own: stripes whose colours and number are parameters, shaded by `lighting.pbr`, and changed from a handler.

```mtek
fn stripe(v: f32, bands: f32) -> f32 {
    return step(0.5, fract(v * bands));
}

material Striped {
    param stripe_a: color = #e8e2d0;
    param stripe_b: color = #2a3f5f;
    param bands: f32 = 6.0;
    param metallic: f32 = 0.0;
    param roughness: f32 = 0.6;

    fragment(input: SurfaceInput) -> color {
        let albedo = color.linear(mix(stripe_a.rgb, stripe_b.rgb, stripe(input.uv.y, bands)), 1.0);
        return lighting.pbr(input, albedo, metallic, roughness);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 1.5, 4.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Sun {
        light: DirectionalLight {};
        rotation: quat.euler(-0.9, 0.4, 0.0);
    }

    entity Ball {
        mesh: Sphere {};
        material: Striped { bands: 10.0 };
    }

    on key_down(Key.Space) {
        Ball.material.bands = 4.0;
        Ball.material.stripe_a = #e0a526;
    }
}
```

A material that shows the surface normal, to check the geometry:

```mtek
material Normals {
    fragment(input: SurfaceInput) -> color {
        return color.linear(input.world_normal * 0.5 + vec3(0.5), 1.0);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 1.5, 4.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Ball {
        mesh: Sphere {};
        material: Normals {};
    }
}
```

## Common mistakes

### Reading state in the stage

```mtek wrong=MTEK-E4040
material Glow {
    fragment(input: SurfaceInput) -> color {
        return color.linear(vec3(strength), 1.0);
    }
}

scene Demo {
    state strength: f32 = 0.5;

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

The stage cannot read the scene state `strength` (`MTEK-E4040`). Add `param strength: f32 = 0.5;` to the material and write `Glow { strength: bind(strength) }` in the entity.

### A material with no stage, or with the wrong one

```mtek wrong=MTEK-E4020
material Empty {
    param tint: color = #ff0000;
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

Every material needs a `fragment` (`MTEK-E4020`). Returning something else than a `color` is `MTEK-E4021`: `fragment(input: SurfaceInput) -> color`.

### A parameter the GPU does not have

```mtek wrong=MTEK-E4030
material Labelled {
    param label: string = "a";

    fragment(input: SurfaceInput) -> color {
        return #ff0000;
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

A `string` has no GPU representation (`MTEK-E4030`).

### Random numbers and printing in a stage

```mtek wrong=MTEK-E4012
material Noise {
    fragment(input: SurfaceInput) -> color {
        return color.linear(vec3(random()), 1.0);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

`random` runs on the CPU only (`MTEK-E4012`). Derive noise from `input.uv` or the position with `fract(sin(dot(...)))`, or compute a seed on the CPU and pass it as a parameter.

### Using a parameter name that hides a namespace

```mtek wrong=MTEK-E2005
material Flat {
    param color: color = #ffffff;

    fragment(input: SurfaceInput) -> color {
        return color.linear(vec3(1.0), 1.0);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

Inside `Flat`, `color` is the parameter, so `color.linear` is `MTEK-E2005`. Name the parameter `tint`.

### Giving a parameter a value of the wrong type

```mtek wrong=MTEK-E3102
material Dim {
    param level: f32 = 0.5;

    fragment(input: SurfaceInput) -> color {
        return color.linear(vec3(level), 1.0);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity A {
        mesh: Box {};
        material: Dim { level: vec3(1.0, 0.0, 0.0) };
    }
}
```

The parameter `level` is an `f32` (`MTEK-E3102`). A parameter that has no default and is missing from the instance is `MTEK-E5003`; a name the material does not have is `MTEK-E5001`.

### A returned alpha

```mtek warn=MTEK-W5101
material Ghost {
    fragment(input: SurfaceInput) -> color {
        return color.linear(vec3(1.0, 0.0, 0.0), 0.5);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

This compiles with the warning `MTEK-W5101`: `Ghost` has no colour param, so its draws are never translucent and the pixel looks opaque. Return the alpha of a `color` param, or `1.0`, to remove the warning.

## See also

- [Functions and effects](functions-and-effects.md): what the stage may call.
- [Textures, samplers and assets](textures-samplers-and-assets.md): `texture` and `sampler` parameters and `sample`.
- [Lighting, units and colour](lighting-and-units.md): lights, exposure and `lighting.pbr`.
- [Materials specification](../../spec/materials.md): the normative text, including the lighting model.

## Diagnostics on this page

{{cited-codes}}
