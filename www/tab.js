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

const NOTIF_ID = 1;
function getLN() {
    if (window.LocalNotifications) return window.LocalNotifications;
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        return window.Capacitor.Plugins.LocalNotifications;
    }
    return null;
}
async function scheduleEndNotif(at, mode) {
    const LN = getLN();
    if (!LN) return;
    try {
        await LN.cancel({ notifications: [{ id: NOTIF_ID }] });
        await LN.schedule({
            notifications: [{
                id: NOTIF_ID,
                title: "Zen Pomodoro",
                body: mode === "work" ? "Work session complete." : "Break over.",
                schedule: { at: new Date(at) },
            }],
        });
    } catch (e) {}
}
async function cancelEndNotif() {
    const LN = getLN();
    if (!LN) return;
    try {
        await LN.cancel({ notifications: [{ id: NOTIF_ID }] });
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
    soundEnabled: "soundEnabled",
};

const state = {
    running: false,
    paused: false,
    mode: "work",
    workSessionsCompleted: 0,
    remainingMs: 0,
    endTime: 0,
    activeProfile: null,
};

const els = {
    todayLine: document.getElementById("todayLine"),
    todayCount: document.getElementById("todayCount"),
    soundToggle: document.getElementById("soundToggle"),
    modeLabel: document.getElementById("modeLabel"),
    timeLeft: document.getElementById("timeLeft"),
    statusLine: document.getElementById("statusLine"),
    messageLine: document.getElementById("messageLine"),
    progressRing: document.getElementById("progressRing"),
    startBtn: document.getElementById("startBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    resetBtn: document.getElementById("resetBtn"),
    profileSelect: document.getElementById("profileSelect"),
    nameInput: document.getElementById("nameInput"),
    workInput: document.getElementById("workInput"),
    shortBreakInput: document.getElementById("shortBreakInput"),
    longEveryInput: document.getElementById("longEveryInput"),
    longBreakInput: document.getElementById("longBreakInput"),
    saveProfileBtn: document.getElementById("saveProfileBtn"),
    deleteProfileBtn: document.getElementById("deleteProfileBtn"),
    defaultsBtn: document.getElementById("defaultsBtn"),
};

let profiles = [];
let stats = {};
let soundEnabled = true;
let tickTimer = null;
let audioContext = null;

function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
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

function populateProfileSelect(selectedName) {
    els.profileSelect.innerHTML = "";
    for (const profile of profiles) {
        const option = document.createElement("option");
        option.value = profile.name;
        option.textContent = profile.name;
        if (profile.name === selectedName) {
            option.selected = true;
        }
        els.profileSelect.appendChild(option);
    }
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

function updateTimerDisplay() {
    const profile = state.activeProfile || getProfileFromFields();
    const total = getDurationMs(profile, state.mode);
    const remaining = state.remainingMs;
    const progress = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;

    els.modeLabel.textContent = modeLabel(state.mode);
    els.timeLeft.textContent = formatTime(remaining);
    els.progressRing.style.setProperty("--progress", progress.toFixed(4));

    let status = "Ready";
    if (state.running) {
        status = "Running";
    } else if (state.paused) {
        status = "Paused";
    }
    els.statusLine.textContent = status;

    document.title = `${formatTime(remaining)} - ${modeLabel(state.mode)}`;
}

function resetTimerFromProfile() {
    const profile = getProfileFromFields();
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
        const now = Date.now();
        state.remainingMs = Math.max(0, state.endTime - now);
        if (state.remainingMs <= 0) {
            completeSession();
        }
        updateTimerDisplay();
    }, 200);
}

function ensureAudioContext() {
    if (audioContext) {
        if (audioContext.state === "suspended") {
            audioContext.resume();
        }
        return;
    }

    try {
        audioContext = new AudioContext();
    } catch (error) {
        audioContext = null;
    }
}

function playAlarm() {
    if (!soundEnabled) {
        return;
    }
    ensureAudioContext();
    if (!audioContext) {
        return;
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

function incrementStats() {
    const key = todayKey();
    stats[key] = (stats[key] || 0) + 1;
    api.storage.local.set({ [STORAGE_KEYS.stats]: stats });
    updateStatsDisplay();
}

function completeSession() {
    playAlarm();

    const profile = state.activeProfile || getProfileFromFields();
    if (!profile) {
        state.running = false;
        state.paused = false;
        resetTimerFromProfile();
        return;
    }

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

    state.remainingMs = getDurationMs(profile, state.mode);
    state.endTime = Date.now() + state.remainingMs;
    scheduleEndNotif(state.endTime, state.mode);
}

async function loadStorage() {
    const result = await api.storage.local.get([
        STORAGE_KEYS.profiles,
        STORAGE_KEYS.selectedProfile,
        STORAGE_KEYS.stats,
        STORAGE_KEYS.soundEnabled,
    ]);

    profiles = Array.isArray(result[STORAGE_KEYS.profiles])
        ? result[STORAGE_KEYS.profiles]
        : DEFAULT_PROFILES;

    const selectedName = result[STORAGE_KEYS.selectedProfile] || profiles[0].name;
    stats = result[STORAGE_KEYS.stats] || {};
    soundEnabled = result[STORAGE_KEYS.soundEnabled] ?? true;

    populateProfileSelect(selectedName);

    const active = profiles.find((profile) => profile.name === selectedName) || profiles[0];
    loadProfileFields(active);
    resetTimerFromProfile();
    updateStatsDisplay();
    els.soundToggle.checked = soundEnabled;
}

function bindEvents() {
    els.profileSelect.addEventListener("change", () => {
        const selected = profiles.find(
            (profile) => profile.name === els.profileSelect.value
        );
        loadProfileFields(selected);
        api.storage.local.set({
            [STORAGE_KEYS.selectedProfile]: els.profileSelect.value,
        });
        if (!state.running) {
            resetTimerFromProfile();
        }
    });

    els.soundToggle.addEventListener("change", () => {
        soundEnabled = els.soundToggle.checked;
        api.storage.local.set({ [STORAGE_KEYS.soundEnabled]: soundEnabled });
    });

    els.startBtn.addEventListener("click", () => {
        setMessage("");
        ensureAudioContext();

        if (state.running) {
            return;
        }

        if (state.paused) {
            state.running = true;
            state.paused = false;
            state.endTime = Date.now() + state.remainingMs;
            scheduleEndNotif(state.endTime, state.mode);
            startTicking();
            updateTimerDisplay();
            return;
        }

        const profile = getProfileFromFields();
        if (!profile) {
            setMessage("Please enter valid profile values first.");
            return;
        }

        state.activeProfile = profile;
        state.mode = "work";
        state.workSessionsCompleted = 0;
        state.remainingMs = getDurationMs(profile, "work");
        state.endTime = Date.now() + state.remainingMs;
        state.running = true;
        state.paused = false;

        scheduleEndNotif(state.endTime, state.mode);
        startTicking();
        updateTimerDisplay();
    });

    els.pauseBtn.addEventListener("click", () => {
        if (!state.running) {
            return;
        }
        state.remainingMs = Math.max(0, state.endTime - Date.now());
        state.running = false;
        state.paused = true;
        stopTicking();
        cancelEndNotif();
        updateTimerDisplay();
    });

    els.resetBtn.addEventListener("click", () => {
        stopTicking();
        cancelEndNotif();
        state.running = false;
        state.paused = false;
        state.mode = "work";
        state.workSessionsCompleted = 0;
        state.activeProfile = null;
        resetTimerFromProfile();
    });

    els.saveProfileBtn.addEventListener("click", () => {
        const profile = getProfileFromFields();
        if (!profile) {
            setMessage("Please enter a name and positive numbers.");
            return;
        }

        const existingIndex = profiles.findIndex(
            (item) => item.name === profile.name
        );

        if (existingIndex >= 0) {
            profiles[existingIndex] = profile;
        } else {
            profiles.push(profile);
        }

        populateProfileSelect(profile.name);
        api.storage.local.set({
            [STORAGE_KEYS.profiles]: profiles,
            [STORAGE_KEYS.selectedProfile]: profile.name,
        });

        if (!state.running) {
            resetTimerFromProfile();
        }

        setMessage("Profile saved.");
    });

    els.deleteProfileBtn.addEventListener("click", () => {
        if (profiles.length <= 1) {
            setMessage("Keep at least one profile.");
            return;
        }

        const name = els.profileSelect.value;
        profiles = profiles.filter((profile) => profile.name !== name);
        const next = profiles[0];

        populateProfileSelect(next.name);
        loadProfileFields(next);
        api.storage.local.set({
            [STORAGE_KEYS.profiles]: profiles,
            [STORAGE_KEYS.selectedProfile]: next.name,
        });

        if (!state.running) {
            resetTimerFromProfile();
        }

        setMessage("Profile deleted.");
    });

    els.defaultsBtn.addEventListener("click", () => {
        const confirmReset = window.confirm(
            "Replace all profiles with the defaults?"
        );
        if (!confirmReset) {
            return;
        }

        profiles = [...DEFAULT_PROFILES];
        const active = profiles[0];

        populateProfileSelect(active.name);
        loadProfileFields(active);
        api.storage.local.set({
            [STORAGE_KEYS.profiles]: profiles,
            [STORAGE_KEYS.selectedProfile]: active.name,
        });

        if (!state.running) {
            resetTimerFromProfile();
        }

        setMessage("Defaults restored.");
    });

    document.addEventListener("visibilitychange", () => {
        if (state.running) {
            state.remainingMs = Math.max(0, state.endTime - Date.now());
            if (state.remainingMs <= 0) {
                completeSession();
            }
        }
        updateTimerDisplay();
    });
}

async function init() {
    const LN = getLN();
    if (LN) {
        try { await LN.requestPermissions(); } catch (e) {}
    }
    await loadStorage();
    bindEvents();
    updateTimerDisplay();
}

init();
