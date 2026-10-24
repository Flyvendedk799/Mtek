# Mtek game examples

## [Night Shift](Night_Shift/README.md)

A first-person hotel room-clearer: six rooms, 30 enemies, pistol and melee combat,
rigged characters, animation transitions and original Art Deco environments.
Gameplay is written in Mtek and compiled by this repository's compiler. The small
browser host handles pointer capture and focus; it does not simulate gameplay.

From the repository root:

```sh
node GameExamples/Night_Shift/tools/build.mjs
python -m http.server 4173 --bind 127.0.0.1 --directory GameExamples/Night_Shift/dist
```

Open http://127.0.0.1:4173/ and click the start button. See the game's README for
controls, asset credits, regeneration steps and verification commands.
