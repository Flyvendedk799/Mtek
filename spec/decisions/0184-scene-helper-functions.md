# 0184. Scene helper functions

- Status: Accepted
- Date: 2026-10-24

A scene may declare `cpu fn name(params) -> Type { ... }` using normal function
parameters and return rules. Helpers share the scene scope, can access its state
and named entities, and can call each other regardless of declaration order.
They are CPU functions because they capture the current scene context; pure
top-level functions remain available for reusable math and GPU work.

Resolution keeps helpers local to their scene. The IR and generated function
table use qualified symbols such as `src/main.mtek::Score.reset_round`, so two
scenes can use the same helper name. Existing effect, recursion, return and
single-writer checks apply. HUD Score uses one reset helper for its keyboard,
pause menu and game-over buttons.
