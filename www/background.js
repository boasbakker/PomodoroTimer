const api = typeof browser !== "undefined" ? browser : chrome;
const POMODORO_URL = api.runtime.getURL("index.html");

async function enforcePomodoroTab(tabId) {
    try {
        await api.tabs.update(tabId, { pinned: true });
    } catch (error) {
        return;
    }

    let snapshot = [];
    let selfIndex = -1;
    try {
        const self = await api.tabs.get(tabId);
        selfIndex = self.index;
        const windowTabs = await api.tabs.query({ windowId: self.windowId });
        snapshot = windowTabs
            .slice()
            .sort((a, b) => a.index - b.index)
            .map((t) => ({ index: t.index, pinned: t.pinned, isPomo: t.id === tabId, title: (t.title || "").slice(0, 30) }));
    } catch (error) {
        return;
    }

    const pinnedCount = snapshot.filter((t) => t.pinned).length;
    const target = Math.max(0, pinnedCount - 1);
    console.log("[pomodoro] BEFORE move", { selfIndex, pinnedCount, target, snapshot });

    try {
        await api.tabs.move(tabId, { index: target });
    } catch (error) {
        console.log("[pomodoro] move failed", error);
        return;
    }

    try {
        const after = await api.tabs.get(tabId);
        const afterWindow = await api.tabs.query({ windowId: after.windowId });
        const afterSnapshot = afterWindow
            .slice()
            .sort((a, b) => a.index - b.index)
            .map((t) => ({ index: t.index, pinned: t.pinned, isPomo: t.id === tabId, title: (t.title || "").slice(0, 30) }));
        console.log("[pomodoro] AFTER  move", { afterIndex: after.index, pinned: after.pinned, afterSnapshot });
    } catch (error) {
        /* ignore */
    }
}

async function ensureWindowPomodoroTab(windowId) {
    let tabs = [];
    try {
        tabs = await api.tabs.query({ windowId });
    } catch (error) {
        return;
    }

    const pomodoroTabs = tabs.filter((tab) => tab.url === POMODORO_URL);

    if (pomodoroTabs.length === 0) {
        try {
            const created = await api.tabs.create({
                windowId,
                url: POMODORO_URL,
                pinned: true,
                active: false,
            });
            await enforcePomodoroTab(created.id);
        } catch (error) {
            return;
        }
        return;
    }

    const primaryTab = pomodoroTabs[0];
    await enforcePomodoroTab(primaryTab.id);

    if (pomodoroTabs.length > 1) {
        const extras = pomodoroTabs.slice(1).map((tab) => tab.id);
        try {
            await api.tabs.remove(extras);
        } catch (error) {
            return;
        }
    }
}

async function ensureAllWindows() {
    let windows = [];
    try {
        windows = await api.windows.getAll({ windowTypes: ["normal"] });
    } catch (error) {
        return;
    }

    for (const window of windows) {
        await ensureWindowPomodoroTab(window.id);
    }
}

api.runtime.onInstalled.addListener(() => {
    ensureAllWindows();
});

api.runtime.onStartup.addListener(() => {
    ensureAllWindows();
});

api.windows.onCreated.addListener((windowInfo) => {
    if (windowInfo.type !== "normal") {
        return;
    }
    ensureWindowPomodoroTab(windowInfo.id);
});

api.tabs.onRemoved.addListener((_tabId, removeInfo) => {
    ensureWindowPomodoroTab(removeInfo.windowId);
});

api.tabs.onMoved.addListener((_tabId, moveInfo) => {
    ensureWindowPomodoroTab(moveInfo.windowId);
});

api.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.pinned !== undefined) {
        ensureWindowPomodoroTab(tab.windowId);
        return;
    }
    if (tab.url !== POMODORO_URL) {
        return;
    }
    if (changeInfo.status === "complete") {
        enforcePomodoroTab(tab.id);
    }
});
