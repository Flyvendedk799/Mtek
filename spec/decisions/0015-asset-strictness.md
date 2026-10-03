# 0015. Asset strictness

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §7.3.

## Decision

Assets are compile-time dependencies validated by the compiler. GLB is accessed through name-checked accessors (`.mesh`, `.material…`, `.node_position…`) instead of instantiating hierarchies. The v0.1 profile accepts **no** glTF extensions (required or used), no skinning, morphs, animations, sparse accessors, vertex colours, tangents, second UV sets, non-opaque or double-sided materials, or textures other than base colour — each is an error naming the feature. Recorded preprocessing (index widening, sequential index generation, no mipmaps) is listed in the manifest. **Consequence:** many exported files need re-export without extensions; that limitation is documented rather than hidden.
