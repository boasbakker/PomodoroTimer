# Zen Pomodoro

A Pomodoro timer that runs in two places from one codebase:

- A **browser extension** for Zen / Firefox that lives in a permanent pinned tab.
- An **Android app** built with Capacitor.

Both targets share the same UI in [www/](www/). See [DEVELOPER.md](DEVELOPER.md) for how to build, run, and edit either side.

## Features

- Named profiles (work / short break / long break / long-break frequency).
- Auto cycle: Work → Short Break (× N) → Long Break.
- Today's session count.
- Sound alarm on session end — keeps ringing until you press and hold any control for 3 seconds.
- Android: end-of-session local notifications.
- Browser extension: pinned-first tab that re-opens itself when closed.

## Persistence

Profiles, today's stats, and the sound toggle are stored in `localStorage`. The currently-running timer is in memory only and resets if you fully restart the browser or kill the Android app.
