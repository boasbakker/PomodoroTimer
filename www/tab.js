const api = { storage: { local: {
    async get(keys) {
        const out = {};
        for (const k of keys) {
            const v = localStorage.getItem(k);
            if (v !== null) {
                try { out[k] = JSON.parse(v); } catch { out[k] = v; }
            }
        }
        return out;
    },
    async set(obj) {
        for (const [k, v] of Object.entries(obj)) {
            localStorage.setItem(k, JSON.stringify(v));
        }
    },
} } };

const NOTIF_ID_CURRENT = 1;
const NOTIF_ID_NEXT = 2;
const NOTIF_CHANNEL_ID = "pomodoro";

function getLN() {
    if (window.LocalNotifications) return window.LocalNotifications;
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        return window.Capacitor.Plugins.LocalNotifications;
    }
    return null;
}

function bodyForEndOf(mode) {
    return mode === "work" ? "Work session complete." : "Break over.";
}

async function scheduleNotifs(currentAt, currentMode, nextAt, nextMode) {
    const LN = getLN();
    if (!LN) return;
    try {
        await LN.cancel({ notifications: [{ id: NOTIF_ID_CURRENT }, { id: NOTIF_ID_NEXT }] });
        const notifications = [
            {
                id: NOTIF_ID_CURRENT,
                title: "Zen Pomodoro",
                body: bodyForEndOf(currentMode),
                schedule: { at: new Date(currentAt) },
                channelId: NOTIF_CHANNEL_ID,
            },
        ];
        if (nextAt && nextMode) {
            notifications.push({
                id: NOTIF_ID_NEXT,
                title: "Zen Pomodoro",
                body: bodyForEndOf(nextMode),
                schedule: { at: new Date(nextAt) },
                channelId: NOTIF_CHANNEL_ID,
            });
        }
        await LN.schedule({ notifications });
    } catch (e) {}
}

async function cancelAllNotifs() {
    const LN = getLN();
    if (!LN) return;
    try {
        await LN.cancel({ notifications: [{ id: NOTIF_ID_CURRENT }, { id: NOTIF_ID_NEXT }] });
    } catch (e) {}
}

const DEFAULT_PROFILES = [
    {
        name: "Classic 25/3/25",
        topText: "Customizable Pomodoro timer",
        workMin: 25,
        shortBreakMin: 3,
        longBreakEvery: 4,
        longBreakMin: 25,
        alarmHoldSec: 3,
    },
    {
        name: "Deep 50/6/25",
        topText: "Customizable Pomodoro timer",
        workMin: 50,
        shortBreakMin: 6,
        longBreakEvery: 2,
        longBreakMin: 25,
        alarmHoldSec: 3,
    },
];

const STORAGE_KEYS = {
    profiles: "profiles",
    selectedProfile: "selectedProfile",
    timerState: "timerState",
    plusOneTokens: "plusOneTokens",
    totalWorkMs: "totalWorkMs",
};

const IDLE_NUDGE_MS = 60_000;
const IDLE_NUDGE_PEAK_GAIN = 0.25;

const ALARM_RAMP_FRACTION = 0.10;
const ALARM_PEAK_GAIN_MIN = 0.07;
const ALARM_PEAK_GAIN_MAX = 1.00;

const PLUS_ONE_BASE_TOKENS = 4;
const PLUS_ONE_DAILY_BUDGET = 18 * PLUS_ONE_BASE_TOKENS;
const PLUS_ONE_COST_ALARM = 2 * PLUS_ONE_BASE_TOKENS;
const PLUS_ONE_COST_BREAK = PLUS_ONE_BASE_TOKENS / 4;
const PLUS_ONE_ADD_MS = 60_000;

const state = {
    running: false,
    paused: false,
    mode: "work",
    workSessionsCompleted: 0,
    remainingMs: 0,
    endTime: 0,
    activeProfile: null,
    awaitingDismissal: false,
    extensionMs: 0,
    workSegmentStart: null,
    alarmRampStartTime: 0,
    alarmRampDurationMs: 0,
};

let totalWorkMs = 0;

let plusOneState = { date: null, tokens: PLUS_ONE_DAILY_BUDGET };

