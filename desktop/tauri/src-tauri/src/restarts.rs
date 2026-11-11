// How often the shell starts keyloom's server again after it stops (R2-09): after 1 s, then 5 s, then 15 s, and at most three times in
// ten minutes. A fourth stop inside that window means restarting isn't helping, so the shell shows the problem window instead.
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const WINDOW: Duration = Duration::from_secs(10 * 60);
const DELAYS: [Duration; 3] = [Duration::from_secs(1), Duration::from_secs(5), Duration::from_secs(15)];

#[derive(Default)]
pub struct Restarts {
    recent: VecDeque<Instant>,
}

impl Restarts {
    /// How long to wait before the next restart, or None when the cap is reached.
    pub fn next(&mut self, now: Instant) -> Option<Duration> {
        while self.recent.front().is_some_and(|&at| now.duration_since(at) >= WINDOW) {
            self.recent.pop_front();
        }
        let delay = *DELAYS.get(self.recent.len())?;
        self.recent.push_back(now);
        Some(delay)
    }

    /// The stops counted toward the cap, including the one that reached it.
    pub fn stops(&self) -> usize {
        self.recent.len() + 1
    }
}

/// Set once when the app quits. It wakes a restart that is waiting, so the supervisor never starts the server that quit is stopping:
/// that server would take the directory lock and announce itself, and an app restarted by an update could attach to it as it dies.
#[derive(Default)]
pub struct Quit {
    set: AtomicBool,
    wake: tokio::sync::Notify,
}

impl Quit {
    pub fn begin(&self) {
        self.set.store(true, Ordering::Release);
        self.wake.notify_waiters();
    }

    pub fn is_set(&self) -> bool {
        self.set.load(Ordering::Acquire)
    }

    /// Waits out a restart's delay. False when the app began quitting first, or had already begun.
    pub async fn wait(&self, delay: Duration) -> bool {
        let woken = self.wake.notified();
        tokio::pin!(woken);
        // Registered before the flag is read, so a quit between the two still wakes this wait.
        woken.as_mut().enable();
        if self.is_set() {
            return false;
        }
        tokio::select! {
            _ = woken => false,
            _ = tokio::time::sleep(delay) => !self.is_set(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn quitting_during_a_restart_wait_ends_it_at_once_with_no_restart() {
        let quit = Arc::new(Quit::default());
        let waiting = tokio::spawn({
            let quit = quit.clone();
            async move { quit.wait(Duration::from_secs(15)).await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        quit.begin();
        let restart = tokio::time::timeout(Duration::from_secs(2), waiting).await.expect("the wait ends with the quit").unwrap();
        assert!(!restart);
    }

    #[tokio::test]
    async fn a_wait_that_starts_after_quit_never_restarts() {
        let quit = Quit::default();
        quit.begin();
        let restart = tokio::time::timeout(Duration::from_secs(2), quit.wait(Duration::from_secs(15))).await.expect("returns at once");
        assert!(!restart);
    }

    #[tokio::test]
    async fn without_a_quit_the_wait_runs_its_delay_and_restarts() {
        assert!(Quit::default().wait(Duration::from_millis(10)).await);
    }

    #[test]
    fn backs_off_then_gives_up_after_three_restarts() {
        let start = Instant::now();
        let mut r = Restarts::default();
        assert_eq!(r.next(start), Some(Duration::from_secs(1)));
        assert_eq!(r.next(start + Duration::from_secs(30)), Some(Duration::from_secs(5)));
        assert_eq!(r.next(start + Duration::from_secs(60)), Some(Duration::from_secs(15)));
        assert_eq!(r.next(start + Duration::from_secs(90)), None);
        assert_eq!(r.stops(), 4);
    }

    #[test]
    fn stops_older_than_ten_minutes_no_longer_count() {
        let start = Instant::now();
        let mut r = Restarts::default();
        for n in 0..3 {
            assert!(r.next(start + Duration::from_secs(n)).is_some());
        }
        // Ten minutes after the first, that one has aged out: one slot frees, at the longest delay.
        assert_eq!(r.next(start + WINDOW), Some(Duration::from_secs(15)));
        // Long after, all have aged out and the delays start again.
        assert_eq!(r.next(start + WINDOW * 3), Some(Duration::from_secs(1)));
    }
}
