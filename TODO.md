# SHORT TERM TODO

- The pause beep (every minute, different thing) has a bug: either it doesn't work or its inaudible due to low volume.

# LONG TERM

1. Investigage the bug where most of the times, the audio does not play correctly on Zen, but in some circumstances, it does. Probably deterministic but still highly dependend on exact steps you do (e.g. reload the tab, reload the extension, close the tab, etc.) EDIT: has been fixed. Still interesting to look at: what caused the bug
2. Add automatic app+extension updating / **update available notification**. A release should be without any bugs.

## Configurable magic numbers

Hard-coded values that should become settings (per-profile or global) — currently buried as constants in [www/tab.js](www/tab.js):

- `IDLE_NUDGE_MS` (60 000) — interval between idle-nudge chimes when no timer is running.
- `alarmInterval` cadence (750 ms) — persistent end-of-session beep spacing.
- `alarmVibrationInterval` cadence (1500 ms) — vibration repeat rate during the persistent alarm.
- `titleFlashInterval` cadence (800 ms) — browser-title flash rate during the alarm.
- `tickTimer` cadence (200 ms) — main timer poll rate (probably should stay internal, but flagged).
- Idle-nudge sound design — frequencies (523.25 / 783.99 Hz), `triangle` waveform, peak gain 0.05, note duration ~200 ms with 120 ms offset between notes. Candidate for a "sound theme" setting.
- Alarm sound design — 880 Hz sine, peak gain 0.08, ~320 ms total. Same "sound theme" setting.

**Most of these should be global settings, but there can be a global setting to move these global settings into per profile settings under "Advanced". **