const els = {
    topTextDisplay: document.getElementById("topTextDisplay"),
    todayLine: document.getElementById("todayLine"),
    workedTotal: document.getElementById("workedTotal"),
    modeLabel: document.getElementById("modeLabel"),
    timeLeft: document.getElementById("timeLeft"),
    statusLine: document.getElementById("statusLine"),
    messageLine: document.getElementById("messageLine"),
    progressRing: document.getElementById("progressRing"),
    toggleBtn: document.getElementById("toggleBtn"),
    resetBtn: document.getElementById("resetBtn"),
    resetLabel: document.querySelector("#resetBtn .hold-btn-label"),
    shorterBtn: document.getElementById("shorterBtn"),
    plusOneBtn: document.getElementById("plusOneBtn"),
    plusOneRemaining: document.getElementById("plusOneRemaining"),
    alarmStartBtn: document.getElementById("alarmStartBtn"),
    confirmModal: document.getElementById("confirmModal"),
    confirmTitle: document.getElementById("confirmTitle"),
    confirmMessage: document.getElementById("confirmMessage"),
    confirmOkBtn: document.getElementById("confirmOkBtn"),
    confirmCancelBtn: document.getElementById("confirmCancelBtn"),
    profileList: document.getElementById("profileList"),
    newProfileBtn: document.getElementById("newProfileBtn"),
    defaultsBtn: document.getElementById("defaultsBtn"),
    profileModal: document.getElementById("profileModal"),
    modalTitle: document.getElementById("modalTitle"),
    modalError: document.getElementById("modalError"),
    modalSaveBtn: document.getElementById("modalSaveBtn"),
    modalCancelBtn: document.getElementById("modalCancelBtn"),
    modalDeleteBtn: document.getElementById("modalDeleteBtn"),
    nameInput: document.getElementById("nameInput"),
    topTextInput: document.getElementById("topTextInput"),
    workInput: document.getElementById("workInput"),
    shortBreakInput: document.getElementById("shortBreakInput"),
    longEveryInput: document.getElementById("longEveryInput"),
    longBreakInput: document.getElementById("longBreakInput"),
    alarmHoldInput: document.getElementById("alarmHoldInput"),
    longEveryInfo: document.getElementById("longEveryInfo"),
};

let profiles = [];
let tickTimer = null;
let audioContext = null;

let alarmActive = false;
let alarmInterval = null;
let alarmVibrationInterval = null;
let titleFlashInterval = null;
let titleFlashOn = false;
let audioPrimerInstalled = false;
let idleNudgeInterval = null;

let selectedProfileName = null;
let modalMode = null;
let modalEditingName = null;

function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function todayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function modeLabel(mode) {
    if (mode === "short_break") {
        return "Short Break";
    }
    if (mode === "long_break") {
        return "Long Break";
    }
    return "Work";
}

function getDurationMs(profile, mode) {
    if (!profile) {
        return 0;
    }
    if (mode === "short_break") {
        return profile.shortBreakMin * 60 * 1000;
    }
    if (mode === "long_break") {
        return profile.longBreakMin * 60 * 1000;
    }
    return profile.workMin * 60 * 1000;
}

function nextModeAfter(profile, currentMode, currentWorkSessions) {
    if (currentMode === "work") {
        const newWorkSessions = currentWorkSessions + 1;
        if (newWorkSessions % profile.longBreakEvery === 0) {
            return "long_break";
        }
        return "short_break";
    }
    return "work";
}

function setMessage(text) {
    els.messageLine.textContent = text || "";
}

function getProfileFromFields() {
    const name = els.nameInput.value.trim();
    const topText = els.topTextInput.value.trim() || "Customizable Pomodoro timer";
    const workMin = Number.parseInt(els.workInput.value, 10);
    const shortBreakMin = Number.parseInt(els.shortBreakInput.value, 10);
    const longBreakEvery = Number.parseInt(els.longEveryInput.value, 10);
    const longBreakMin = Number.parseInt(els.longBreakInput.value, 10);
    const alarmHoldSec = Number.parseInt(els.alarmHoldInput.value, 10);

    if (!name) {
        return null;
    }
    if (!Number.isFinite(workMin) || workMin <= 0) {
        return null;
    }
    if (!Number.isFinite(shortBreakMin) || shortBreakMin <= 0) {
        return null;
    }
    if (!Number.isFinite(longBreakEvery) || longBreakEvery <= 0) {
        return null;
    }
    if (!Number.isFinite(longBreakMin) || longBreakMin <= 0) {
        return null;
    }
    if (!Number.isFinite(alarmHoldSec) || alarmHoldSec < 1 || alarmHoldSec > 30) {
        return null;
    }

    return {
        name,
        topText,
        workMin,
        shortBreakMin,
        longBreakEvery,
        longBreakMin,
        alarmHoldSec,
    };
}

function loadProfileFields(profile) {
    if (!profile) {
        return;
    }
    els.nameInput.value = profile.name;
    els.topTextInput.value = profile.topText !== undefined ? profile.topText : "Customizable Pomodoro timer";
    els.workInput.value = String(profile.workMin);
    els.shortBreakInput.value = String(profile.shortBreakMin);
    els.longEveryInput.value = String(profile.longBreakEvery);
    els.longBreakInput.value = String(profile.longBreakMin);
    els.alarmHoldInput.value = String(profile.alarmHoldSec ?? 3);
}

function renderProfileList() {
    els.profileList.innerHTML = "";
    for (const profile of profiles) {
        const li = document.createElement("li");
        li.className = "profile-list-item";
        if (profile.name === selectedProfileName) {
            li.classList.add("selected");
        }

        const info = document.createElement("div");
        info.className = "profile-info";

        const name = document.createElement("div");
        name.className = "profile-name";
        name.textContent = profile.name;

        const summary = document.createElement("div");
        summary.className = "profile-summary";
        summary.textContent = `${profile.workMin} / ${profile.shortBreakMin} / ${profile.longBreakMin} min · long every ${profile.longBreakEvery}`;

        info.appendChild(name);
        info.appendChild(summary);

        const editBtn = document.createElement("button");
        editBtn.className = "btn ghost profile-edit-btn";
        editBtn.type = "button";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openProfileModal("edit", profile);
        });

        li.appendChild(info);
        li.appendChild(editBtn);

        li.addEventListener("click", () => {
            selectProfile(profile.name);
        });

        els.profileList.appendChild(li);
    }
}

