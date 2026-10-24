# 0180. Entity state changes through queued messages

- Status: Accepted
- Date: 2026-10-24

## Decision

Keep decision 0151's untyped `entity_ref` transform reads and reject direct writes.
A reference cannot prove its target's state types, bindings or body ownership.
Instead, `send(target, message)` queues a string for `on message(value: string)`
on that entity or prefab. The receiving handler can update its own typed state.

Messages are delivered in send order before the next unpaused scene update.
Delivery takes a snapshot: messages sent by a message handler wait for the next
update, preventing recursive delivery. References are checked both when sending
and delivering; pending spawns, pending removals, stale generations and dead
references are ignored. Messages belong to their world and do not survive a scene
change. Static and spawned entities use the same rules. Pausing defers delivery.

The initial payload is a string. Structured typed messages can extend this model
without permitting writes that bypass single-writer checks.

## ABI

`ctx.send(ref, text)` queues; `message` is an entity event with one string argument.
