# 0185. Particle draw budget

- Status: Accepted
- Date: 2026-10-24

Raise the global particle draw cap from 256 to 4096. The per-emitter simulation
pool stays at 64, so 64 full emitters can now be drawn without truncation.
The mirror and GPU billboard buffer remain lazy and reused; the larger buffer
uses 4096 instance records. Above the cap, W8210 still warns once and drawing
retains deterministic instance order. A renderer test fills 65 emitters and
checks the 4096 draws and single warning. This revises decisions 0155 and 0173.
