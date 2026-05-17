# Developer guide

This repo ships **one web UI** that runs as a Zen / Firefox extension *and* as a Capacitor Android app. You edit the UI in one place — [www/](www/) — and both targets pick it up.

## Project layout

```
Pomodoro_timer/
├── README.md
├── DEVELOPER.md             ← you are here
├── capacitor.config.json    Capacitor config; webDir is "www"
├── package.json             Capacitor + LocalNotifications deps
├── android/                 Capacitor-generated Android shell (consumes www/)
├── icons/icon.svg           canonical icon source
└── www/                     <-- single editable source for ALL UI + both wrappers
    ├── index.html           shared UI
    ├── tab.css              shared styles
    ├── tab.js               shared timer logic
    ├── icons/icon.svg
    ├── manifest.json        extension only (ignored by Capacitor)
    └── background.js        extension only (ignored by Capacitor)
```

Anything inside `www/` is shipped to Android automatically by `cap sync`. The two extension-specific files (`manifest.json`, `background.js`) live alongside the shared UI; Capacitor doesn't load them, and the Android WebView simply never references them.

## Editing the UI

Edit these and the change hits both targets:

- [www/index.html](www/index.html)
- [www/tab.css](www/tab.css)
- [www/tab.js](www/tab.js)

Platform-specific bits, for reference:

- [www/manifest.json](www/manifest.json) + [www/background.js](www/background.js) — extension-only; pin/position the tab.
- The `@capacitor/local-notifications` calls inside [www/tab.js](www/tab.js) (`getLN`, `scheduleEndNotif`, `cancelEndNotif`, `createChannel`) — Android-only. They no-op in the extension because `window.Capacitor` is undefined.

## Run as a browser extension (Zen / Firefox)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select [www/manifest.json](www/manifest.json).

The extension pins itself to the last pinned tab slot of every normal window and re-opens if you close it.

## Run as an Android app

Requires Node + Android Studio + a configured Android SDK.

```bash
npm install
npx cap sync android
npx cap open android
```

Then build / run from Android Studio onto an emulator or device. On Android 13+, accept the notification permission prompt at first launch so end-of-session notifications work.

If you change anything inside `www/`, re-run `npx cap sync android` before rebuilding.

## How the timer is wired

Timer state lives in the `state` object near the top of [www/tab.js](www/tab.js). The interval at `startTicking()` checks `Date.now()` against `state.endTime` every 200 ms — this means a throttled / suspended tab still ends sessions at the right wall-clock moment, and the visibility-change handler catches up on any sessions that elapsed while the tab was hidden.

Two notifications are scheduled in advance on Android (current session end + next session end), so a session chain still rings even if the JS isn't running to schedule the next one when the current one ends. After any transition the next-after-that notification is queued.

## Known constraints

- The currently-running session is in-memory only; refreshing the tab or killing the Android app resets it. Profiles and today's stats persist via `localStorage`.
- The alarm-until-dismissed loop only sustains while the app/tab is open. On Android, the LocalNotification fires at the scheduled moment even if the app is closed, but it can't ring indefinitely — that would require a foreground service, which this app deliberately doesn't run.
- `localStorage` is also what backs the Capacitor WebView's storage on Android, so the small `api.storage.local` shim at the top of [www/tab.js](www/tab.js) works identically on both targets.

**Design principles:**
- Reloading the tab or closing the app should impair functionality as little as possible
- There is no "+1 minute" button, only a "-1 minute" button. This is intentional. 
- If really needed, something like this can be enabled in the settings with a maximum of 20% of the original time for work or a max of 50% extra for break or smth, but this is for later. 