async function selectProfile(name) {
    const profile = profiles.find((p) => p.name === name);
    if (!profile) return;
    if (name === selectedProfileName) return;
    if (state.running || state.paused || state.awaitingDismissal) {
        const ok = await openConfirm({
            title: "Switch profile?",
            message: "This will reset the current session.",
            confirmLabel: "Switch & reset",
            danger: true,
        });
        if (!ok) return;
    }
    selectedProfileName = name;
    api.storage.local.set({ [STORAGE_KEYS.selectedProfile]: name });
    resetTimer();
    renderProfileList();
}

function openConfirm({ title, message, confirmLabel = "Confirm", danger = false }) {
    return new Promise((resolve) => {
        els.confirmTitle.textContent = title;
        els.confirmMessage.textContent = message;
        els.confirmOkBtn.textContent = confirmLabel;
        els.confirmOkBtn.classList.toggle("danger", danger);
        els.confirmModal.hidden = false;

        const cleanup = (result) => {
            els.confirmModal.hidden = true;
            els.confirmOkBtn.removeEventListener("click", onOk);
            els.confirmModal.removeEventListener("click", onClose);
            document.removeEventListener("keydown", onKey);
            resolve(result);
        };
        const onOk = () => cleanup(true);
        const onClose = (e) => {
            if (e.target instanceof Element && e.target.hasAttribute("data-confirm-close")) cleanup(false);
        };
        const onKey = (e) => { if (e.key === "Escape") cleanup(false); };

        els.confirmOkBtn.addEventListener("click", onOk);
        els.confirmModal.addEventListener("click", onClose);
        document.addEventListener("keydown", onKey);
    });
}

function formatTotalWorked(ms) {
    const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days > 0) {
        return `${days}d ${hours}h`;
    }
    if (totalHours > 0) {
        return `${totalHours}h`;
    }
    return `${totalMinutes}m`;
}

function getLiveTotalWorkMs() {
    if (state.workSegmentStart) {
        const cap = state.endTime > 0 ? Math.min(Date.now(), state.endTime) : Date.now();
        return totalWorkMs + Math.max(0, cap - state.workSegmentStart);
    }
    return totalWorkMs;
}

function persistTotalWorkMs() {
    api.storage.local.set({ [STORAGE_KEYS.totalWorkMs]: totalWorkMs });
}

function beginWorkSegment() {
    if (!state.running || state.mode !== "work" || state.awaitingDismissal) {
        return;
    }
    if (state.workSegmentStart) {
        return;
    }
    state.workSegmentStart = Date.now();
    persistState();
}

function endWorkSegment() {
    if (!state.workSegmentStart) {
        return;
    }
    const cap = state.endTime > 0 ? Math.min(Date.now(), state.endTime) : Date.now();
    const elapsed = cap - state.workSegmentStart;
    if (elapsed > 0) {
        totalWorkMs += elapsed;
        persistTotalWorkMs();
    }
    state.workSegmentStart = null;
}

function updateHeaderDisplay() {
    els.workedTotal.textContent = formatTotalWorked(getLiveTotalWorkMs());
    const now = new Date();
    els.todayLine.textContent = now.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
    });
}

function getSelectedProfile() {
    return profiles.find((p) => p.name === selectedProfileName) || profiles[0] || null;
}

function updateTimerDisplay() {
    const profile = state.activeProfile || getSelectedProfile();
    const total = getDurationMs(profile, state.mode);
    const remaining = state.remainingMs;
    const progress = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;

    els.modeLabel.textContent = modeLabel(state.mode);
    els.timeLeft.textContent = formatTime(remaining);
    els.progressRing.style.setProperty("--progress", progress.toFixed(4));

    document.body.classList.remove("mode-work", "mode-short_break", "mode-long_break");
    document.body.classList.add(`mode-${state.mode}`);

    let status = "Ready";
    const profileToUse = state.activeProfile || getSelectedProfile();
    if (profileToUse && els.topTextDisplay) {
        els.topTextDisplay.textContent = profileToUse.topText || "Customizable Pomodoro timer";
    }

    if (state.awaitingDismissal) {
        status = "Alarm";
    } else if (state.running) {
        status = "Running";
    } else if (state.paused) {
        status = "Paused";
    }
    els.statusLine.textContent = status;

    updateControls();
    updatePlusOneButton();

    if (!alarmActive) {
        document.title = `${formatTime(remaining)} - ${modeLabel(state.mode)}`;
    }

    updateHeaderDisplay();
    refreshIdleNudge();
}

const HINT_PREFIX = "​";

function setHint(text) {
    els.messageLine.textContent = text ? HINT_PREFIX + text : "";
}

