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
        name: "Classic 25/5/15",
        workMin: 25,
        shortBreakMin: 5,
        longBreakEvery: 4,
        longBreakMin: 15,
    },
    {
        name: "Deep 50/10/20",
        workMin: 50,
        shortBreakMin: 10,
        longBreakEvery: 3,
        longBreakMin: 20,
    },
    {
        name: "WLG",
        workMin: 65,
        shortBreakMin: 5,
        longBreakEvery: 2,
        longBreakMin: 25,
    },
];

const STORAGE_KEYS = {
    profiles: "profiles",
    selectedProfile: "selectedProfile",
    stats: "stats",
    timerState: "timerState",
};

const state = {
    running: false,
    paused: false,
    mode: "work",
    workSessionsCompleted: 0,
    remainingMs: 0,
    endTime: 0,
    activeProfile: null,
    awaitingDismissal: false,
};

const els = {
    todayLine: document.getElementById("todayLine"),
    todayCount: document.getElementById("todayCount"),
    modeLabel: document.getElementById("modeLabel"),
    timeLeft: document.getElementById("timeLeft"),
    statusLine: document.getElementById("statusLine"),
    messageLine: document.getElementById("messageLine"),
    progressRing: document.getElementById("progressRing"),
    startBtn: document.getElementById("startBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    resetBtn: document.getElementById("resetBtn"),
    alarmStartBtn: document.getElementById("alarmStartBtn"),
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
    workInput: document.getElementById("workInput"),
    shortBreakInput: document.getElementById("shortBreakInput"),
    longEveryInput: document.getElementById("longEveryInput"),
    longBreakInput: document.getElementById("longBreakInput"),
};

let profiles = [];
let stats = {};
let tickTimer = null;
let audioContext = null;

let alarmActive = false;
let alarmInterval = null;

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
    const workMin = Number.parseInt(els.workInput.value, 10);
    const shortBreakMin = Number.parseInt(els.shortBreakInput.value, 10);
    const longBreakEvery = Number.parseInt(els.longEveryInput.value, 10);
    const longBreakMin = Number.parseInt(els.longBreakInput.value, 10);

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

    return {
        name,
        workMin,
        shortBreakMin,
        longBreakEvery,
        longBreakMin,
    };
}

function loadProfileFields(profile) {
    if (!profile) {
        return;
    }
    els.nameInput.value = profile.name;
    els.workInput.value = String(profile.workMin);
    els.shortBreakInput.value = String(profile.shortBreakMin);
    els.longEveryInput.value = String(profile.longBreakEvery);
    els.longBreakInput.value = String(profile.longBreakMin);
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

function selectProfile(name) {
    const profile = profiles.find((p) => p.name === name);
    if (!profile) return;
    selectedProfileName = name;
    api.storage.local.set({ [STORAGE_KEYS.selectedProfile]: name });
    resetTimer();
    renderProfileList();
}

function updateStatsDisplay() {
    const key = todayKey();
    const count = stats[key] || 0;
    els.todayCount.textContent = String(count);
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

    let status = "Ready";
    if (state.awaitingDismissal) {
        status = "Alarm";
    } else if (state.running) {
        status = "Running";
    } else if (state.paused) {
        status = "Paused";
    }
    els.statusLine.textContent = status;

    document.title = `${formatTime(remaining)} - ${modeLabel(state.mode)}`;
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
    stopTicking();
    cancelAllNotifs();
    state.awaitingDismissal = false;
    stopPersistentAlarm();
    state.running = false;
    state.paused = false;
    state.mode = "work";
    state.activeProfile = null;
    state.endTime = 0;
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
    tickTimer = setInterval(() => {
        if (!state.running) {
            return;
        }
        catchUp();
        updateTimerDisplay();
    }, 200);
}

async function ensureAudioContext() {
    if (audioContext) {
        if (audioContext.state === "suspended") {
            try { await audioContext.resume(); } catch (e) {}
        }
        return;
    }

    try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) {
            audioContext = null;
            return;
        }
        audioContext = new Ctor();
    } catch (error) {
        audioContext = null;
    }
}

function playAlarm() {
    if (!audioContext) {
        return;
    }
    if (audioContext.state === "suspended") {
        audioContext.resume();
    }

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.32);
}

function startPersistentAlarm() {
    if (alarmActive) {
        return;
    }
    alarmActive = true;
    playAlarm();
    alarmInterval = setInterval(playAlarm, 1500);
    setMessage("");
    els.startBtn.hidden = true;
    els.pauseBtn.hidden = true;
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
    setMessage("");

    els.alarmStartBtn.hidden = true;
    els.startBtn.hidden = false;
    els.pauseBtn.hidden = false;
    els.resetBtn.hidden = false;

    if (state.awaitingDismissal) {
        state.awaitingDismissal = false;
        if (state.running && state.activeProfile) {
            state.endTime = Date.now() + getDurationMs(state.activeProfile, state.mode);
            state.remainingMs = state.endTime - Date.now();
            rescheduleNotifsForActive();
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
        },
    });
}

