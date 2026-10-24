# 0189. String equality for CPU message dispatch

- Status: Accepted
- Date: 2026-10-24

`==` and `!=` accept two strings and produce a boolean. Comparison is exact,
case-sensitive text equality without Unicode normalization. Empty strings are
valid. Constant evaluation and generated JavaScript agree; JavaScript uses
strict equality. Ordering, concatenation, mixed-type comparison and GPU strings
remain unsupported.

Entity messages (0180) carry strings, so handlers need to distinguish payloads
such as `shot`, `punch` and `finish`. The room-clearer example exercises this
through real combat, using a fixed pool of static character assemblies because
dynamic assembly spawning remains unsupported.