function isShowingHint() {
    const t = els.messageLine.textContent;
    return t === "" || t.startsWith(HINT_PREFIX);
}

function updateControls() {
    const showShorter = !state.awaitingDismissal && (state.running || state.paused) && state.remainingMs > 60000;
    els.shorterBtn.hidden = !showShorter;

    if (state.awaitingDismissal) {
        return;
    }

    if (state.running) {
        els.toggleBtn.textContent = "Pause";
    } else if (state.paused) {
        els.toggleBtn.textContent = "Resume";
    } else {
        els.toggleBtn.textContent = "Start";
    }

    const showReset = state.running || state.paused;
    els.resetBtn.hidden = !showReset;
    if (state.running) {
        els.resetBtn.classList.add("hold-btn");
        if (els.resetLabel) els.resetLabel.textContent = "Hold to reset";
    } else {
        els.resetBtn.classList.remove("hold-btn", "holding", "completed");
        if (els.resetLabel) els.resetLabel.textContent = "Reset";
    }

    if (isShowingHint()) {
        if (state.running) {
            setHint("");
        } else if (state.paused) {
            setHint("Paused — Resume or Reset.");
        } else {
            setHint("Pick a profile, then press Start.");
        }
    }
}

function resetTimerFromSelected() {
    const profile = getSelectedProfile();
    if (!profile) {
        state.remainingMs = 0;
        state.mode = "work";
        updateTimerDisplay();
        return;
    }
    state.remainingMs = getDurationMs(profile, "work");
    state.mode = "work";
    updateTimerDisplay();
}

function resetTimer() {
    endWorkSegment();
    stopTicking();
    cancelAllNotifs();
    state.awaitingDismissal = false;
    stopPersistentAlarm();
    state.running = false;
    state.paused = false;
    state.mode = "work";
    state.activeProfile = null;
    state.endTime = 0;
    state.extensionMs = 0;
    setMessage("");
    resetTimerFromSelected();
    persistState();
}

function stopTicking() {
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}

function startTicking() {
    stopTicking();
    const tick = () => {
        if (!state.running) return;
        catchUp();
        updateTimerDisplay();
    };
    tick();
    tickTimer = setInterval(tick, 200);
}

async function ensureAudioContext() {
    if (!audioContext) {
        try {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) {
                audioContext = null;
                return;
            }
            audioContext = new Ctor();
        } catch (error) {
            audioContext = null;
            return;
        }
    }
    if (audioContext.state === "suspended") {
        try { await audioContext.resume(); } catch (e) {}
    }
}

function audioReady() {
    return !!audioContext && audioContext.state === "running";
}

function installAudioPrimer() {
    if (audioPrimerInstalled) return;
    audioPrimerInstalled = true;
    const prime = () => {
        const wasLocked = !audioReady();
        if (!wasLocked) return;
        ensureAudioContext().then(() => {
            if (alarmActive && wasLocked && audioReady()) {
                playAlarm(computeAlarmPeak());
            }
        }).catch(() => {});
    };
    const events = ["pointerdown", "mousedown", "touchstart", "keydown", "click"];
    for (const ev of events) {
        document.addEventListener(ev, prime, { passive: true, capture: true });
    }
}

function computeAlarmPeak() {
    const rampMs = state.alarmRampDurationMs;
    if (!(rampMs > 0)) return ALARM_PEAK_GAIN_MAX;
    const elapsed = Date.now() - state.alarmRampStartTime;
    const t = Math.max(0, Math.min(1, elapsed / rampMs));
    return ALARM_PEAK_GAIN_MIN + (ALARM_PEAK_GAIN_MAX - ALARM_PEAK_GAIN_MIN) * t;
}

function playAlarm(peakGain = ALARM_PEAK_GAIN_MAX) {
    if (!audioContext) {
        return;
    }
    if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
        if (audioContext.state !== "running") return;
    }

    try {
        const now = audioContext.currentTime;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = 880;

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + 0.32);
    } catch (e) {}
}

function playIdleNudge() {
    if (!audioContext) return;
    if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
        if (audioContext.state !== "running") return;
    }
    try {
        const now = audioContext.currentTime;
        const playNote = (freq, startOffset) => {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.type = "triangle";
            osc.frequency.value = freq;
            const start = now + startOffset;
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(IDLE_NUDGE_PEAK_GAIN, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.start(start);
            osc.stop(start + 0.2);
        };
        playNote(523.25, 0);
        playNote(783.99, 0.12);
    } catch (e) {}
}

function isIdleForNudge() {
    return !state.running && !state.paused && !state.awaitingDismissal && !alarmActive;
}

function startIdleNudge() {
    if (idleNudgeInterval) return;
    idleNudgeInterval = setInterval(playIdleNudge, IDLE_NUDGE_MS);
}

function stopIdleNudge() {
    if (!idleNudgeInterval) return;
    clearInterval(idleNudgeInterval);
    idleNudgeInterval = null;
}

function refreshIdleNudge() {
    if (isIdleForNudge()) {
        startIdleNudge();
    } else {
        stopIdleNudge();
    }
}

