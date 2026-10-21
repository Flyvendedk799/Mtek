# Textures, samplers and assets

{{generated}}

Images and models are *assets*: files that the compiler opens and checks while it checks your program, so that a misspelled name or an unsupported file is an error with a position, not a black canvas. This page covers how to declare an asset, how a texture reaches a shader, what the four sampler presets do, and what is CPU-only and what is GPU-only.

## Rules

1. **Declaring.** `asset.texture("path")` is a colour image, `asset.linear_texture("path")` an image that holds data (masks, roughness) and `asset.glb("path")` a binary glTF model. Declare each as a `const` at the top of a file (`const WOOD = asset.texture("../textures/wood.png");`). A texture can also be written directly where it is used, as the value of a material parameter. A `glb_asset` can only live in a `const` and be used through its accessors (`MTEK-E7022`).
2. **Path rules.** The path is a string literal, because the compiler opens the file while it checks the program (`MTEK-E7022` for anything else, even a constant). It is resolved *relative to the file that contains it*, uses `/`, must stay inside the project (`MTEK-E7021`), must match the case of the file on disk (`MTEK-E7023`) and must name a file that exists (`MTEK-E7020`; the message shows the path it resolved, such as `src/textures/wood.png`, which is the usual sign that `../` is missing). A URL is `MTEK-E7901`: assets are local in this version.
3. **Image files.** PNG and JPEG, at most 8192 pixels on a side (`[assets] max_texture_dimension`), and a JPEG must not carry an EXIF orientation other than 1 (`MTEK-E7017`). The file must be no larger than `max_file_bytes` (`MTEK-E7002`). Image `uv` coordinates have their origin at the top left.
4. **Colour space.** `asset.texture` images are decoded as sRGB, so `sample` returns linear values, the same as a colour literal. `asset.linear_texture` images are used as stored; use it for anything that is data and not a colour.
5. **Built-in textures** are 1x1 and opaque: `texture.white()` is `(1, 1, 1, 1)` and `texture.black()` is `(0, 0, 0, 1)`. The sampler presets are listed below the rules. `linear` filters between texels and `nearest` shows single texels (pixel art, data). `repeat` tiles the texture outside the range 0 to 1 and `clamp` repeats the edge texel. No mip-maps are made, so a texture far smaller on the screen than in the file will shimmer.
6. **A texture reaches a shader as a parameter.** Declare `param base: texture = texture.white();` and `param smp: sampler = sampler.linear_repeat();` in a material, give the entity an instance (`Textured { base: WOOD; smp: sampler.nearest_clamp() }`) and sample in the stage with {{signature sample}}. The result is a `vec4`; its components are `x`, `y`, `z`, `w` (`.rgb` on a `vec4` is `MTEK-E3013`), so write `color.linear(texel.xyz, 1.0)`.
7. **Where a texture or sampler may be used.** In a stage, only as a direct argument of `sample` (`MTEK-E4041`; passing one to your own function is also `MTEK-E4011`). The preset constructors such as `sampler.linear_repeat()` are CPU-only, so they appear in parameter defaults and instance values and not in the stage (`MTEK-E4012`). `sample` itself is GPU-only: it cannot be called from `update` or a handler (`MTEK-E4013`).
8. **Resource parameters are fixed.** The `texture` or `sampler` of an instance is chosen when the entity is created: assigning one is `MTEK-E5073` and binding one `MTEK-E5004`. A material may have at most 8 texture and sampler parameters together (`MTEK-E6002`).
9. **The built-in `Pbr` material** has `base_color_texture` and `base_color_sampler` (the texture is multiplied by `base_color`). Use them for ordinary textured surfaces and write your own material when you need other maps.
10. **Models.** A `.glb` file is read through accessors, and every name is checked against the file (`MTEK-E7024` lists the names that do exist); the accessors are listed below the rules. A mesh with more than one primitive needs `.primitive(name, index)` (`MTEK-E7012`). The node accessors give the *world* transform of a node of the default scene. Objects without a name in the file cannot be referenced. Each entity uses one mesh; instancing a whole node hierarchy with `model:` is `MTEK-E7902`.
11. **The glTF profile is strict**: binary `.glb` with embedded buffers and images, no extensions, no skins, positions, normals and the first UV set only, opaque single-sided materials with a base colour texture. A LINEAR or STEP clip of translation, rotation and scale plays with `clip: "Name"` (decision 0156); morph weights and cubic spline stay out. A file that goes beyond the profile is an error that names the feature (`MTEK-E7001` to `MTEK-E7019`; see [Limitations](../limitations.md)).
12. **At run time** every asset the first scene needs is loaded before the program starts, checked against its recorded length and hash. A file that cannot be fetched or decoded stops the start with an overlay that names the file (`MTEK-E7030`, `MTEK-E7031`); nothing is drawn with a missing texture instead.

