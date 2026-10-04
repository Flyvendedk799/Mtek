//! The build events of `/__mtek/events` (`spec/runtime-abi.md` section 11.1) and the hub that
//! hands them to every connected client.
//!
//! An event is one JSON object, sent as one `data: <JSON>` frame: `{"type":"build-started"}`,
//! `{"type":"build-failed","diagnostics":[…]}` or
//! `{"type":"build-succeeded","buildId":"…","program":"/app.js?build=…"}`.
//!
//! A client that connects while the latest event is `build-failed` receives that event first
//! (decision 0033): a page opened or reloaded after a failed build shows its diagnostics at
//! once instead of waiting for the next build. No other event is replayed — replaying
//! `build-succeeded` would make every page reload forever.

use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Value, json};
use tokio::sync::broadcast;

/// How many events a slow client may fall behind before it skips some.
const CAPACITY: usize = 64;

/// One build event.
#[derive(Clone, Debug, PartialEq)]
pub enum BuildEvent {
    /// A build began.
    Started,
    /// A build ended with errors: the diagnostic envelopes (`spec/diagnostics.md` section 2.1).
    Failed { diagnostics: Value },
    /// A build was written to the output directory.
    Succeeded { build_id: String },
}

impl BuildEvent {
    /// The JSON text of the event's `data:` line (compact: never contains a line break).
    pub fn to_json(&self) -> String {
        let value = match self {
            BuildEvent::Started => json!({ "type": "build-started" }),
            BuildEvent::Failed { diagnostics } => {
                json!({ "type": "build-failed", "diagnostics": diagnostics })
            }
            BuildEvent::Succeeded { build_id } => json!({
                "type": "build-succeeded",
                "buildId": build_id,
                "program": format!("/app.js?build={build_id}"),
            }),
        };
        value.to_string()
    }
}

/// The latest state and the channel to the connected clients, behind one lock so that a
/// client that subscribes never misses an event nor receives one twice.
#[derive(Debug)]
struct State {
    sender: broadcast::Sender<Arc<str>>,
    /// The JSON of the latest event if it was `build-failed`.
    replay: Option<Arc<str>>,
}

/// Fans the build events out to the clients of `/__mtek/events`.
#[derive(Debug)]
pub struct Hub {
    state: Mutex<State>,
}

impl Default for Hub {
    fn default() -> Self {
        let (sender, _) = broadcast::channel(CAPACITY);
        Hub {
            state: Mutex::new(State {
                sender,
                replay: None,
            }),
        }
    }
}

impl Hub {
    /// Send `event` to every connected client.
    pub fn publish(&self, event: &BuildEvent) {
        let text: Arc<str> = Arc::from(event.to_json());
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.replay = matches!(event, BuildEvent::Failed { .. }).then(|| Arc::clone(&text));
        // No receiver is not an error: nobody is connected.
        let _ = state.sender.send(text);
    }

    /// A new client: the event to send first, if any, and the stream of later events.
    pub fn subscribe(&self) -> (Option<Arc<str>>, broadcast::Receiver<Arc<str>>) {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        (state.replay.clone(), state.sender.subscribe())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_are_the_objects_of_the_protocol() {
        assert_eq!(BuildEvent::Started.to_json(), r#"{"type":"build-started"}"#);
        let failed = BuildEvent::Failed {
            diagnostics: json!([{ "code": "MTEK-E1001", "message": "a\nb" }]),
        };
        assert_eq!(
            failed.to_json(),
            r#"{"type":"build-failed","diagnostics":[{"code":"MTEK-E1001","message":"a\nb"}]}"#
        );
        assert!(!failed.to_json().contains('\n'), "one data line per event");
        assert_eq!(
            BuildEvent::Succeeded {
                build_id: "ab12".to_owned()
            }
            .to_json(),
            r#"{"type":"build-succeeded","buildId":"ab12","program":"/app.js?build=ab12"}"#
        );
    }

    #[test]
    fn only_a_failure_is_replayed_to_new_clients() {
        let hub = Hub::default();
        assert_eq!(hub.subscribe().0, None);
        let failed = BuildEvent::Failed {
            diagnostics: json!([]),
        };
        hub.publish(&failed);
        assert_eq!(
            hub.subscribe().0.as_deref(),
            Some(failed.to_json().as_str())
        );
        hub.publish(&BuildEvent::Started);
        assert_eq!(hub.subscribe().0, None);
        hub.publish(&failed);
        hub.publish(&BuildEvent::Succeeded {
            build_id: "x".to_owned(),
        });
        assert_eq!(hub.subscribe().0, None);
    }

    #[test]
    fn subscribers_receive_every_later_event_once() {
        let hub = Hub::default();
        let (_, mut first) = hub.subscribe();
        hub.publish(&BuildEvent::Started);
        let (replay, mut second) = hub.subscribe();
        assert_eq!(replay, None);
        hub.publish(&BuildEvent::Succeeded {
            build_id: "x".to_owned(),
        });
        assert_eq!(&*first.try_recv().unwrap(), r#"{"type":"build-started"}"#);
        assert!(first.try_recv().unwrap().contains("build-succeeded"));
        assert!(second.try_recv().unwrap().contains("build-succeeded"));
        assert!(first.try_recv().is_err() && second.try_recv().is_err());
    }
}