function startTitleFlash() {
    stopTitleFlash();
    titleFlashOn = true;
    const flash = () => {
        const ringer = state.mode === "work" ? "Time to work!" : "Time for a pause!";
        document.title = titleFlashOn ? `⏰ ${ringer}` : `··· ${ringer}`;
        titleFlashOn = !titleFlashOn;
    };
    flash();
    titleFlashInterval = setInterval(flash, 800);
}

function stopTitleFlash() {
    if (titleFlashInterval) {
        clearInterval(titleFlashInterval);
        titleFlashInterval = null;
    }
}

function tryVibrate(pattern) {
    try {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            navigator.vibrate(pattern);
        }
    } catch (e) {}
}

function startPersistentAlarm() {
    if (alarmActive) {
        return;
    }
    alarmActive = true;

    if (!state.awaitingDismissal) {
        state.awaitingDismissal = true;
        persistState();
    }

    installAudioPrimer();
    ensureAudioContext().catch(() => {});

    const beepTick = () => {
        if (!alarmActive) return;
        if (audioContext && audioContext.state === "suspended") {
            audioContext.resume().catch(() => {});
        }
        playAlarm(computeAlarmPeak());
    };
    beepTick();
    alarmInterval = setInterval(beepTick, 750);

    tryVibrate([300, 200, 300, 200, 300]);
    alarmVibrationInterval = setInterval(() => tryVibrate([300, 200, 300, 200, 300]), 1500);

    startTitleFlash();

    if (state.mode === "short_break" || state.mode === "long_break") {
        setMessage("Time for a pause!");
    } else {
        setMessage("Time to work!");
    }
    els.toggleBtn.hidden = true;
    els.resetBtn.hidden = true;
    const label = els.alarmStartBtn.querySelector(".hold-btn-label");
    if (label) {
        label.textContent = `Hold to start ${modeLabel(state.mode)}`;
    }
    els.alarmStartBtn.hidden = false;
}

function stopPersistentAlarm() {
    if (!alarmActive) {
        return;
    }
    alarmActive = false;
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
    if (alarmVibrationInterval) {
        clearInterval(alarmVibrationInterval);
        alarmVibrationInterval = null;
    }
    tryVibrate(0);
    stopTitleFlash();
    setMessage("");

    els.alarmStartBtn.hidden = true;
    els.toggleBtn.hidden = false;

    if (state.awaitingDismissal) {
        state.awaitingDismissal = false;
        if (state.running && state.activeProfile) {
            state.endTime = Date.now() + getDurationMs(state.activeProfile, state.mode) + state.extensionMs;
            state.remainingMs = state.endTime - Date.now();
            state.extensionMs = 0;
            rescheduleNotifsForActive();
            startTicking();
            beginWorkSegment();
        } else {
            state.extensionMs = 0;
        }
        persistState();
        updateTimerDisplay();
    }
}

function persistState() {
    api.storage.local.set({
        [STORAGE_KEYS.timerState]: {
            running: state.running,
            paused: state.paused,
            mode: state.mode,
            workSessionsCompleted: state.workSessionsCompleted,
            remainingMs: state.remainingMs,
            endTime: state.endTime,
            activeProfileName: state.activeProfile ? state.activeProfile.name : null,
            awaitingDismissal: state.awaitingDismissal,
            extensionMs: state.extensionMs,
            workSegmentStart: state.workSegmentStart,
            alarmRampStartTime: state.alarmRampStartTime,
            alarmRampDurationMs: state.alarmRampDurationMs,
        },
    });
}

function transitionInPlace(profile) {
    if (state.mode === "work") {
        endWorkSegment();
        state.workSessionsCompleted += 1;
        if (state.workSessionsCompleted % profile.longBreakEvery === 0) {
            state.mode = "long_break";
        } else {
            state.mode = "short_break";
        }
    } else {
        state.mode = "work";
    }
    persistState();
}

function catchUp() {
    if (!state.running) {
        return;
    }
    const profile = state.activeProfile;
    if (!profile) {
        state.running = false;
        state.paused = false;
        resetTimerFromSelected();
        return;
    }
    if (state.awaitingDismissal) {
        state.remainingMs = getDurationMs(profile, state.mode) + state.extensionMs;
        return;
    }
    const now = Date.now();
    if (now >= state.endTime) {
        const prevDurationMs = getDurationMs(profile, state.mode);
        transitionInPlace(profile);
        state.awaitingDismissal = true;
        state.remainingMs = getDurationMs(profile, state.mode);
        state.alarmRampStartTime = Date.now();
        state.alarmRampDurationMs = prevDurationMs * ALARM_RAMP_FRACTION;
        persistState();
        cancelAllNotifs();
        startPersistentAlarm();
        return;
    }
    state.remainingMs = Math.max(0, state.endTime - now);
}

function rescheduleNotifsForActive() {
    if (!state.running || !state.activeProfile) {
        cancelAllNotifs();
        return;
    }
    const profile = state.activeProfile;
    const nextMode = nextModeAfter(profile, state.mode, state.workSessionsCompleted);
    const nextEnd = state.endTime + getDurationMs(profile, nextMode);
    scheduleNotifs(state.endTime, state.mode, nextEnd, nextMode);
}