The sampler presets:

{{members sampler}}

The accessors of a model:

{{methods glb_asset}}

A project that uses assets looks like this (the paths in the examples are written from `src/main.mtek`):

```text
my-project/
  mtek.toml
  src/main.mtek
  textures/wood.png
  models/chair.glb
```

## Why

- Opening the file at compile time turns the common mistakes (wrong path, wrong case, a misspelled mesh name, a file the runtime cannot decode) into diagnostics with positions. It also means a program is self-contained: the assets that it uses are known, hashed and packaged with it.
- Relative paths make a module move with its files. A library module can bring its own textures.
- A texture is a parameter and not a global so that two entities with the same material can look different, and so that the transport to the GPU is visible in the instance.
- Samplers are presets rather than free-form objects so that the set of combinations stays small, testable and the same on every device.

## Examples

A textured floor. The texture is declared once, the material takes a texture and a sampler, and the entity picks the texture and a nearest sampler for crisp texels:

```mtek
const WOOD = asset.texture("../textures/wood.png");

material Textured {
    param base: texture = texture.white();
    param smp: sampler = sampler.linear_repeat();

    fragment(input: SurfaceInput) -> color {
        let texel = sample(base, smp, input.uv * 4.0);
        return color.linear(texel.xyz, 1.0);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 3.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Floor {
        mesh: Plane { size: vec2(6.0, 6.0) };
        material: Textured { base: WOOD; smp: sampler.nearest_repeat() };
    }
}
```

The same image on the built-in `Pbr` material, together with a data texture in a material of your own:

```mtek
const WOOD = asset.texture("../textures/wood.png");

const MASK = asset.linear_texture("../textures/mask.png");

material Masked {
    param base: texture = texture.white();
    param mask: texture = texture.white();
    param smp: sampler = sampler.linear_clamp();

    fragment(input: SurfaceInput) -> color {
        let colour = sample(base, smp, input.uv).xyz;
        let amount = sample(mask, smp, input.uv).x;
        return color.linear(colour * amount, 1.0);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Sun {
        light: DirectionalLight {};
        rotation: quat.euler(-0.9, 0.4, 0.0);
    }

    entity Crate {
        mesh: Box {};
        position: vec3(-1.5, 0.5, 0.0);
        material: Pbr {
            base_color_texture: WOOD;
            base_color_sampler: sampler.nearest_clamp();
            roughness: 0.8;
        };
    }

    entity Panel {
        mesh: Box {};
        position: vec3(1.5, 0.5, 0.0);
        material: Masked { base: WOOD; mask: MASK };
    }
}
```

A model: meshes, materials and node transforms come from the file, and each name is checked.

```mtek
const CHAIR = asset.glb("../models/chair.glb");

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 6.0);
        target: vec3(0.0, 0.5, 0.0);
    }

    entity Sun {
        light: DirectionalLight {};
        rotation: quat.euler(-0.9, 0.4, 0.0);
    }

    entity Seat {
        mesh: CHAIR.mesh("Quad");
        position: CHAIR.node_position("Seat");
        rotation: CHAIR.node_rotation("Seat");
        material: CHAIR.material("Fabric");
    }
}
```

