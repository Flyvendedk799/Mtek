# 0182. Screen and world coordinates

- Status: Accepted
- Date: 2026-10-24

`screen_to_world(point: vec2, z: f32) -> vec3` casts from canvas NDC (`x` right,
`y` up) through the active camera onto the world plane at Z = `z`.
Perspective and orthographic projections and both target and quaternion camera
orientations use the renderer's coordinate conventions. A ray parallel to that
plane returns NaN x/y. `world_to_screen(point: vec3) -> vec2` is its inverse on
that plane. Points outside the viewport retain NDC coordinates outside [-1, 1].

The runtime gets the current render target's aspect ratio at each call. No
physics subsystem or pixel scaling assumptions are involved. Arcade Audio uses
the world-plane point for the mute hit area. Tests cover both projections at
16:9, 4:3 and portrait, including a tilted camera and hits outside the icon.
