# Zen Pomodoro Tab

A Pomodoro timer browser extension for Zen (Firefox-based). It keeps a permanent, pinned tab in position #1 in every normal window.

## Load in Zen

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` from this folder.

## Behavior

- The Pomodoro tab is always pinned and moved to index 0.
- If it is closed, it re-opens in the same window.
- Timer state resets on browser restart, but profiles and stats persist.

## Features

- Profiles (multiple named work/break presets).
- Auto cycle: Work → Short Break → Long Break.
- Session stats for today.
- Sound alert on session end.

## Notes

- Profiles and stats are stored in the browser's extension storage.
- The legacy Python app (`pomodoro.py`) remains in this folder but is not required for the extension.