## Common mistakes

### A path that is not relative to the file

```mtek wrong=MTEK-E7020
const WOOD = asset.texture("textures/wood.png");

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

The program is in `src/`, so the path is resolved to `src/textures/wood.png`, which does not exist (`MTEK-E7020`). Write `"../textures/wood.png"`.

### A path in a constant

```mtek wrong=MTEK-E7022
const PATH: string = "../textures/wood.png";
const WOOD = asset.texture(PATH);

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

The compiler needs the literal text to open the file (`MTEK-E7022`).

### The wrong case

```mtek wrong=MTEK-E7023
const WOOD = asset.texture("../Textures/wood.png");

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

The folder is `textures` (`MTEK-E7023`). Case must match even on systems that ignore it, so that a project builds the same everywhere.

### A remote image

```mtek wrong=MTEK-E7901
const WOOD = asset.texture("https://example.org/wood.png");

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

Assets are files of the project (`MTEK-E7901`). Download the image and commit it.

### Reading `.rgb` from a sample

```mtek wrong=MTEK-E3013
material Textured {
    param base: texture = texture.white();
    param smp: sampler = sampler.linear_repeat();

    fragment(input: SurfaceInput) -> color {
        let texel = sample(base, smp, input.uv);
        return color.linear(texel.rgb, 1.0);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

`sample` returns a `vec4` and `rgb` belongs to `color` (`MTEK-E3013`). Write `texel.xyz`.

### Creating a sampler in the stage, or handing a texture to a helper

```mtek wrong=MTEK-E4012
material Textured {
    param base: texture = texture.white();

    fragment(input: SurfaceInput) -> color {
        let texel = sample(base, sampler.linear_repeat(), input.uv);
        return color.linear(texel.xyz, 1.0);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }
}
```

The sampler presets run on the CPU (`MTEK-E4012`); add `param smp: sampler = sampler.linear_repeat();` and use `smp`. Passing `base` or `smp` to a function of your own is `MTEK-E4041`, because a texture exists only as an argument of `sample`.

### Sampling on the CPU

```mtek wrong=MTEK-E4013
const WOOD = asset.texture("../textures/wood.png");

scene Demo {
    state texel: vec4 = vec4(0.0, 0.0, 0.0, 0.0);

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    update(dt: f32) {
        texel = sample(WOOD, sampler.linear_repeat(), vec2(0.5, 0.5));
    }
}
```

The pixels of a texture are on the GPU, and `sample` is a GPU function (`MTEK-E4013`). To get data out of an image at run time, put it in the program as constants.

### Replacing a texture at run time

```mtek wrong=MTEK-E5073
material Textured {
    param base: texture = texture.white();
    param smp: sampler = sampler.linear_repeat();

    fragment(input: SurfaceInput) -> color {
        return color.linear(sample(base, smp, input.uv).xyz, 1.0);
    }
}

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Panel {
        mesh: Box {};
        material: Textured {};

        on key_down(Key.Space) {
            self.material.base = texture.black();
        }
    }
}
```

Texture and sampler parameters are fixed when the entity is created (`MTEK-E5073`). Use two entities and `visible`, or a number parameter that mixes two textures declared in the instance.

### A name that is not in the model

```mtek wrong=MTEK-E7024
const CHAIR = asset.glb("../models/chair.glb");

scene Demo {
    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Seat {
        mesh: CHAIR.mesh("Quadd");
    }
}
```

The file has no mesh `Quadd` (`MTEK-E7024`); the diagnostic lists the names the file does have, and offers a rename when exactly one is close.

## See also

- [Materials and shaders](materials-and-shaders.md): parameters and the stage.
- [Modules and projects](modules-and-projects.md): the `[assets]` limits in `mtek.toml`.
- [Limitations](../limitations.md): the whole glTF profile with the diagnostic of each restriction.
- [Assets specification](../../spec/assets.md): the normative text.

## Diagnostics on this page

{{cited-codes}}
