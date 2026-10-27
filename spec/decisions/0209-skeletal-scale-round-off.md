# 0209 — Bounded float32 scale round-off in orientation frames

Status: Accepted. Date: 2026-10-27. Extends decision 0196.

The original CesiumMan animated scale tracks vary by approximately 1.5 parts per
million between axes. The prior 1e-6 guard rejected this asset for world-frame
retargeting and IK orientation, although its hierarchy is otherwise compatible.
The character-composition workflow must retain original source data and distinguish
this numerical round-off from intentionally nonuniform orientation frames.

IK orientation and world-frame retargeting share one numerical-uniformity rule.
All three scale components must be finite and positive. Both `abs(x/y - 1)` and
`abs(x/z - 1)` must be at most `16 * 2^-23` (about 1.90735e-6), a bounded float32
round-off band. This is not a configurable tolerance and does not permit arbitrary
nonuniform ancestry. Bind values and animated/procedural poses are checked by the
same predicate. Values are preserved: no scale track or pose is normalized away.

This changes input admissibility, not positional/orientation correctness gates.
Tests independently check composed endpoint matrix axes and positions, preserve
actual imported-scale keys, and reject larger anisotropy in bind and animation
frames. The production workflow must also pass its numeric target and render
references without relaxing those accuracy limits.

The ABI and extension API stay at 1. Diagnostics keep their existing error type
and meaning outside this round-off band. Genuine nonuniform orientation frames,
negative/singular scales, arbitrary humanoid inference and anatomical solving
remain unsupported. The existing local-frame retarget mode is unchanged.
