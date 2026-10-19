# 0123. What K-04 tried and dropped, and what it did not do (and why)

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: §12.3, M7; decisions 0099 item 5 (the candidates), 0119 to 0122.
- Supersedes: nothing.

## Context

Task K-04 said: keep only what helps, drop what does not or what breaks something, and say so. This record is that list, so that the performance work that remains is not rediscovered.

## Decision

**Tried and changed or dropped**

1. **Merging parameter blocks with a 1 KiB bound** (the first version of decision 0119): measured no faster than not merging (500 colours: p50 0.325 ms with it, 0.330 ms without), and it multiplied the bytes of that workload by 16. Replaced by a bound of the payload; the 500 parameter-block uploads stay 500 calls.
2. **Uploading the whole buffer instead of a range** was considered for the instance buffer and the arenas ("or the whole buffer when cheaper") and not built: the instance upload already goes from the first to the last changed word, which for one moving record is 4 bytes, and a whole-buffer upload of a 125 KiB buffer costs more than the range in every workload that was measured (a 125 KiB `writeBuffer` took about 0.075 ms in the profile of the material workload before it was bounded).
3. **`Math.hypot` in the bounding sphere** was replaced by a square root of the largest squared column (decision 0121 item 6); that is a change of the last binary64 digits of a number only the frustum test reads, not a dropped change.

**Not done**

4. **Skipping bindings whose dependencies did not change**: see decision 0120 item 7(a). No frozen workload would move, and a correct skip needs a by-value comparison of the dependencies because handlers write state directly.
5. **Render bundles** for the encoding of unchanged draws (decision 0120 item 7(b)): the largest remaining cost of the 500 individual draws and of the constant scene's eight; a design with its own lifetime and invalidation rules, to be measured against the cost of invalidation.
6. **Caching bind groups in the draw items** (the three `Map` lookups per individual draw, about 0.015 ms per 500 draws in the profile): the arena drops and rebuilds its bind groups on growth, so a cached reference can go stale; the gain did not justify a new invalidation rule.
7. **Allocation in the physics adapter and in the compiler's generated code** (decision 0121 item 7): `packages/physics-rapier` (`readPose`, `readVelocities`, `applyForce`) and the object literals and boxed numbers of the generated bindings are outside `packages/runtime-web`; K-04 was limited to the runtime package. `PhysicsSystem.writeBack` still freezes the vectors and quaternions it writes (whether a program may rely on those values being frozen is a semantic question that this task did not open). Reading the body velocities lazily was considered and not done: the values are those of the step, a read after a command or a removal could see another state.
8. **The unminified runtime and the cost of mounting** (decision 0099 item 5, last candidate, and the +120 % of the mount/reload/dispose cycles): not touched. The interleaved measurement of decision 0122 shows the mount, reload and dispose times did not get worse (mount p50 22.5 ms before, 18.6 to 20.5 ms after).
9. **The `ctx` proxy itself** (it still costs a trap per `ctx.frame` read: 2,000 per frame in the transforms workload, about 0.03 ms), and the per-frame `MtekFrame` write: left as they are.

**Where the results stand**

10. After K-04 every one of the seven workloads is above the 20 % investigation threshold in the second run (decision 0122 item 3); the frame workloads that never changed (constant scene, repeated meshes) are within about twice the direct reference in p50 (Mtek 0.040 ms in both; the direct reference's frame is 0.020 to 0.025 ms), and the ones where every entity changes every frame are still several times it. Release copy must not claim runtime performance relative to hand-written WebGPU (decision 0099, Consequences), and does not.

## Consequences

- The next steps, in the order the profile suggests: the cost of `ctx` reads and generated bindings (compiler), render bundles or a leaner encode loop for many individual draws, the physics adapter's allocations, the unminified runtime and the mount path.

## Verification

- Items 1 and 2 are measurements recorded in decision 0119; items 4 to 9 are statements about code that was read, and the profile numbers quoted are from `Profiler.start` over the frozen timing pass of the final code (development tooling, not published).
