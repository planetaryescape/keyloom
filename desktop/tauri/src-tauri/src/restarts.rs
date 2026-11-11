// How often the shell starts keyloom's server again after it stops (R2-09): after 1 s, then 5 s, then 15 s, and at most three times in
// ten minutes. A fourth stop inside that window means restarting isn't helping, so the shell shows the problem window instead.
use std::collections::VecDeque;
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

#[cfg(test)]
mod tests {
    use super::*;

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
