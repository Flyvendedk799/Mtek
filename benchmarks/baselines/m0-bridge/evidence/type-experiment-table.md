| Case | Wrong usage | tsc | First diagnostic |
|---|---|---|---|
| 01 | a vec3 value assigned to a float uniform | rejected | TS2322: Type 'Vector3' is not assignable to type 'number'. |
| 02 | a colour assigned to a vec2 uniform | rejected | TS2740: Type 'Color' is missing the following properties from type 'Vector2': x, y, width, height, and 36 more. |
| 03 | a misspelled uniform name used as a property of the typed uniform record | rejected | TS2339: Property 'colr' does not exist on type 'MixedUniforms'. |
| 04 | a misspelled uniform name passed to a lookup helper typed with `keyof` | rejected | TS2345: Argument of type '"colr"' is not assignable to parameter of type 'keyof MixedUniforms'. |
| 05 | a misspelled uniform name given to three.js itself (`setName`, a plain string) | NOT rejected | - |
| 06 | a vec3 value assigned to a colour uniform | rejected | TS2740: Type 'Vector3' is missing the following properties from type 'Color': isColor, r, g, b, and 20 more. |
| 07 | a number assigned to the boolean uniform | rejected | TS2322: Type 'number' is not assignable to type 'boolean'. |
| 08 | a boolean assigned to a float uniform | rejected | TS2322: Type 'boolean' is not assignable to type 'number'. |
| 09 | a negative number assigned to the unsigned uniform | NOT rejected | - |
| 10 | a fractional number assigned to the unsigned uniform | NOT rejected | - |
| 11 | a value beyond the u32 range assigned to the unsigned uniform | NOT rejected | - |
| 12 | a vec3 given to a uniform declared with the type string "float" | rejected | TS2769: No overload matches this call. |
| 13 | a three-component array for the vec2 parameter of `applyParams` | rejected | TS2322: Type 'number' is not assignable to type 'undefined'. |
| 14 | a wrong-length array for a vec3 parameter of `applyParams` | rejected | TS2322: Type '[number, number]' is not assignable to type 'readonly [number, number, number]'. |
| 15 | shader graph: a vec2 node added to a vec3 node | NOT rejected | - |
| 16 | shader graph: a vec2 uniform read through a swizzle that does not exist on vec2 | rejected | TS2339: Property 'xyz' does not exist on type 'UniformNode<"vec2", Vector2>'. |
| 17 | shader graph: a float node assigned where the material expects a vec4 colour node | NOT rejected | - |
| 18 | shader graph: a vec2 uniform assigned where the material expects a vec4 colour node | NOT rejected | - |
| 19 | a Vector2 value assigned to a vec3 uniform | rejected | TS2740: Type 'Vector2' is missing the following properties from type 'Vector3': z, isVector3, setZ, multiplyVectors, and 23 more. |
| 20 | not a mistake: converting a colour uniform node with the vec3() constructor | rejected | TS2769: No overload matches this call. |
| 21 | not a mistake: adding a vec3 to the result of select() over colour-times-float branches | rejected | TS2345: Argument of type 'VarNode<"vec3", ConstNode<"vec3", Vector3>>' is not assignable to parameter of type 'Number<"float">'. |

12 of 19 wrong usages rejected by tsc; 2 of 2 "not a mistake" cases rejected by tsc
