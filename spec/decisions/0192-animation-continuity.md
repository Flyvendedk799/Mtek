# 0192 - Moving crossfades and pose transfer

Status: accepted. Extends 0191.

The room-clearer exposed two discontinuities: the outgoing character stopped
moving during a crossfade, and a newly spawned falling body began in its own
starting pose. Both are runtime animation concerns that generalize to other games.

Completed skeletal states now crossfade between two advancing clips, preserving
the outgoing clip's speed, loop mode and weight. A transition interrupted during
its blend snapshots the displayed composite pose, avoiding a snap or an unbounded
chain of active players. Incoming timing and marker queries remain authoritative;
outgoing markers do not cause gameplay events. The outgoing player is discarded
when the blend completes. Existing transition signatures are unchanged.

`animation.copy_pose(target: entity_ref, source: entity_ref) -> bool` snapshots the
source's displayed local skeletal pose, stops the destination's playback and
holds that pose. The destination owns its snapshot independently of the source.
A subsequent transition blends from the held pose. Compatible skeletons require
the same mesh-node index, node count/order, names, parents and bind TRS values;
mesh geometry and clip collections may differ. Missing/dead/unskinned references
or incompatible skeletons return false without changing the destination.
This is a CPU, handler/lifecycle-only mutation, like other animation controls.

A spawned entity can receive its source reference as a prefab parameter and copy
it in init, after the spawn has become live. Room-clearer uses this for falling
bodies, then transitions into its death clip. The API transfers pose only, not
entity transforms, physics, messages, animation time or marker crossings.

Tests cover moving blends, interrupted continuity, outgoing weights, held pose
independence, incompatible skeletons and emitted native context calls.