function plusOneCurrentCost() {
    if (state.awaitingDismissal) return PLUS_ONE_COST_ALARM;
    if (state.running) {
        if (state.mode === "work") return PLUS_ONE_COST_ALARM;
        return PLUS_ONE_COST_BREAK;
    }
    return null;
}

function plusOneEnsureFreshDay() {
    const today = todayKey();
    if (plusOneState.date !== today) {
        plusOneState.date = today;
        plusOneState.tokens = PLUS_ONE_DAILY_BUDGET;
        persistPlusOne();
    }
}

function persistPlusOne() {
    api.storage.local.set({ [STORAGE_KEYS.plusOneTokens]: plusOneState });
}

function updatePlusOneButton() {
    plusOneEnsureFreshDay();
    const cost = plusOneCurrentCost();
    if (cost === null) {
        els.plusOneBtn.hidden = true;
        return;
    }
    const remaining = Math.floor(plusOneState.tokens / cost);
    els.plusOneBtn.hidden = false;
    els.plusOneBtn.disabled = remaining <= 0;
    els.plusOneRemaining.textContent = String(remaining);
}

function onPlusOneClick() {
    plusOneEnsureFreshDay();
    const cost = plusOneCurrentCost();
    if (cost === null) return;
    if (plusOneState.tokens < cost) return;

    plusOneState.tokens -= cost;
    persistPlusOne();

    if (state.awaitingDismissal) {
        state.extensionMs += PLUS_ONE_ADD_MS;
        if (state.activeProfile) {
            state.remainingMs = getDurationMs(state.activeProfile, state.mode) + state.extensionMs;
        }
    } else if (state.running) {
        state.endTime += PLUS_ONE_ADD_MS;
        state.remainingMs = state.endTime - Date.now();
        rescheduleNotifsForActive();
    }
    persistState();
    updateTimerDisplay();
}

function attachHoldGesture(button, onComplete, durationMs = 3000) {
    let timerId = null;
    let activePointerId = null;

    const start = (e) => {
        if (activePointerId !== null) return;
        if (button.disabled || button.hidden) return;
        if (e.pointerId !== undefined) {
            activePointerId = e.pointerId;
            try { button.setPointerCapture(e.pointerId); } catch (_) {}
        }
        const ms = typeof durationMs === "function" ? durationMs() : durationMs;
        button.style.setProperty("--hold-duration", ms + "ms");
        button.classList.add("holding");
        timerId = setTimeout(() => {
            timerId = null;
            activePointerId = null;
            button.classList.remove("holding");
            button.classList.add("completed");
            setTimeout(() => button.classList.remove("completed"), 260);
            onComplete();
        }, ms);
    };

    const cancel = () => {
        if (timerId) {
            clearTimeout(timerId);
            timerId = null;
        }
        button.classList.remove("holding");
        button.style.removeProperty("--hold-duration");
        activePointerId = null;
    };

    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", cancel);
    button.addEventListener("pointerleave", cancel);
    button.addEventListener("pointercancel", cancel);
}

function openProfileModal(mode, profile) {
    modalMode = mode;
    modalEditingName = mode === "edit" && profile ? profile.name : null;
    els.modalTitle.textContent = mode === "edit" ? "Edit profile" : "New profile";
    els.modalError.textContent = "";
    els.modalDeleteBtn.hidden = !(mode === "edit" && profiles.length > 1);

    const source = profile || {
        name: "New profile",
        topText: "Customizable Pomodoro timer",
        workMin: 25,
        shortBreakMin: 5,
        longBreakEvery: 4,
        longBreakMin: 15,
        alarmHoldSec: 3,
    };
    loadProfileFields(source);

    els.profileModal.hidden = false;
    setTimeout(() => {
        els.nameInput.focus();
        els.nameInput.select();
    }, 0);
}

function closeProfileModal() {
    els.profileModal.hidden = true;
    modalMode = null;
    modalEditingName = null;
    els.modalError.textContent = "";
}

function applyProfileEditToActive(oldProfile, newProfile) {
    state.activeProfile = newProfile;

    if (state.awaitingDismissal) {
        state.remainingMs = getDurationMs(newProfile, state.mode) + state.extensionMs;
        return;
    }

    const oldDuration = getDurationMs(oldProfile, state.mode);
    const newDuration = getDurationMs(newProfile, state.mode);

    if (state.running) {
        const now = Date.now();
        const remaining = Math.max(0, state.endTime - now);
        const elapsed = oldDuration - remaining;
        const newRemaining = Math.max(0, newDuration - elapsed);
        state.endTime = now + newRemaining;
        state.remainingMs = newRemaining;
        if (newRemaining === 0) {
            catchUp();
        } else {
            rescheduleNotifsForActive();
        }
    } else if (state.paused) {
        const elapsed = oldDuration - state.remainingMs;
        state.remainingMs = Math.max(0, newDuration - elapsed);
    }
}

