import ctypes
import json
import math
import sys
import time
import wave
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk

APP_DIR = Path(__file__).resolve().parent
PROFILES_FILE = APP_DIR / "profiles.json"
SOUND_FILE = APP_DIR / "alarm.wav"

DEFAULT_PROFILES = [
    {
        "name": "Classic 25/5/15",
        "work_min": 25,
        "short_break_min": 5,
        "long_break_every": 4,
        "long_break_min": 15,
    },
    {
        "name": "Deep 50/10/20",
        "work_min": 50,
        "short_break_min": 10,
        "long_break_every": 3,
        "long_break_min": 20,
    },
]


def _sanitize_profile(profile):
    try:
        name = str(profile.get("name", "")).strip()
        work_min = int(profile.get("work_min", 0))
        short_break_min = int(profile.get("short_break_min", profile.get("break_min", 0)))
        long_break_every = int(profile.get("long_break_every", 0))
        long_break_min = int(profile.get("long_break_min", 0))
    except Exception:
        return None
    if not name or work_min <= 0 or short_break_min <= 0:
        return None
    if long_break_every <= 0 or long_break_min <= 0:
        return None
    return {
        "name": name,
        "work_min": work_min,
        "short_break_min": short_break_min,
        "long_break_every": long_break_every,
        "long_break_min": long_break_min,
    }


