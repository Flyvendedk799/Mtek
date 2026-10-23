# 0186. Gamepad polling

- Status: Accepted
- Date: 2026-10-24

`gamepad.connected(pad) -> bool`, `gamepad.axis(pad, axis) -> f32` and
`gamepad.button(pad, button) -> f32` poll browser Gamepad API indices. Axis values
are in [-1, 1]; buttons return analog pressure in [0, 1]. Games choose their own
dead zones and pressed thresholds. Missing or disconnected controls are neutral.

Each input phase copies one browser sample, so all callbacks in a frame see the
same values. Hidden documents, unavailable or blocked APIs read as disconnected.
The API is one namespace family to limit AI-context overhead. This adds no
physics dependency and does not reinterpret keyboard events.