function saveFromModal() {
    const profile = getProfileFromFields();
    if (!profile) {
        els.modalError.textContent = "Please enter a name and positive numbers.";
        return;
    }

    const timerActive = state.running || state.paused || state.awaitingDismissal;

    if (modalMode === "create") {
        if (profiles.some((item) => item.name === profile.name)) {
            els.modalError.textContent = "A profile with that name already exists.";
            return;
        }
        profiles.push(profile);
        if (!timerActive) {
            selectedProfileName = profile.name;
        }
    } else {
        const currentIndex = profiles.findIndex((item) => item.name === modalEditingName);
        if (currentIndex < 0) {
            els.modalError.textContent = "Profile not found.";
            return;
        }
        if (
            profile.name !== modalEditingName &&
            profiles.some((item) => item.name === profile.name)
        ) {
            els.modalError.textContent = "Another profile already has that name.";
            return;
        }
        const oldProfile = profiles[currentIndex];
        const wasActive = state.activeProfile && state.activeProfile.name === modalEditingName;
        const wasSelected = selectedProfileName === modalEditingName;
        profiles[currentIndex] = profile;
        if (wasActive) {
            applyProfileEditToActive(oldProfile, profile);
        }
        if (wasSelected || !timerActive) {
            selectedProfileName = profile.name;
        }
    }

    api.storage.local.set({
        [STORAGE_KEYS.profiles]: profiles,
        [STORAGE_KEYS.selectedProfile]: selectedProfileName,
    });

    if (timerActive) {
        persistState();
        updateTimerDisplay();
    } else {
        resetTimerFromSelected();
    }

    renderProfileList();
    closeProfileModal();
}

function deleteFromModal() {
    if (modalMode !== "edit" || !modalEditingName) return;
    if (profiles.length <= 1) return;

    const name = modalEditingName;
    profiles = profiles.filter((profile) => profile.name !== name);

    if (selectedProfileName === name) {
        selectedProfileName = profiles[0].name;
    }
    if (state.activeProfile && state.activeProfile.name === name) {
        state.activeProfile = profiles[0];
        if (state.running) {
            rescheduleNotifsForActive();
        }
    }

    api.storage.local.set({
        [STORAGE_KEYS.profiles]: profiles,
        [STORAGE_KEYS.selectedProfile]: selectedProfileName,
    });

    if (!state.running && !state.paused) {
        resetTimerFromSelected();
    }

    renderProfileList();
    closeProfileModal();
}

async function loadStorage() {
    const result = await api.storage.local.get([
        STORAGE_KEYS.profiles,
        STORAGE_KEYS.selectedProfile,
        STORAGE_KEYS.timerState,
        STORAGE_KEYS.plusOneTokens,
        STORAGE_KEYS.totalWorkMs,
    ]);

    const savedPlusOne = result[STORAGE_KEYS.plusOneTokens];
    if (savedPlusOne && typeof savedPlusOne === "object") {
        plusOneState = {
            date: typeof savedPlusOne.date === "string" ? savedPlusOne.date : null,
            tokens: Number.isFinite(savedPlusOne.tokens) ? savedPlusOne.tokens : PLUS_ONE_DAILY_BUDGET,
        };
    }
    plusOneEnsureFreshDay();

    profiles = Array.isArray(result[STORAGE_KEYS.profiles]) && result[STORAGE_KEYS.profiles].length > 0
        ? result[STORAGE_KEYS.profiles]
        : [...DEFAULT_PROFILES];

    selectedProfileName = result[STORAGE_KEYS.selectedProfile] || profiles[0].name;
    if (!profiles.some((p) => p.name === selectedProfileName)) {
        selectedProfileName = profiles[0].name;
    }

    const savedTotal = result[STORAGE_KEYS.totalWorkMs];
    totalWorkMs = Number.isFinite(savedTotal) && savedTotal >= 0 ? savedTotal : 0;

    const saved = result[STORAGE_KEYS.timerState];
    let resumed = false;
    if (saved && typeof saved === "object") {
        state.workSessionsCompleted = Number(saved.workSessionsCompleted) || 0;
        const savedProfile = saved.activeProfileName
            ? profiles.find((p) => p.name === saved.activeProfileName)
            : null;
        if (savedProfile && (saved.running || saved.paused || saved.awaitingDismissal)) {
            state.activeProfile = savedProfile;
            state.mode = saved.mode || "work";
            state.endTime = Number(saved.endTime) || 0;
            state.remainingMs = Number(saved.remainingMs) || 0;
            state.awaitingDismissal = !!saved.awaitingDismissal;
            state.paused = !!saved.paused;
            state.running = !!saved.running;
            state.extensionMs = Number(saved.extensionMs) || 0;
            state.workSegmentStart = Number.isFinite(saved.workSegmentStart) && saved.workSegmentStart > 0
                ? saved.workSegmentStart
                : null;
            state.alarmRampStartTime = Number(saved.alarmRampStartTime) || 0;
            state.alarmRampDurationMs = Number(saved.alarmRampDurationMs) || 0;
            resumed = true;
        }
    }

    renderProfileList();

    if (resumed) {
        if (state.running) {
            catchUp();
            if (state.awaitingDismissal) {
                startPersistentAlarm();
            } else if (state.running) {
                startTicking();
                beginWorkSegment();
            }
        } else if (state.awaitingDismissal) {
            startPersistentAlarm();
        } else {
            state.workSegmentStart = null;
        }
        updateTimerDisplay();
    } else {
        resetTimerFromSelected();
    }
    updateHeaderDisplay();
}