def load_profiles():
    if PROFILES_FILE.exists():
        try:
            data = json.loads(PROFILES_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                cleaned = []
                for item in data:
                    profile = _sanitize_profile(item)
                    if profile:
                        cleaned.append(profile)
                if cleaned:
                    return cleaned
        except Exception:
            pass
    save_profiles(DEFAULT_PROFILES)
    return list(DEFAULT_PROFILES)


def save_profiles(profiles):
    PROFILES_FILE.write_text(json.dumps(profiles, indent=2), encoding="utf-8")


def ensure_alarm_wav(path):
    if path.exists():
        return
    sample_rate = 44100
    duration_sec = 0.25
    frequency = 880.0
    amplitude = 0.2

    frames = int(sample_rate * duration_sec)
    data = bytearray()
    for i in range(frames):
        t = i / sample_rate
        sample = math.sin(2 * math.pi * frequency * t)
        sample *= amplitude
        value = int(sample * 32767)
        data += value.to_bytes(2, byteorder="little", signed=True)

    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(data)


def enable_dpi_awareness():
    if not sys.platform.startswith("win"):
        return
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


class PomodoroApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Pomodoro")
        self.root.resizable(False, False)

        self.profiles = load_profiles()
        self.profile_var = tk.StringVar(value=self.profiles[0]["name"])
        self.name_var = tk.StringVar()
        self.work_var = tk.StringVar()
        self.short_break_var = tk.StringVar()
        self.long_break_every_var = tk.StringVar()
        self.long_break_var = tk.StringVar()
        self.mode_var = tk.StringVar(value="Work")
        self.timer_var = tk.StringVar(value="00:00")

        self.is_running = False
        self.is_paused = False
        self.current_mode = "work"
        self.work_sessions_completed = 0
        self.remaining = 0.0
        self.end_time = None
        self.timer_id = None
        self.active_profile = None

        self._configure_style()
        self._build_ui()
        self._load_profile_to_fields(self.profile_var.get())
        self._reset_display_from_fields()

    def _configure_style(self):
        style = ttk.Style(self.root)
        for theme in ("vista", "xpnative", "clam"):
            try:
                style.theme_use(theme)
                break
            except tk.TclError:
                continue
        style.configure("TLabel", font=("Segoe UI", 10))
        style.configure("Timer.TLabel", font=("Segoe UI", 36, "bold"))
        style.configure("TButton", padding=(10, 4))

    def _build_ui(self):
        frame = ttk.Frame(self.root, padding=12)
        frame.pack()
        frame.columnconfigure(1, weight=1)
        frame.columnconfigure(3, weight=1)

        ttk.Label(frame, text="Profile").grid(row=0, column=0, sticky="w")
        self.profile_menu = ttk.OptionMenu(frame, self.profile_var, self.profile_var.get(), "")
        self.profile_menu.grid(row=0, column=1, columnspan=3, sticky="ew")
        self.profile_var.trace_add("write", self._on_profile_change)

        ttk.Label(frame, text="Name").grid(row=1, column=0, sticky="w")
        ttk.Entry(frame, textvariable=self.name_var, width=26).grid(
            row=1, column=1, columnspan=3, sticky="ew"
        )

        ttk.Label(frame, text="Work (min)").grid(row=2, column=0, sticky="w")
        ttk.Entry(frame, textvariable=self.work_var, width=6).grid(
            row=2, column=1, sticky="w"
        )
        ttk.Label(frame, text="Short break (min)").grid(row=2, column=2, sticky="w")
        ttk.Entry(frame, textvariable=self.short_break_var, width=6).grid(
            row=2, column=3, sticky="w"
        )

        ttk.Label(frame, text="Long break every (short breaks)").grid(
            row=3, column=0, sticky="w"
        )
        ttk.Entry(frame, textvariable=self.long_break_every_var, width=6).grid(
            row=3, column=1, sticky="w"
        )
        ttk.Label(frame, text="Long break (min)").grid(row=3, column=2, sticky="w")
        ttk.Entry(frame, textvariable=self.long_break_var, width=6).grid(
            row=3, column=3, sticky="w"
        )

        ttk.Label(frame, textvariable=self.mode_var).grid(
            row=4, column=0, columnspan=4, sticky="ew", pady=(10, 0)
        )
        ttk.Label(frame, textvariable=self.timer_var, style="Timer.TLabel").grid(
            row=5, column=0, columnspan=4, sticky="ew"
        )

        ttk.Button(frame, text="Start", width=8, command=self.start).grid(
            row=6, column=0, pady=8
        )
        ttk.Button(frame, text="Pause", width=8, command=self.pause).grid(
            row=6, column=1, pady=8
        )
        ttk.Button(frame, text="Reset", width=8, command=self.reset).grid(
            row=6, column=2, pady=8
        )

        ttk.Button(frame, text="Save", width=8, command=self.save_profile).grid(
            row=7, column=0
        )
        ttk.Button(frame, text="Delete", width=8, command=self.delete_profile).grid(
            row=7, column=1
        )
        ttk.Button(frame, text="Defaults", width=8, command=self.restore_defaults).grid(
            row=7, column=2
        )

        self._refresh_profile_menu()

    def _refresh_profile_menu(self, selected_name=None):
        menu = self.profile_menu["menu"]
        menu.delete(0, "end")
        for profile in self.profiles:
            name = profile["name"]
            menu.add_command(
                label=name,
                command=lambda n=name: self.profile_var.set(n),
            )
        if selected_name:
            self.profile_var.set(selected_name)

    def _on_profile_change(self, *_args):
        name = self.profile_var.get()
        self._load_profile_to_fields(name)
        if not self.is_running:
            self._reset_display_from_fields()

    def _load_profile_to_fields(self, name):
        profile = self._find_profile(name)
        if not profile:
            return
        self.name_var.set(profile["name"])
        self.work_var.set(str(profile["work_min"]))
        self.short_break_var.set(str(profile["short_break_min"]))
        self.long_break_every_var.set(str(profile["long_break_every"]))
        self.long_break_var.set(str(profile["long_break_min"]))

    def _find_profile(self, name):
        for profile in self.profiles:
            if profile["name"] == name:
                return profile
        return None

    def _get_profile_from_fields(self):
        name = self.name_var.get().strip()
        if not name:
            return None
        try:
            work_min = int(self.work_var.get().strip())
            short_break_min = int(self.short_break_var.get().strip())
            long_break_every = int(self.long_break_every_var.get().strip())
            long_break_min = int(self.long_break_var.get().strip())
        except ValueError:
            return None
        if work_min <= 0 or short_break_min <= 0:
            return None
        if long_break_every <= 0 or long_break_min <= 0:
            return None
        return {
            "name": name,
            "work_min": work_min,
            "short_break_min": short_break_min,
            "long_break_every": long_break_every,
            "long_break_min": long_break_min,
        }

    def _reset_display_from_fields(self):
        profile = self._get_profile_from_fields()
        if not profile:
            self.timer_var.set("00:00")
            self.mode_var.set("Work")
            return
        self.remaining = float(profile["work_min"] * 60)
        self.current_mode = "work"
        self.work_sessions_completed = 0
        self.mode_var.set("Work")
        self._update_timer_label()

    def _update_timer_label(self):
        secs = max(0, int(self.remaining + 0.5))
        minutes, seconds = divmod(secs, 60)
        self.timer_var.set(f"{minutes:02d}:{seconds:02d}")

    def save_profile(self):
        profile = self._get_profile_from_fields()
        if not profile:
            messagebox.showerror("Invalid", "Enter a name and positive values.")
            return

        existing = self._find_profile(profile["name"])
        if existing:
            existing.update(profile)
        else:
            self.profiles.append(profile)
        save_profiles(self.profiles)
        self._refresh_profile_menu(profile["name"])
        if not self.is_running:
            self._reset_display_from_fields()

    def delete_profile(self):
        if len(self.profiles) <= 1:
            messagebox.showerror("Blocked", "Keep at least one profile.")
            return
        name = self.profile_var.get()
        self.profiles = [p for p in self.profiles if p["name"] != name]
        save_profiles(self.profiles)
        self._refresh_profile_menu(self.profiles[0]["name"])
        if not self.is_running:
            self._reset_display_from_fields()

    def restore_defaults(self):
        if not messagebox.askyesno(
            "Restore Defaults", "Replace profiles with defaults?"
        ):
            return
        self.profiles = list(DEFAULT_PROFILES)
        save_profiles(self.profiles)
        self._refresh_profile_menu(self.profiles[0]["name"])
        self._load_profile_to_fields(self.profile_var.get())
        if not self.is_running:
            self._reset_display_from_fields()

    def start(self):
        if self.is_running:
            return
        if self.is_paused:
            self.is_running = True
            self.is_paused = False
            self.end_time = time.monotonic() + self.remaining
            self._tick()
            return

        profile = self._get_profile_from_fields()
        if not profile:
            messagebox.showerror("Invalid", "Enter a name and positive values.")
            return
        self.active_profile = profile
        self.current_mode = "work"
        self.work_sessions_completed = 0
        self.remaining = float(profile["work_min"] * 60)
        self.mode_var.set("Work")

        self.is_running = True
        self.is_paused = False
        self.end_time = time.monotonic() + self.remaining
        self._tick()

    def pause(self):
        if not self.is_running:
            return
        self.remaining = max(0.0, self.end_time - time.monotonic())
        self.is_running = False
        self.is_paused = True
        if self.timer_id:
            self.root.after_cancel(self.timer_id)
            self.timer_id = None

    def reset(self):
        if self.timer_id:
            self.root.after_cancel(self.timer_id)
            self.timer_id = None
        self.is_running = False
        self.is_paused = False
        self.current_mode = "work"
        self.work_sessions_completed = 0
        self.active_profile = None
        self._reset_display_from_fields()

    def _tick(self):
        if not self.is_running:
            return
        self.remaining = self.end_time - time.monotonic()
        if self.remaining <= 0:
            self._play_sound()
            self._switch_mode()
            self.end_time = time.monotonic() + self.remaining
        self._update_timer_label()
        self.timer_id = self.root.after(200, self._tick)

    def _switch_mode(self):
        profile = self.active_profile or self._get_profile_from_fields()
        if not profile:
            self.remaining = 0
            return
        if self.current_mode == "work":
            self.work_sessions_completed += 1
            if self.work_sessions_completed % profile["long_break_every"] == 0:
                self.current_mode = "long_break"
                self.remaining = float(profile["long_break_min"] * 60)
                self.mode_var.set("Long Break")
            else:
                self.current_mode = "short_break"
                self.remaining = float(profile["short_break_min"] * 60)
                self.mode_var.set("Short Break")
        else:
            self.current_mode = "work"
            self.remaining = float(profile["work_min"] * 60)
            self.mode_var.set("Work")

    def _play_sound(self):
        if sys.platform.startswith("win"):
            try:
                import winsound

                ensure_alarm_wav(SOUND_FILE)
                winsound.PlaySound(
                    str(SOUND_FILE), winsound.SND_FILENAME | winsound.SND_ASYNC
                )
                return
            except Exception:
                pass
        try:
            self.root.bell()
        except Exception:
            pass


def main():
    enable_dpi_awareness()
    root = tk.Tk()
    app = PomodoroApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
