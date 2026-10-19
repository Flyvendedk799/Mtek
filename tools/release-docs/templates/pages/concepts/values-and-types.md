# Values and types

{{generated}}

Every value in Mtek has one type that the compiler knows before the program runs, and the compiler converts nothing for you. This page lists the types, what you can do with each of them, and the rules that most often surprise someone who has written JavaScript, GLSL or WGSL.

## Rules

1. **The types** of the prelude are {{features type:}}. The scalars are `bool`, `i32`, `u32` and `f32`; `vec2`, `vec3` and `vec4` hold `f32` components; `mat4` is a 4x4 matrix; `quat` is a rotation; `color` is a colour; `string` is text. A `struct` is the only type you declare yourself.
2. **No implicit conversion.** `i32`, `u32` and `f32` never mix in one operator, and a `vec4`, a `quat` and a `color` are three different types even though each holds four `f32`. Convert with `f32(x)`, `i32(x)` and `u32(x)`. The one exception is a literal, which takes the type its context needs: `state x: f32 = 1;` is fine and `vec3(0, 1, 0)` is fine.
3. **Numbers are written in one way.** A float has digits on both sides of the point (`1.0`, `0.5`, `2.5e-3`); `1.`, `.5` and `1e3` are errors. There are no suffixes and no hexadecimal literals. There is no constant for pi: write `3.1415927`.
4. **Vectors** combine component by component when both sides have the same size, and a vector may be multiplied or divided by an `f32`. A vector plus an `f32` is an error, and `==` does not exist for vectors; compare components.
5. **Swizzles read from `xyzw` only.** `v.xz` and `v.zyx` read; `v.rgb` is for `color`, and a `vec3` or `vec4` has no `rgb`. You may assign one component (`v.y = 0.0;`) but not several at once (`v.xz = ...`).
6. **A `color` is linear RGBA** with straight alpha. A literal such as `#6b5cff` is written in sRGB and converted exactly when the program is compiled. `color.linear(rgb, a)` takes linear components, `color.srgb(rgb, a)` converts sRGB components. Read `.r`, `.g`, `.b`, `.a` and `.rgb`; the colour itself has no arithmetic, so compute on `.rgb` and build a new colour. Colour literals have six or eight hex digits.
7. **A `quat` is a unit quaternion.** `a * b` applies `b` first, and `q * v` rotates the `vec3` `v`. Build one with `quat.identity()`, `quat.axis_angle(axis, angle)` or `quat.euler(x, y, z)`; angles are in radians. Quaternions cannot be added.
8. **Arrays have a fixed length**, written `array<T, N>` with `N` a literal or an integer constant (1 to 65 536), and the literal is `[a, b, c]`. An array has no length member and cannot grow; keep `N` in a constant. A constant index outside the array is an error, and a run-time index is clamped to the last valid element, the same on the CPU and the GPU. `for x in arr` visits every element by value.
9. **A `struct` has named fields and no methods.** Build a value with a descriptor: `Spring { k: 4.0; rest: 1.0 }`. Every field is given exactly once.
10. **Strings are CPU-only.** They cannot be joined, formatted or sent to the GPU; the one use of a string is `print("text")` in a handler.
11. **Integers wrap**: `i32` and `u32` arithmetic is modulo 2^32, `x / 0` is `x` and `x % 0` is `0`. An expression of literals and constants is folded by the compiler, and an overflow there is an error. `f32` arithmetic is IEEE.
12. **Statements.** `let` declares a value that is never assigned again; `var` declares a variable and must be assigned later (otherwise the compiler suggests `let`). An `if` condition has to be a `bool`; there is no truthiness. Comparisons do not chain (`a < b < c` is an error). Loops are `for i in a..b` and `for x in array`. There is no `while` and no ternary operator.
13. **Names.** A name that is visible from an enclosing scope cannot be declared again (no shadowing). Words reserved for later versions cannot be used as names: {{reserved-words}}.