function bindEvents() {
    els.toggleBtn.addEventListener("click", async () => {
        await ensureAudioContext();

        if (state.running) {
            const remaining = state.endTime - Date.now();
            if (remaining <= 0) {
                catchUp();
                updateTimerDisplay();
                return;
            }
            endWorkSegment();
            state.remainingMs = remaining;
            state.running = false;
            state.paused = true;
            stopTicking();
            cancelAllNotifs();
            setMessage("");
            persistState();
            updateTimerDisplay();
            return;
        }

        if (state.paused) {
            state.running = true;
            state.paused = false;
            state.endTime = Date.now() + state.remainingMs;
            rescheduleNotifsForActive();
            startTicking();
            beginWorkSegment();
            setMessage("");
            persistState();
            updateTimerDisplay();
            return;
        }

        const profile = getSelectedProfile();
        if (!profile) {
            setMessage("Create a profile first.");
            return;
        }

        state.activeProfile = profile;
        state.mode = "work";
        state.remainingMs = getDurationMs(profile, "work");
        state.endTime = Date.now() + state.remainingMs;
        state.running = true;
        state.paused = false;

        rescheduleNotifsForActive();
        startTicking();
        beginWorkSegment();
        setMessage("");
        persistState();
        updateTimerDisplay();
    });

    els.plusOneBtn.addEventListener("click", onPlusOneClick);

    els.shorterBtn.addEventListener("click", () => {
        if (state.remainingMs <= 60000) return;
        state.remainingMs -= 60000;
        if (state.running) {
            state.endTime -= 60000;
            if (state.endTime <= Date.now()) {
                catchUp();
            } else {
                rescheduleNotifsForActive();
            }
        }
        persistState();
        updateTimerDisplay();
    });

    els.resetBtn.addEventListener("click", () => {
        if (state.running) {
            setMessage("Hold Reset to confirm.");
            return;
        }
        resetTimer();
    });

    attachHoldGesture(els.resetBtn, () => {
        if (state.running) {
            resetTimer();
        }
    });

    attachHoldGesture(
        els.alarmStartBtn,
        () => stopPersistentAlarm(),
        () => ((state.activeProfile && state.activeProfile.alarmHoldSec) || 3) * 1000,
    );

    els.newProfileBtn.addEventListener("click", () => {
        openProfileModal("create", null);
    });

    els.modalSaveBtn.addEventListener("click", saveFromModal);
    els.modalCancelBtn.addEventListener("click", closeProfileModal);

    if (els.longEveryInfo) {
        els.longEveryInfo.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            els.longEveryInfo.classList.toggle("info-open");
        });
        document.addEventListener("click", (e) => {
            if (!els.longEveryInfo.contains(e.target)) {
                els.longEveryInfo.classList.remove("info-open");
            }
        });
    }

    els.profileModal.addEventListener("click", (e) => {
        const target = e.target;
        if (target instanceof Element && target.hasAttribute("data-close")) {
            closeProfileModal();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !els.profileModal.hidden) {
            closeProfileModal();
        }
    });

    attachHoldGesture(els.modalDeleteBtn, deleteFromModal);

    els.defaultsBtn.addEventListener("click", async () => {
        const ok = await openConfirm({
            title: "Restore defaults?",
            message: "Replace all profiles with the defaults.",
            confirmLabel: "Restore",
            danger: true,
        });
        if (!ok) return;

        profiles = [...DEFAULT_PROFILES];
        selectedProfileName = profiles[0].name;

        api.storage.local.set({
            [STORAGE_KEYS.profiles]: profiles,
            [STORAGE_KEYS.selectedProfile]: selectedProfileName,
        });

        if (!state.running && !state.paused) {
            resetTimerFromSelected();
        }

        renderProfileList();
        setMessage("Defaults restored.");
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && alarmActive && audioContext && audioContext.state === "suspended") {
            audioContext.resume().catch(() => {});
        }
        if (state.running) {
            catchUp();
        }
        updateTimerDisplay();
    });

    window.addEventListener("focus", () => {
        if (alarmActive && audioContext && audioContext.state === "suspended") {
            audioContext.resume().catch(() => {});
        }
    });
}

async function init() {
    const LN = getLN();
    if (LN) {
        try { await LN.requestPermissions(); } catch (e) {}
        try {
            await LN.createChannel({
                id: NOTIF_CHANNEL_ID,
                name: "Pomodoro",
                description: "Session end alerts",
                importance: 4,
                sound: "default",
                vibration: true,
            });
        } catch (e) {}
    }

    installAudioPrimer();
    ensureAudioContext().catch(() => {});

    await loadStorage();
    bindEvents();
    updateTimerDisplay();
}

init();
