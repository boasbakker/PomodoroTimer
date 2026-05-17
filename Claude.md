# Core Principles

## Reload stability
Reloading the app via F5 must not change anything. It should be as if nothing happened.
- If the timer was running, it resumes from the correct time after the reload.
- If the tab was accidentally closed, reopening it restores the full timer state.
- All timer state is persisted to storage on every meaningful change (start, pause, resume, reset, transition).
- `workSessionsCompleted` is a lifetime counter — never reset it to zero.

- The timer should always beep until the user has started with their next session.