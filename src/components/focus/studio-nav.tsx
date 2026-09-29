"use client";

import { createContext, useContext } from "react";
import { Pause, Timer } from "lucide-react";
import { focusColorStyle } from "@/lib/focus-colors";
import { countdownRemaining, elapsedOf } from "@/lib/focus-timer";
import { displayName } from "@/lib/profile";
import { formatClock } from "@/lib/work-log";
import { focusDisplay, useFocus, useFocusClock } from "./focus-provider";
import { Avatar } from "./focus-parts";

/**
 * Üst menüdeki iki düğme: çalışma saati ve profil. Her ekranın başlığında
 * duruyor; bir sayaç çalışırken düğme kalan süreyi gösteriyor, okuyucu
 * makalede de süreyi görüyor.
 */

export type StudioNavTarget = "focus" | "profile";
type StudioNavValue = { open: (target: StudioNavTarget) => void; current?: StudioNavTarget };

const StudioNavContext = createContext<StudioNavValue | undefined>(undefined);
export const StudioNavProvider = StudioNavContext.Provider;

/** Üst menünün geçişleri: başka bir ekrandan çalışma saatini ya da profili açmak için. */
export function useStudioNav() {
  return useContext(StudioNavContext);
}

const phaseWord = { work: "focus", short: "short break", long: "long break" } as const;

export function StudioNav() {
  const nav = useContext(StudioNavContext);
  const { profile, store } = useFocus();
  const now = useFocusClock();
  if (!nav) return null;
  const { focus, timer, stopwatch } = store;

  // Düğmede en önemli sayaç: odak, yoksa geri sayım, yoksa kronometre.
  let status: { clock: string; running: boolean; color: string; spoken: string } | undefined;
  if (focus && !focus.finished) {
    const shown = focusDisplay(focus, profile, now);
    status = {
      clock: formatClock(shown.remaining, "up"),
      running: shown.running,
      color: profile.preferences.colors.focus,
      spoken: `${formatClock(shown.remaining, "up")} left in ${phaseWord[shown.phase]}${shown.running ? "" : ", paused"}`,
    };
  } else if (timer && !timer.done) {
    status = { clock: formatClock(countdownRemaining(timer, now), "up"), running: timer.clock.running, color: profile.preferences.colors.timer, spoken: `${formatClock(countdownRemaining(timer, now), "up")} left on the timer` };
  } else if (stopwatch) {
    status = { clock: formatClock(elapsedOf(stopwatch.clock, now)), running: stopwatch.clock.running, color: profile.preferences.colors.stopwatch, spoken: `stopwatch at ${formatClock(elapsedOf(stopwatch.clock, now))}` };
  }
  const name = displayName(profile);

  return (
    <nav className="studio-nav" aria-label="Your work">
      <button
        type="button"
        className={`studio-nav-focus${status ? " has-timer" : ""}${status?.running ? " is-running" : ""}`}
        style={status ? focusColorStyle(status.color) : undefined}
        aria-current={nav.current === "focus" ? "page" : undefined}
        aria-label={status ? `Focus timer: ${status.spoken}` : "Focus timer"}
        title={status ? `Focus timer: ${status.spoken}` : "Focus timer, stopwatch and alarms"}
        onClick={() => nav.open("focus")}
      >
        {status && !status.running ? <Pause size={14} aria-hidden="true" /> : status ? <i aria-hidden="true" /> : <Timer size={15} aria-hidden="true" />}
        <span>{status ? status.clock : "Focus"}</span>
      </button>
      <button
        type="button"
        className="studio-nav-profile"
        aria-current={nav.current === "profile" ? "page" : undefined}
        aria-label={name ? `Profile: ${name}` : "Profile"}
        title={name ? `${name}: profile and work calendar` : "Profile and work calendar"}
        onClick={() => nav.open("profile")}
      >
        <Avatar profile={profile} />
      </button>
    </nav>
  );
}
