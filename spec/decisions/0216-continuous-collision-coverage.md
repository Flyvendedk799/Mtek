# 0216 — Continuous collision coverage

Status: implemented; browser acceptance of the changed spec pending (run by the orchestrator). Date: 2026-10-27.
Extends 0068, 0193 and 0214 (acceptance item 7).

## Why

Decision 0193 added `physics: { continuousCollision: true }`, which sets Rapier's
sweep flag on every dynamic body, and showed one case stopped: a 240 m/s ball
against a 0.1 m plate, in an adapter test that flagged only the ball. Through the
mounted host lanes D06 (9 m/s from 3.065 m) and D08 (12 m/s from 3.24 m) of the
fixture `physics_tunnel` still flew through their 10 000 kg plate, as did D10, D12,
D14 and D16 (the lanes the discrete window lets through). Decision 0214 item 7
asks for a published lane matrix with no tunnelling inside its stated envelope,
or an envelope that excludes the failures with a measured, explained cause.

## Findings (Rapier 0.21.0, fixed step 1/60 s; every number is in the evidence file)

1. **A flagged obstacle is never swept against.** Reproduced on the real engine
   with the geometry, masses, step and phases of D06: ball flagged and plate not,
   the ball stops at x = 4.90; both flagged, it ends at 21.065 (flies on at 9 m/s).
   A flagged plate at rest, or one moving 0.05 m/s, is skipped; the same plate
   without the flag stops the ball. The host flagged every dynamic body, so the
   pairs that need the sweep (a fast ball and a dynamic plate) were exactly the
   ones that lost it. This also explains decision 0068 item 9 ("`setCcdEnabled(true)`
   on dynamic bodies did not fail the tunnelling spec"). A head-on pair of two
   fast flagged bodies is skipped for the same reason (measured).
2. **The sweep leaves a 5 mm band.** Rapier's `normalizedAllowedLinearError` (5 mm)
   is used twice by the sweep: a swept body is stopped 5 mm inside the obstacle,
   and a pair whose surfaces are between the prediction distance (20 mm) and
   prediction + 5 mm apart is left to the discrete contact test, which only sees
   pairs below 20 mm. A cube that starts a step in that band is seen by neither
   (static wall or plate, flag on or off: 5 % of the start phases at 6 m/s, 1.5 %
   at 20 m/s). Spheres and capsules have no such band. The 5 mm penetration also
   lets the contact step carry a 240 m/s ball (5.1 cm; 2.5 cm at 120 m/s) through
   a 0.01 m heavy plate. Fine scans with the allowed error at 5, 2, 1, 0.5, 0.1,
   0.01 and 0.001 mm: the band width follows the value (the 240 m/s case is
   stopped from 2 mm down).
3. **Parameters that do nothing useful.** In the `-compat` 0.21.0 build the
   integration parameters are `normalizedAllowedLinearError`,
   `normalizedPredictionDistance`, `lengthUnit`, `numSolverIterations`,
   `numInternalPgsIterations` and `maxCcdSubsteps` (`allowedLinearError`,
   `predictionDistance` and `erp` read `undefined` and setting them does nothing).
   `maxCcdSubsteps = 8` made the 240 m/s thin-plate case worse (the ball ended
   2.5 mm past the plate's midplane after the first step); 16 solver iterations
   kept it 5 mm short of the midplane, no more; the prediction distance changes
   the discrete model and was not touched. A collider contact skin widens the
   discrete range: 5 mm closes the band (0 of 1 800 cube lanes, flag on, and with a
   20 mm skin also with the flag off) but would keep resting surfaces 1 cm apart
   (twice the skin; the offset itself was not measured at that size).
4. **Moving obstacles.** The sweep treats the other body as still at its pose at
   the start of the step, so its own advance in that step is not covered, and a
   dynamic obstacle that itself moves fast is flagged and therefore skipped
   (finding 1). Kinematic walls cannot be flagged.

## Decision

**Adapter** (`packages/physics-rapier/src/backend.ts`, body creation and world
parameters only; behaviour with continuous collision off is untouched):

- The sweep flag is set before every step, per body, only when the body moves
  more than its smallest half-extent plus 12.5 mm in that step (linear plus
  angular), and cleared otherwise. A slower body cannot skip a plate at rest, and
  an obstacle that is slow or at rest stays sweepable. The 12.5 mm is a narrow
  window, derived from two bounds and found by a dense scan: 11.5 mm lets 1 m/s
  dynamic plates through at shot speeds of 3.75 to 14 m/s, 13 mm lets 1 m/s walls
  through at 3.75 m/s, 12 and 12.5 mm leave nothing inside the envelope; 20 mm
  (the first attempt) passes the nine matrix speeds and fails the edge scan.
- A world with a continuous body sets `normalizedAllowedLinearError` to 0.1 mm,
  and the collider of a continuous body gets a contact skin of 0.2 mm. The skin
  covers the 0.1 mm band that is left (3 of 9 000 cube lanes at 20.0 to 20.1 mm
  without it). Resting surfaces are 0.2 mm apart against static geometry and
  0.4 mm between two continuous bodies; a stack of four crates stands 1.4 mm higher.
  Worlds without continuous collision keep every Rapier default and no skin.

**Matrix** (`packages/physics-rapier/src/ccd-lanes.ts`, shared by the test and the
script). Shots of 1 kg flying along +x without gravity: sphere r 0.05 m, cube
0.1 m, capsule r 0.05 m and 0.3 m high (broadside). Speeds 3, 6, 9, 12, 20, 40,
60, 120, 240 m/s; 16 start phases (the first sample falls `(i + 0.5) / 16` of a
closing step off the grid); plates 4 m x 4 m of 0.01, 0.05 and 0.1 m. A lane
tunnels when the shot's centre ends beyond the plate's centre. Obstacles of the
envelope: static; kinematic wall at 1 m/s toward and away; dynamic plate of
10 000 kg (the D06 setup) and of 1 kg, at rest. Probes around the edge: kinematic
walls moving 3, 6, 12 m/s toward and 3, 6 m/s away; dynamic plates moving 0.5 to
12 m/s toward. Three more scans that the matrix cannot replace: the **fine scan**
(500 phases per cell, static wall and heavy plate, 6, 12, 60, 240 m/s, flag off
and on, with the gap at which the missed lanes started), the **edge scan** (every
0.25 m/s from 1.5 to 14 m/s against six obstacles of 1 m/s or less) and the
**speed probes** (250 to 3 000 m/s).

**Outputs.** `evidence/movement/ccd-lanes.json` (deterministic, no paths) and the
table between `<!-- ccd-lanes:begin -->` and `<!-- ccd-lanes:end -->` in
`spec/physics.md` section 7.1 are written by `npm run ccd:write`
(`packages/physics-rapier/scripts/measure-ccd-lanes.ts`, Node type stripping, runs
`src/backend.ts` itself). `npm run ccd:check` fails when either differs from a
fresh measurement (about one minute); it is not wired into `npm run check`.

## The published envelope (continuous collision on)

No lane tunnels in 6 480 matrix lanes (5 obstacles x 9 speeds x 3 shapes x 3
thicknesses x 16 phases), 43 920 edge-scan lanes, 36 000 fine-scan lanes, and
none of the plates at rest in the speed probes up to 3 000 m/s, for the shots and
obstacles above; lanes D00 to D16 with the flag on every dynamic body are all
stopped (D06 and D08 included). With the flag off the same matrix reproduces the
documented discrete findings (the window model; 100 % tunnelling at 240 m/s
against the plates and the kinematic walls).

Outside it, as measured: obstacles that move on their own faster than 1 m/s
toward the shot (2 m/s was tested: dynamic plates are passed in 4 to 35 % of the
lanes, a kinematic wall at 3 m/s in up to 19 %, at 12 m/s in 90 to 100 %; dynamic
plates at 6 and 12 m/s gain under 1 % over the discrete mode); a sphere against a
plate that moves 1 m/s toward it from 255 m/s (0.01 m plate) and 400 m/s (0.05
m plate); and everything not measured: other fixed steps, shots smaller than 0.05
m, oblique or spinning shots, two fast bodies meeting, several obstacles in one
step, gravity. Teleports stay unswept (tested: a body teleported across a wall
is not stopped, with the flag on).

A correction to `spec/physics.md` 7.1 as it stood: "against a static wall nothing
was ever seen to pass" was measured on balls only. With the flag off a **cube**
passes a static wall in 97 of 6 000 fine-scan lanes, all starting 20 to 25 mm in
front of it.

## Tests

`packages/physics-rapier/src/ccd-matrix.test.ts` (23 tests): the envelope per
obstacle, the edge scan, the speed limit, the fine scan, the limits (moving
obstacles still tunnel), the flag-off findings (window model within 1.6 lanes of
16, balls and capsules never pass a static wall), lanes D00 to D16 with the flag
on every body and the flag-off passes (D06, D08, D10, D12, D14, D16 unchanged),
teleports, resting contacts, and equality of the committed evidence and the
table with a fresh measurement. Mutations applied by hand and reverted: the flag
always on fails 7 tests (D lanes, dynamic obstacles, edge and fine scans); no
allowed-error change fails 8; no contact skin fails only the fine scan; a flag
margin of 20 mm fails only the edge scan, which is why that scan exists.

The browser spec `tests/browser/specs/m5/physics-tunnelling.spec.ts` changed in
one test: "opt-in CCD retains a reproducible moving-body limitation" (asserted that
D06 flew on to x = 21.07) became "continuous collision stops every lane against the
dynamic plates, D06 and D08 included" and asserts that all 17 D balls end on the
near side of their plate (between 4.80 and 4.95). The other test (flag off, the
window model) is unchanged. It was not run here.

## Consequences

- Hosts that enabled `continuousCollision` get stopped lanes where the option had
  no effect; a stack of crates stands about 0.4 mm per contact higher; the cost is
  one `linvel`/`angvel` read per dynamic body per step (nothing without the option).
- `crates/mtek-cli/prebuilt/physics.js` is a bundle of this adapter: it must be
  regenerated (`npm run build`, `npm run prebuilt:write`) before `check:prebuilt`
  passes. `docs/limitations.md` and `tools/release-docs/data/limitations.json`
  still describe the 0193 state ("a regression covers 240 m/s against that plate")
  and are decision 0218's to update.
- The matrix is one geometry (broadside, normal incidence, 1 kg shots, one step).
  Rapier version changes should rerun `npm run ccd:write` and review the diff; the
  flag margin and the two parameters are tuned to 0.21.0.
