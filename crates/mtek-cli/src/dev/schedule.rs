//! When `mtek dev` builds (`spec/tooling.md` section 4): once at start, then after every burst
//! of changes, one build at a time.
//!
//! - **Debounce.** After a change the scheduler waits until no further change has arrived for
//!   the debounce interval (50 ms), so an editor's save — often several events — is one build.
//! - **Serialised.** A build always runs to its end; changes that arrive meanwhile wait in the
//!   channel. When the build is done they are taken together, debounced like any burst, and
//!   cause exactly one follow-up build, however many there were.
//! - **Shutdown.** The scheduler returns when shutdown is signalled, but never in the middle
//!   of a build: a build that has started finishes and writes its output first.

use std::future::Future;
use std::time::Duration;

use tokio::sync::{mpsc, watch};

/// The debounce interval of `spec/tooling.md` section 4.
pub const DEBOUNCE: Duration = Duration::from_millis(50);

/// Resolves when `shutdown` becomes `true` or its sender is gone.
pub async fn stopped(mut shutdown: watch::Receiver<bool>) {
    let _ = shutdown.wait_for(|stop| *stop).await;
}

/// Run `build` once, then once per debounced burst of `changes`, until `shutdown` (or until the
/// change channel closes and no change is pending).
pub async fn run<B, F>(
    mut changes: mpsc::UnboundedReceiver<()>,
    shutdown: watch::Receiver<bool>,
    debounce: Duration,
    mut build: B,
) where
    B: FnMut() -> F,
    F: Future<Output = ()>,
{
    loop {
        if *shutdown.borrow() {
            return;
        }
        build().await;
        // Wait for the first change of the next burst (possibly one that arrived during the
        // build and is already queued).
        tokio::select! {
            biased;
            () = stopped(shutdown.clone()) => return,
            change = changes.recv() => if change.is_none() { return },
        }
        // Then until the burst is over.
        loop {
            tokio::select! {
                biased;
                () = stopped(shutdown.clone()) => return,
                change = tokio::time::timeout(debounce, changes.recv()) => match change {
                    Ok(Some(())) => {}
                    // The channel closed: build what is pending, then stop at the next wait.
                    Ok(None) | Err(_) => break,
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::Semaphore;

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    /// Wait until `count` has stayed the same for `quiet`, then return it.
    async fn settled(count: &AtomicUsize, quiet: Duration) -> usize {
        loop {
            let before = count.load(Ordering::SeqCst);
            tokio::time::sleep(quiet).await;
            if count.load(Ordering::SeqCst) == before {
                return before;
            }
        }
    }

    #[test]
    fn a_burst_of_changes_is_one_build() {
        runtime().block_on(async {
            let (sender, receiver) = mpsc::unbounded_channel();
            let (stop, shutdown) = watch::channel(false);
            let builds = Arc::new(AtomicUsize::new(0));
            let counter = Arc::clone(&builds);
            let task = tokio::spawn(run(
                receiver,
                shutdown,
                Duration::from_millis(200),
                move || {
                    let counter = Arc::clone(&counter);
                    async move {
                        counter.fetch_add(1, Ordering::SeqCst);
                    }
                },
            ));
            assert_eq!(
                settled(&builds, Duration::from_millis(400)).await,
                1,
                "initial build"
            );
            for _ in 0..10 {
                sender.send(()).unwrap();
            }
            assert_eq!(settled(&builds, Duration::from_millis(600)).await, 2);
            sender.send(()).unwrap();
            assert_eq!(settled(&builds, Duration::from_millis(600)).await, 3);
            stop.send(true).unwrap();
            tokio::time::timeout(Duration::from_secs(5), task)
                .await
                .unwrap()
                .unwrap();
        });
    }

    #[test]
    fn changes_during_a_build_cause_exactly_one_follow_up_build() {
        runtime().block_on(async {
            let (sender, receiver) = mpsc::unbounded_channel();
            let (stop, shutdown) = watch::channel(false);
            let builds = Arc::new(AtomicUsize::new(0));
            let running = Arc::new(AtomicUsize::new(0));
            // Each build waits for one permit, so the test decides when it ends.
            let gate = Arc::new(Semaphore::new(1));
            let (counter, active, permits) =
                (Arc::clone(&builds), Arc::clone(&running), Arc::clone(&gate));
            let task = tokio::spawn(run(receiver, shutdown, DEBOUNCE, move || {
                let (counter, active, permits) = (
                    Arc::clone(&counter),
                    Arc::clone(&active),
                    Arc::clone(&permits),
                );
                async move {
                    assert_eq!(
                        active.fetch_add(1, Ordering::SeqCst),
                        0,
                        "builds never overlap"
                    );
                    counter.fetch_add(1, Ordering::SeqCst);
                    permits.acquire().await.unwrap().forget();
                    active.fetch_sub(1, Ordering::SeqCst);
                }
            }));
            // The initial build takes the one permit and ends.
            assert_eq!(settled(&builds, Duration::from_millis(300)).await, 1);
            // The second build starts and blocks (no permit left).
            sender.send(()).unwrap();
            assert_eq!(settled(&builds, Duration::from_millis(300)).await, 2);
            assert_eq!(running.load(Ordering::SeqCst), 1);
            // Changes while it runs: nothing starts.
            for _ in 0..5 {
                sender.send(()).unwrap();
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert_eq!(settled(&builds, Duration::from_millis(300)).await, 2);
            // End the running build; let every later one end at once.
            gate.add_permits(100);
            assert_eq!(
                settled(&builds, Duration::from_millis(500)).await,
                3,
                "exactly one follow-up build"
            );
            stop.send(true).unwrap();
            tokio::time::timeout(Duration::from_secs(5), task)
                .await
                .unwrap()
                .unwrap();
        });
    }

    #[test]
    fn shutdown_waits_for_the_running_build() {
        runtime().block_on(async {
            let (sender, receiver) = mpsc::unbounded_channel();
            let (stop, shutdown) = watch::channel(false);
            let finished = Arc::new(AtomicUsize::new(0));
            let gate = Arc::new(Semaphore::new(1));
            let (done, permits) = (Arc::clone(&finished), Arc::clone(&gate));
            let task = tokio::spawn(run(receiver, shutdown, DEBOUNCE, move || {
                let (done, permits) = (Arc::clone(&done), Arc::clone(&permits));
                async move {
                    permits.acquire().await.unwrap().forget();
                    done.fetch_add(1, Ordering::SeqCst);
                }
            }));
            assert_eq!(settled(&finished, Duration::from_millis(300)).await, 1);
            sender.send(()).unwrap();
            tokio::time::sleep(Duration::from_millis(300)).await;
            stop.send(true).unwrap();
            tokio::time::sleep(Duration::from_millis(200)).await;
            assert!(!task.is_finished(), "the running build is not abandoned");
            gate.add_permits(1);
            tokio::time::timeout(Duration::from_secs(5), task)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(finished.load(Ordering::SeqCst), 2);
        });
    }

    #[test]
    fn a_closed_channel_ends_the_scheduler() {
        runtime().block_on(async {
            let (sender, receiver) = mpsc::unbounded_channel::<()>();
            let (_stop, shutdown) = watch::channel(false);
            drop(sender);
            let builds = Arc::new(AtomicUsize::new(0));
            let counter = Arc::clone(&builds);
            tokio::time::timeout(
                Duration::from_secs(5),
                run(receiver, shutdown, DEBOUNCE, move || {
                    let counter = Arc::clone(&counter);
                    async move {
                        counter.fetch_add(1, Ordering::SeqCst);
                    }
                }),
            )
            .await
            .unwrap();
            assert_eq!(builds.load(Ordering::SeqCst), 1);
        });
    }
}
