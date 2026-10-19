# 0119. Uniform uploads: dirty slots that lie next to each other share one `writeBuffer`, bounded by the payload (K-04, step 1); a null result in frame time

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: §6.3; `spec/gpu-layout.md` section 8.1; decisions 0059 (arena uploads), 0099 (the counters this answers).
- Supersedes: the sentence of `spec/gpu-layout.md` section 8.1 that said `flush` makes one `writeBuffer` per dirty slot.

## Context

Decision 0099 item 3(a) found that Mtek made one `writeBuffer` per changed entity: 1,001 calls and 250 KiB per frame for 1,000 moving boxes (direct WebGPU: one call, 62.5 KiB), 301 calls for 300 physics bodies, 500 calls for 500 changing colours. Task K-04 asked for the uploads of a buffer to be coalesced into one `writeBuffer` over the dirty range, with the byte layout unchanged, and to be kept only if the frozen benchmark shows it helps. Statements are labelled **observation** (measured), **decision**.

## Decision

1. **Decision: `UniformArena.flush` merges dirty slots.** The dirty slots are visited in ascending order. A slot whose range `[slot x slotStride, + size)` starts at most `max(COALESCE_MIN_GAP_BYTES = 128, size)` bytes after the end of the previous dirty slot's range joins the previous `writeBuffer`; the call then carries the padding between the two ranges. Those bytes are read from the CPU mirror. The mirror equals the GPU copy for every slot that is not dirty (a released slot is the one exception: its mirror is zero while its GPU copy is stale, and nothing reads a free slot; allocation marks the slot dirty again), so afterwards the GPU buffer holds exactly what the mirror holds. Layouts, strides, offsets, the dynamic-offset and static-offset bind groups and the shader are untouched. `flush` still returns the number of dirty slots uploaded; the registry's `uploads` counts calls and `uploadBytes` the bytes of the calls, so after a merge `uploadBytes` includes padding.
2. **Observation: coalescing did not change the frame time on the test machine.** Measured with the frozen programs, Mtek side only, interleaved runs of the timing pass on one prepared site per variant (five repetitions, minimum of the p50 over the repetitions; the machine was shared and its load is recorded by the harness):

   | Workload | before step 1 | with step 1 (gap bound 1 KiB) | 
   | --- | --- | --- |
   | 1,000 changing transforms, p50 frame time | 1.015 ms | 0.990 ms |
   | 500 changing material params, p50 | 0.455 ms | 0.455 ms |

   and, on the final code, three variants of the bound (seven repetitions): no merge of slots with padding between them 0.330 ms and 0.495 ms (material params, transforms), a bound of 1 KiB 0.325 ms and 0.500 ms. The differences are inside the noise of the machine (about 0.02 ms). One call into the browser costs roughly what copying 250 bytes does, so merging two 16-byte parameter blocks on a 256-byte stride (240 bytes of padding) saves nothing and a bound of 1 KiB multiplied the bytes of that workload by 16 (7.8 KiB to 125 KiB per frame) for no gain.
3. **Decision: the bound is the payload.** Merging is limited so that a call carries at most about twice the bytes that changed (`max(128, size)` of padding): object blocks (128 bytes on a 256-byte stride, the bytes of neighbouring entities) merge, 16-byte parameter blocks do not. The effect on the counters of decision 0099: the 1,001 calls of the 1,000 moving boxes became 2 (one for the object arena, one for the instance buffer) in this step alone, and 1 after decision 0120 stopped writing object blocks that no draw reads; the 500 parameter-block calls stay 500 because merging them would add 15 times their bytes; the 301 calls of the physics scene became 1 after decision 0120.
4. **Observation: what the step is worth.** It removes API calls where the padding is small (the first upload of every object block of a scene, a run of moving neighbours, the initial blocks of a spawn burst) and it costs nothing; it is not a measurable speed-up on the frozen workloads, and the report must not describe it as one. It was kept because the unit and randomised tests below prove it correct and because it brings the call count of the object arena in line with what the task asked, not because it is faster.

## Consequences

- `spec/gpu-layout.md` section 8.1 describes the new rule; `uploads` is a count of calls, `uploadBytes` a count of the bytes of those calls (padding included when slots were merged).
- A device with a larger `minUniformBufferOffsetAlignment` has larger strides and merges less; one with a smaller stride merges more. Neither changes a byte the shader reads.

## Verification

- `gpu/uniform-arena.test.ts`: neighbouring dirty slots are one range and slots far apart are separate ranges; a range that covers a clean slot uploads the mirror's bytes for it and the GPU copy equals the mirror everywhere afterwards; 16-byte blocks on a 256-byte stride are not merged; the counters; offsets and sizes stay multiples of 4.
- `render/change-tracking.test.ts` (decision 0120) compares every live GPU buffer, byte for byte, of a tracked application with a reference one after every frame of random scripts.