function incrementStats() {
    const key = todayKey();
    stats[key] = (stats[key] || 0) + 1;
    api.storage.local.set({ [STORAGE_KEYS.stats]: stats });
    updateStatsDisplay();
}

function transitionInPlace(profile) {
    if (state.mode === "work") {
        state.workSessionsCompleted += 1;
        incrementStats();
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
        state.remainingMs = getDurationMs(profile, state.mode);
        return;
    }
    const now = Date.now();
    if (now >= state.endTime) {
        transitionInPlace(profile);
        state.awaitingDismissal = true;
        state.remainingMs = getDurationMs(profile, state.mode);
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
        button.classList.add("holding");
        timerId = setTimeout(() => {
            timerId = null;
            activePointerId = null;
            button.classList.remove("holding");
            button.classList.add("completed");
            setTimeout(() => button.classList.remove("completed"), 260);
            onComplete();
        }, durationMs);
    };

    const cancel = () => {
        if (timerId) {
            clearTimeout(timerId);
            timerId = null;
        }
        button.classList.remove("holding");
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
        workMin: 25,
        shortBreakMin: 5,
        longBreakEvery: 4,
        longBreakMin: 15,
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

function saveFromModal() {
    const profile = getProfileFromFields();
    if (!profile) {
        els.modalError.textContent = "Please enter a name and positive numbers.";
        return;
    }

    if (modalMode === "create") {
        if (profiles.some((item) => item.name === profile.name)) {
            els.modalError.textContent = "A profile with that name already exists.";
            return;
        }
        profiles.push(profile);
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
        profiles[currentIndex] = profile;
    }

    selectedProfileName = profile.name;

    api.storage.local.set({
        [STORAGE_KEYS.profiles]: profiles,
        [STORAGE_KEYS.selectedProfile]: selectedProfileName,
    });

    resetTimer();

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
        STORAGE_KEYS.stats,
        STORAGE_KEYS.timerState,
    ]);

    profiles = Array.isArray(result[STORAGE_KEYS.profiles]) && result[STORAGE_KEYS.profiles].length > 0
        ? result[STORAGE_KEYS.profiles]
        : [...DEFAULT_PROFILES];

    selectedProfileName = result[STORAGE_KEYS.selectedProfile] || profiles[0].name;
    if (!profiles.some((p) => p.name === selectedProfileName)) {
        selectedProfileName = profiles[0].name;
    }
    stats = result[STORAGE_KEYS.stats] || {};

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
            resumed = true;
        }
    }

    renderProfileList();

    if (resumed) {
        if (state.running) {
            catchUp();
            if (state.running) {
                startTicking();
            }
        } else if (state.awaitingDismissal) {
            startPersistentAlarm();
        }
        updateTimerDisplay();
    } else {
        resetTimerFromSelected();
    }
    updateStatsDisplay();
}

function bindEvents() {
    els.startBtn.addEventListener("click", async () => {
        setMessage("");
        await ensureAudioContext();

        if (state.running) {
            return;
        }

        if (state.paused) {
            state.running = true;
            state.paused = false;
            state.endTime = Date.now() + state.remainingMs;
            rescheduleNotifsForActive();
            startTicking();
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
        persistState();
        updateTimerDisplay();
    });

    els.pauseBtn.addEventListener("click", () => {
        if (!state.running) {
            return;
        }
        const remaining = state.endTime - Date.now();
        if (remaining <= 0) {
            catchUp();
            updateTimerDisplay();
            return;
        }
        state.remainingMs = remaining;
        state.running = false;
        state.paused = true;
        stopTicking();
        cancelAllNotifs();
        persistState();
        updateTimerDisplay();
    });

    els.resetBtn.addEventListener("click", () => {
        resetTimer();
    });

    attachHoldGesture(els.alarmStartBtn, () => stopPersistentAlarm());

    els.newProfileBtn.addEventListener("click", () => {
        openProfileModal("create", null);
    });

    els.modalSaveBtn.addEventListener("click", saveFromModal);
    els.modalCancelBtn.addEventListener("click", closeProfileModal);

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

    els.defaultsBtn.addEventListener("click", () => {
        const confirmReset = window.confirm(
            "Replace all profiles with the defaults?"
        );
        if (!confirmReset) {
            return;
        }

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
        if (state.running) {
            catchUp();
        }
        updateTimerDisplay();
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
    await loadStorage();
    bindEvents();
    updateTimerDisplay();
}

init();
