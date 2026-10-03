//! Events (`spec/stdlib.md` section 5.1) and the `Key` enum (section 5.2).

use crate::stdlib::model::{
    EnumDef, EnumMember, EventDef, EventForm, EventHost, Milestone, TypeRef,
};

const KEY: TypeRef = TypeRef::Enum("Key");
const ANY_BODY: &[EventHost] = &[EventHost::Scene, EventHost::Entity, EventHost::Prefab];
const WITH_COLLIDER: &[EventHost] = &[EventHost::Entity, EventHost::Prefab];

/// Every event handlers can subscribe to.
pub(super) fn events() -> Vec<EventDef> {
    let key = |name, doc| EventDef {
        name,
        form: EventForm::Filter(KEY),
        hosts: ANY_BODY,
        requires_collider: false,
        since: Milestone::M3,
        doc,
    };
    let pointer = |name, doc| EventDef {
        name,
        form: EventForm::Parameter(TypeRef::Record("PointerEvent")),
        hosts: ANY_BODY,
        requires_collider: false,
        since: Milestone::M3,
        doc,
    };
    let collision = |name, doc| EventDef {
        name,
        form: EventForm::Parameter(TypeRef::EntityRef),
        hosts: WITH_COLLIDER,
        requires_collider: true,
        since: Milestone::M5,
        doc,
    };
    vec![
        key(
            "key_down",
            "Delivered when the filtered key transitions to pressed. Auto-repeat is ignored.",
        ),
        key("key_up", "Delivered when the filtered key is released."),
        pointer(
            "pointer_down",
            "A pointer button was pressed on the canvas.",
        ),
        pointer("pointer_up", "A pointer button was released."),
        pointer(
            "pointer_move",
            "The pointer moved; at most once per frame with the latest position.",
        ),
        collision(
            "collision_enter",
            "The entity's collider started touching another entity's collider; the parameter is the other entity.",
        ),
        collision(
            "collision_exit",
            "The entity's collider stopped touching another entity's collider; the parameter is the other entity.",
        ),
    ]
}

/// `(name, code)` of the keys. Letters and digits follow `KeyA`..`KeyZ` and `Digit0`..`Digit9`;
/// the remaining keys use their own name as the code.
const KEYS: [(&str, &str); 51] = [
    ("A", "KeyA"),
    ("B", "KeyB"),
    ("C", "KeyC"),
    ("D", "KeyD"),
    ("E", "KeyE"),
    ("F", "KeyF"),
    ("G", "KeyG"),
    ("H", "KeyH"),
    ("I", "KeyI"),
    ("J", "KeyJ"),
    ("K", "KeyK"),
    ("L", "KeyL"),
    ("M", "KeyM"),
    ("N", "KeyN"),
    ("O", "KeyO"),
    ("P", "KeyP"),
    ("Q", "KeyQ"),
    ("R", "KeyR"),
    ("S", "KeyS"),
    ("T", "KeyT"),
    ("U", "KeyU"),
    ("V", "KeyV"),
    ("W", "KeyW"),
    ("X", "KeyX"),
    ("Y", "KeyY"),
    ("Z", "KeyZ"),
    ("Digit0", "Digit0"),
    ("Digit1", "Digit1"),
    ("Digit2", "Digit2"),
    ("Digit3", "Digit3"),
    ("Digit4", "Digit4"),
    ("Digit5", "Digit5"),
    ("Digit6", "Digit6"),
    ("Digit7", "Digit7"),
    ("Digit8", "Digit8"),
    ("Digit9", "Digit9"),
    ("Space", "Space"),
    ("Enter", "Enter"),
    ("Escape", "Escape"),
    ("Tab", "Tab"),
    ("Backspace", "Backspace"),
    ("ShiftLeft", "ShiftLeft"),
    ("ShiftRight", "ShiftRight"),
    ("ControlLeft", "ControlLeft"),
    ("ControlRight", "ControlRight"),
    ("AltLeft", "AltLeft"),
    ("AltRight", "AltRight"),
    ("ArrowUp", "ArrowUp"),
    ("ArrowDown", "ArrowDown"),
    ("ArrowLeft", "ArrowLeft"),
    ("ArrowRight", "ArrowRight"),
];

/// The registry enums: `Key`.
pub(super) fn enums() -> Vec<EnumDef> {
    vec![EnumDef {
        name: "Key",
        members: KEYS
            .iter()
            .map(|&(name, code)| EnumMember {
                name,
                code,
                since: Milestone::M3,
            })
            .collect(),
        since: Milestone::M3,
        doc: "A physical keyboard key, independent of the keyboard layout. Maps from the DOM `KeyboardEvent.code`; events with any other code are ignored by the runtime.",
    }]
}
