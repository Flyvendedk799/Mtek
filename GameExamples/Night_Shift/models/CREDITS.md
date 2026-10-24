# Character assets

Hands.glb, Enemy.glb and their texture atlases are derived from CC0-1.0
MakeHuman system assets, as distributed by Kasper Olesen's CharacterCreator.
The six exact source files and SHA-256 digests are recorded in
`../tools/character-sources.json`, pinned to commit
`852e48f316b90a0937234886630e4fb4cdfd1f78`.

[Upstream asset licence and provenance](https://github.com/kblood/CharacterCreator/blob/852e48f316b90a0937234886630e4fb4cdfd1f78/LICENSE-NOTES.md)
explicitly covers body, clothing, hair, textures and baked animation data as
CC0-1.0. No upstream application or generation code is included or used.

Mtek's independently written preparation script merges geometry, removes hidden
surfaces, bakes atlases, preserves skin weights and authors weapon sockets,
recoil, reload, strikes and reactions. Locomotion is authored with planted-foot IK at the game's travel speeds,
contralateral arm swings and cyclic body motion. The CC0 idle clip supplies
subtle idle movement. These are authored animations, not motion capture.

Rebuild (Python with NumPy and Pillow):

```sh
node GameExamples/Night_Shift/tools/fetch-characters.mjs
python GameExamples/Night_Shift/tools/prepare-characters.py
```

The checked-in prepared models are used directly by normal Mtek builds.
Weapon geometry, rooms and sounds are original generated example assets.
