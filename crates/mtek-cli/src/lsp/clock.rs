//! The clock of the debounce (`spec/tooling.md` section 7, decision 0076 item 4).
//!
//! The server never reads the time itself: it asks a [`Clock`] for the milliseconds since the
//! server started. The real clock is [`SystemClock`]; tests use [`ManualClock`], which only
//! moves when told to, so that the debounce is tested without sleeping.

#[cfg(test)]
use std::cell::Cell;
#[cfg(test)]
use std::rc::Rc;
use std::time::Instant;

/// A source of monotonic milliseconds.
pub trait Clock {
    /// Milliseconds since the clock started; never decreases.
    fn now_ms(&self) -> u64;
}

/// The real clock: milliseconds since it was created.
#[derive(Debug)]
pub struct SystemClock {
    start: Instant,
}

impl SystemClock {
    pub fn new() -> Self {
        Self {
            start: Instant::now(),
        }
    }
}

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        u64::try_from(self.start.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
}

/// A clock that moves only through [`ManualClock::advance`] and [`ManualClock::set`]. Clones
/// share one time, so a test keeps a handle while the server owns another.
#[cfg(test)]
#[derive(Clone, Debug, Default)]
pub struct ManualClock {
    now: Rc<Cell<u64>>,
}

#[cfg(test)]
impl ManualClock {
    pub fn new() -> Self {
        Self::default()
    }

    /// Move the clock forward by `ms`.
    pub fn advance(&self, ms: u64) {
        self.now.set(self.now.get().saturating_add(ms));
    }

    /// Set the time; it never goes backwards (an earlier value is ignored).
    pub fn set(&self, ms: u64) {
        self.now.set(self.now.get().max(ms));
    }
}

#[cfg(test)]
impl Clock for ManualClock {
    fn now_ms(&self) -> u64 {
        self.now.get()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_manual_clock_moves_only_when_told_and_clones_share_time() {
        let clock = ManualClock::new();
        let other = clock.clone();
        assert_eq!(clock.now_ms(), 0);
        clock.advance(150);
        assert_eq!(other.now_ms(), 150);
        other.set(100);
        assert_eq!(clock.now_ms(), 150, "time never goes backwards");
        other.set(400);
        assert_eq!(clock.now_ms(), 400);
        clock.advance(u64::MAX);
        assert_eq!(clock.now_ms(), u64::MAX, "saturates");
    }

    #[test]
    fn the_system_clock_does_not_decrease() {
        let clock = SystemClock::new();
        let a = clock.now_ms();
        let b = clock.now_ms();
        assert!(b >= a);
    }
}