The numeric types, vector operations and the integer rules are specified in [Part A of the language reference](../language-reference.md#part-a-the-core-language), sections 5 to 8.

## Why

- Implicit conversions are where shader and script code disagree: JavaScript turns everything into a double, WGSL refuses to mix types, and the same expression can mean different things on the CPU and the GPU. Mtek compiles most expressions to both, so it has one set of rules and enforces them where you write the code.
- A colour is its own type so that the compiler can keep sRGB and linear light apart. Arithmetic on a gamma-encoded value is wrong, and the type system is the cheapest place to prevent it.
- Fixed-length arrays and clamped indices make the GPU and CPU results equal, because WGSL does not define what an out-of-range read returns.
- The lexical rules (digits on both sides of a point, no suffixes) mean that the spelling of a number decides its type, and `mtek fmt` has nothing to guess.

## Examples

A scene that uses explicit conversions, a vector, an array and a struct. The cube follows a spring and a ring buffer remembers the last four frame times.

```mtek
struct Spring {
    k: f32;
    rest: f32;
}

fn pull(s: Spring, x: f32) -> f32 {
    return -s.k * (x - s.rest);
}

scene Demo {
    state frames: i32 = 0;
    state spring: Spring = Spring { k: 4.0; rest: 1.0 };
    state times: array<f32, 4> = [0.0, 0.0, 0.0, 0.0];

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    entity Cube {
        mesh: Box {};
        position: vec3(2.0, 0.5, 0.0);

        update(dt: f32) {
            self.position.x += pull(spring, self.position.x) * dt;
            times[frames % 4] = dt;
            frames += 1;
        }
    }
}
```

`frames % 4` is an `i32`, which is a valid array index. `f32(frames) * dt` would be needed to multiply the two; `frames * dt` is rejected (see below).

Colours are built from `.rgb` and a new alpha:

```mtek
scene Demo {
    state tint: color = #336699;

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    on key_down(Key.Space) {
        tint = color.linear(tint.rgb * 0.5, tint.a);
    }
}
```

## Common mistakes

### Mixing `i32` and `f32`

```mtek wrong=MTEK-E3014 wrap=update
let frames: i32 = 3;
let seconds: f32 = frames * dt;
```

The operator `*` is not defined for `i32` and `f32` (`MTEK-E3014`). Write `f32(frames) * dt`.

### Adding a scalar to a vector

```mtek wrong=MTEK-E3014 wrap=entity
update(dt: f32) {
    self.position = self.position + 1.0;
}
```

`+` needs two vectors of the same size (`MTEK-E3014`). Write `self.position + vec3(1.0, 1.0, 1.0)`, or `vec3(1.0)`. `*` and `/` do accept an `f32`.

### Reading `rgb` from a vector

```mtek wrong=MTEK-E3013 wrap=entity
update(dt: f32) {
    let c = self.position.rgb;
}
```

A `vec3` has `x`, `y` and `z` (`MTEK-E3013` for anything else). The same applies to the `vec4` that `sample` returns: use `.xyz`, then build a colour with `color.linear`.

### Arithmetic on a colour

```mtek wrong=MTEK-E3010 wrap=entity
mesh: Box {};
material: Unlit { color: #ff0000 * 0.5 };
```

Colours have no operators (`MTEK-E3010`). Use `color.linear(vec3(1.0, 0.0, 0.0) * 0.5, 1.0)`; mind that this halves a linear value, which is not half as bright to the eye.

### A float that ends at the point

```mtek wrong=MTEK-E0022 wrap=entity
mesh: Box {};
position: vec3(1., 0.0, 0.0);
```

`1.` has no digits after the point (`MTEK-E0022`); the compiler offers `1.0` as an edit.

### Using a reserved word as a name

```mtek wrong=MTEK-E0013 wrap=update
let move = vec3(1.0, 0.0, 0.0);
```

`move` is reserved for a later version (`MTEK-E0013`), as are `type`, `use`, `loop`, `static` and the others listed above. Pick another name such as `step_vector`.

### Declaring a name twice

```mtek wrong=MTEK-E2001
scene Demo {
    state speed: f32 = 1.0;

    camera Main {
        position: vec3(0.0, 2.0, 5.0);
        target: vec3(0.0, 0.0, 0.0);
    }

    update(dt: f32) {
        let speed = 2.0;
    }
}
```

The local `speed` shadows the state `speed` (`MTEK-E2001`). One name has one meaning in every place a reader sees it. A local may reuse the name of a prelude function such as `length` or `step`, but then the function can no longer be called there (`MTEK-E2004`).

### An `if` on a number

```mtek wrong=MTEK-E3070 wrap=update
let lives: i32 = 3;
if lives {
    print("alive");
}
```

The condition has to be a `bool` (`MTEK-E3070`). Write `lives > 0`.

### Comparing vectors with `==`

```mtek wrong=MTEK-E3012 wrap=entity
update(dt: f32) {
    if self.position == vec3(0.0, 0.0, 0.0) {
        self.position.x = 1.0;
    }
}
```

`==` is not defined for vectors (`MTEK-E3012`). Compare the components you care about, or compare `length(self.position)` with a limit.

## See also

- [Functions and effects](functions-and-effects.md): which code may run on the GPU.
- [Lighting and units](lighting-and-units.md): what a colour value means on the screen.
- [Language reference](../language-reference.md): the normative text and the registry tables.

## Diagnostics on this page

{{cited-codes}}
