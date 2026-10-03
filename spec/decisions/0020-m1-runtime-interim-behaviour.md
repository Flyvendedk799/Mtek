# 0020. M1 runtime: interim behaviour where a later task is not ready

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §7.4 (device loss); `spec/runtime-abi.md` §9.4.

## Context

`spec/runtime-abi.md` §9.4 specifies bounded recovery from device loss (`state = recovering`, three rebuild attempts, `W8061`, `E8062`). That is task M4-09; the M1 runtime (task M1-14) has nothing to rebuild yet but the surface and the startup shader modules.

## Decision

**Device loss is terminal until M4-09. (proposal)** On `device.lost` with a reason other than `"destroyed"` the M1 runtime reports `W8060` (phase `runtime:device`, with a note that recovery arrives with M4-09), sets `state = "failed"`, stops the frame loop and shows the overlay. `dispose()` still works. The `recovering` state, `W8061` and `E8062` are never produced in M1.

## Consequences

This decision is superseded by the record that accompanies M4-09.

## Verification

`src/host/app.test.ts` (device loss: `W8060`, state `failed`, overlay, loop stopped, still disposable).
