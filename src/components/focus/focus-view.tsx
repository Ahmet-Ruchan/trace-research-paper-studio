"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlarmClock, ArrowLeft, Bell, Flag, Hourglass, Pause, Play, Plus, RotateCcw, SkipForward, Square, Timer, Trash2, Watch } from "lucide-react";
import { focusColorStyle, type FocusColorId } from "@/lib/focus-colors";
import { countdownRemaining, elapsedOf, lapTimes, nextAlarm } from "@/lib/focus-timer";
import { MAX_ALARMS, type Alarm, type Preferences, type TimerMode } from "@/lib/profile";
import type { ResearchProject } from "@/lib/schema";
import { addDaysLocal, dailyTotals, dayKey, formatClock, formatDuration, startOfWeek, workSummary } from "@/lib/work-log";
import { DisplayControl } from "../display-control";
import { focusDisplay, useFocus, useFocusClock } from "./focus-provider";
import { ColorPicker, Dial, NumberField, Toggle } from "./focus-parts";
import { StudioNav } from "./studio-nav";

const TAB_KEY = "trace-focus-tab";
const TABS: Array<{ id: TimerMode; label: string; icon: typeof Timer }> = [
  { id: "focus", label: "Focus", icon: Timer },
  { id: "timer", label: "Timer", icon: Hourglass },
  { id: "stopwatch", label: "Stopwatch", icon: Watch },
  { id: "alarm", label: "Alarms", icon: AlarmClock },
];
const TIMER_PRESETS = [5, 10, 15, 25, 30, 45, 60, 90];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const phaseTitle = { work: "Focus", short: "Short break", long: "Long break" } as const;

function greeting(now: number) {
  const hour = new Date(now).getHours();
  return hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** Tercihi değiştirip kaydeden yardımcı. */
function usePreferences() {
  const { profile, saveProfile } = useFocus();
  return (patch: Partial<Preferences>) => saveProfile({ ...profile, preferences: { ...profile.preferences, ...patch } });
}

function Controls({ children }: { children: ReactNode }) {
  return <div className="focus-controls">{children}</div>;
}

function FocusPanel({ papers }: { papers: string[] }) {
  const { profile, store, actions } = useFocus();
  const now = useFocusClock();
  const setPreferences = usePreferences();
  const [task, setTask] = useState("");
  const settings = profile.preferences.focus;
  const focus = store.focus;
  const shown = focusDisplay(focus, profile, now);
  const active = Boolean(focus && !focus.finished);
  const rounds = settings.rounds ? `Round ${shown.round} of ${settings.rounds}` : `Round ${shown.round}`;
  const setFocus = (patch: Partial<Preferences["focus"]>) => void setPreferences({ focus: { ...settings, ...patch } });
  // Uzun molaya kadarki turlar: uzun molada hepsi dolu, sonra baştan.
  const filled = !focus ? 0 : focus.phase === "long" || focus.finished ? settings.longEvery : focus.completed % settings.longEvery;
  const cycle = Array.from({ length: settings.longEvery }, (_, index) => index < filled);

  return (
    <div className="focus-mode" style={focusColorStyle(profile.preferences.colors.focus)}>
      <section className="focus-dial-card" aria-label="Focus rounds">
        <p className="focus-phase">
          <span className={`focus-phase-chip is-${shown.phase}`}>{shown.finished ? "Done" : phaseTitle[shown.phase]}</span>
          {shown.finished ? `${focus?.completed ?? 0} rounds done` : rounds}
        </p>
        <Dial progress={active ? 1 - shown.remaining / shown.total : 0} label={`${phaseTitle[shown.phase]}: ${formatClock(shown.remaining, "up")} left`}>
          <strong className="focus-time">{formatClock(shown.remaining, "up")}</strong>
          <small>{shown.waiting ? `Ready for ${phaseTitle[shown.phase].toLowerCase()}` : shown.running ? (shown.phase === "work" ? "Stay with it" : "Rest your eyes") : active ? "Paused" : `${settings.work} min focus · ${settings.shortBreak} min break`}</small>
        </Dial>
        <ol className="focus-cycle" aria-label={`${focus?.completed ?? 0} rounds done; a long break after every ${settings.longEvery}`}>
          {cycle.map((done, index) => <li key={index} className={done ? "is-done" : ""} />)}
        </ol>
        <Controls>
          {!active ? (
            <button type="button" className="focus-primary" onClick={() => actions.startFocus(task)}><Play size={16} /> {focus?.finished ? "Start again" : "Start focus"}</button>
          ) : shown.running ? (
            <button type="button" className="focus-primary" onClick={actions.pauseFocus}><Pause size={16} /> Pause</button>
          ) : (
            <button type="button" className="focus-primary" onClick={actions.resumeFocus}><Play size={16} /> {shown.waiting ? `Start ${phaseTitle[shown.phase].toLowerCase()}` : "Resume"}</button>
          )}
          {active ? <button type="button" onClick={actions.skipFocus}><SkipForward size={15} /> {shown.phase === "work" ? "Skip to a break" : "Skip the break"}</button> : null}
          {focus ? <button type="button" onClick={actions.stopFocus}><Square size={14} /> Stop</button> : null}
        </Controls>
        <label className="focus-task">
          <span>What are you working on?</span>
          <input
            list="focus-papers"
            placeholder="A paper, a chapter, a problem set…"
            maxLength={120}
            value={active ? focus?.label ?? "" : task}
            disabled={active}
            onChange={(event) => setTask(event.target.value)}
          />
          <datalist id="focus-papers">{papers.map((title) => <option key={title} value={title} />)}</datalist>
        </label>
      </section>

      <section className="focus-settings" aria-label="Focus settings">
        <h2>Rounds and breaks</h2>
        <div className="focus-number-grid">
          <NumberField label="Focus" unit="min" value={settings.work} min={1} max={240} onChange={(work) => setFocus({ work })} />
          <NumberField label="Short break" unit="min" value={settings.shortBreak} min={1} max={60} onChange={(shortBreak) => setFocus({ shortBreak })} />
          <NumberField label="Long break" unit="min" value={settings.longBreak} min={1} max={120} onChange={(longBreak) => setFocus({ longBreak })} />
          <NumberField label="Long break every" unit="rounds" value={settings.longEvery} min={1} max={12} onChange={(longEvery) => setFocus({ longEvery })} />
        </div>
        <label className="focus-select">
          <span>How many rounds</span>
          <select value={settings.rounds} onChange={(event) => setFocus({ rounds: Number(event.target.value) })}>
            <option value={0}>Keep going until I stop</option>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} {count === 1 ? "round" : "rounds"}</option>)}
          </select>
        </label>
        <Toggle checked={settings.autoStartBreaks} onChange={(autoStartBreaks) => setFocus({ autoStartBreaks })} label="Start breaks on their own" hint="Otherwise the timer waits for you after each round." />
        <Toggle checked={settings.autoStartWork} onChange={(autoStartWork) => setFocus({ autoStartWork })} label="Start the next round after a break" hint="With both on, rounds and breaks follow each other until you stop." />
        <p className="focus-note">Changes apply from the next round. Only focus time is counted as work, never a break.</p>
        <h3>Colour</h3>
        <ColorPicker label="Focus colour" value={profile.preferences.colors.focus} onChange={(color) => void setPreferences({ colors: { ...profile.preferences.colors, focus: color } })} />
      </section>
    </div>
  );
}

function TimerPanel() {
  const { profile, store, actions } = useFocus();
  const now = useFocusClock();
  const setPreferences = usePreferences();
  const [label, setLabel] = useState("");
  const total = profile.preferences.timerSeconds;
  const timer = store.timer;
  const remaining = timer ? countdownRemaining(timer, now) : total * 1000;
  const [hours, minutes, seconds] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const setTotal = (next: number) => void setPreferences({ timerSeconds: Math.min(24 * 3600 - 1, Math.max(1, next)) });

  return (
    <div className="focus-mode" style={focusColorStyle(profile.preferences.colors.timer)}>
      <section className="focus-dial-card" aria-label="Timer">
        <p className="focus-phase">
          <span className="focus-phase-chip">{timer?.done ? "Time’s up" : timer?.clock.running ? "Counting down" : timer ? "Paused" : "Timer"}</span>
          {timer?.label ?? (label || "")}
        </p>
        <Dial progress={timer ? 1 - remaining / timer.duration : 0} label={`Timer: ${formatClock(remaining, "up")} left`}>
          <strong className="focus-time">{formatClock(remaining, "up")}</strong>
          <small>{timer ? `of ${formatClock(timer.duration)}` : "Set a time and start"}</small>
        </Dial>
        <Controls>
          {!timer || timer.done ? (
            <button type="button" className="focus-primary" onClick={() => actions.startTimer(total * 1000, label)}><Play size={16} /> {timer?.done ? "Start again" : "Start"}</button>
          ) : timer.clock.running ? (
            <button type="button" className="focus-primary" onClick={actions.pauseTimer}><Pause size={16} /> Pause</button>
          ) : (
            <button type="button" className="focus-primary" onClick={actions.resumeTimer}><Play size={16} /> Resume</button>
          )}
          {timer ? <button type="button" onClick={() => actions.extendTimer(60_000)}><Plus size={15} /> 1 min</button> : null}
          {timer ? <button type="button" onClick={actions.stopTimer}><RotateCcw size={15} /> Reset</button> : null}
        </Controls>
        <label className="focus-task">
          <span>Label</span>
          <input placeholder="Tea, a practice exam, a call…" maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
      </section>

      <section className="focus-settings" aria-label="Timer settings">
        <h2>How long</h2>
        <div className="focus-presets" role="group" aria-label="Quick lengths">
          {TIMER_PRESETS.map((preset) => (
            <button key={preset} type="button" aria-pressed={total === preset * 60} onClick={() => setTotal(preset * 60)}>{preset} min</button>
          ))}
        </div>
        <div className="focus-number-grid">
          <NumberField label="Hours" value={hours} min={0} max={23} onChange={(value) => setTotal(value * 3600 + minutes * 60 + seconds)} />
          <NumberField label="Minutes" value={minutes} min={0} max={59} onChange={(value) => setTotal(hours * 3600 + value * 60 + seconds)} />
          <NumberField label="Seconds" value={seconds} min={0} max={59} onChange={(value) => setTotal(hours * 3600 + minutes * 60 + value)} />
        </div>
        <Toggle checked={profile.preferences.timerCountsAsWork} onChange={(timerCountsAsWork) => void setPreferences({ timerCountsAsWork })} label="Count it as work time" hint="The time it runs is added to your work calendar." />
        <h3>Colour</h3>
        <ColorPicker label="Timer colour" value={profile.preferences.colors.timer} onChange={(color) => void setPreferences({ colors: { ...profile.preferences.colors, timer: color } })} />
      </section>
    </div>
  );
}

/** Kronometrenin salisesi: yalnızca çalışırken, React'e dokunmadan her karede. */
function LiveElapsed({ since, elapsed, running }: { since: number; elapsed: number; running: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const render = () => {
      const total = elapsed + (running ? Date.now() - since : 0);
      if (ref.current) ref.current.textContent = `.${String(Math.floor((total % 1000) / 10)).padStart(2, "0")}`;
    };
    render();
    if (!running) return;
    let frame = window.requestAnimationFrame(function loop() {
      render();
      frame = window.requestAnimationFrame(loop);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [elapsed, running, since]);
  return <span ref={ref} className="focus-hundredths" aria-hidden="true">.00</span>;
}

function StopwatchPanel() {
  const { profile, store, actions } = useFocus();
  const now = useFocusClock();
  const setPreferences = usePreferences();
  const [label, setLabel] = useState("");
  const stopwatch = store.stopwatch;
  const elapsed = stopwatch ? elapsedOf(stopwatch.clock, now) : 0;
  const laps = stopwatch ? lapTimes(stopwatch) : [];
  const splits = laps.map((lap) => lap.split);
  const [fastest, slowest] = [Math.min(...splits), Math.max(...splits)];

  return (
    <div className="focus-mode" style={focusColorStyle(profile.preferences.colors.stopwatch)}>
      <section className="focus-dial-card" aria-label="Stopwatch">
        <p className="focus-phase">
          <span className="focus-phase-chip">{stopwatch?.clock.running ? "Running" : stopwatch ? "Paused" : "Stopwatch"}</span>
          {stopwatch?.label ?? (label || "")}
        </p>
        <Dial progress={(elapsed % 60_000) / 60_000} label={`Stopwatch: ${formatClock(elapsed)}`}>
          <strong className="focus-time">
            {formatClock(elapsed)}
            {stopwatch ? <LiveElapsed since={stopwatch.clock.since} elapsed={stopwatch.clock.elapsed} running={stopwatch.clock.running} /> : <span className="focus-hundredths" aria-hidden="true">.00</span>}
          </strong>
          <small>{laps.length ? `${laps.length} ${laps.length === 1 ? "lap" : "laps"}` : "Laps appear here"}</small>
        </Dial>
        <Controls>
          {!stopwatch || !stopwatch.clock.running ? (
            <button type="button" className="focus-primary" onClick={() => (stopwatch ? actions.resumeStopwatch() : actions.startStopwatch(label))}><Play size={16} /> {stopwatch ? "Resume" : "Start"}</button>
          ) : (
            <button type="button" className="focus-primary" onClick={actions.pauseStopwatch}><Pause size={16} /> Pause</button>
          )}
          {stopwatch?.clock.running ? <button type="button" onClick={actions.lapStopwatch}><Flag size={15} /> Lap</button> : null}
          {stopwatch ? <button type="button" onClick={actions.stopStopwatch}><RotateCcw size={15} /> Reset</button> : null}
        </Controls>
        <label className="focus-task">
          <span>Label</span>
          <input placeholder="What you are timing" maxLength={80} value={stopwatch ? stopwatch.label ?? "" : label} disabled={Boolean(stopwatch)} onChange={(event) => setLabel(event.target.value)} />
        </label>
      </section>

      <section className="focus-settings" aria-label="Stopwatch laps and settings">
        <h2>Laps</h2>
        {laps.length ? (
          <table className="focus-laps">
            <thead><tr><th scope="col">Lap</th><th scope="col">Lap time</th><th scope="col">Total</th></tr></thead>
            <tbody>
              {[...laps].reverse().map((lap) => (
                <tr key={lap.lap} className={laps.length > 1 && lap.split === fastest ? "is-fastest" : laps.length > 1 && lap.split === slowest ? "is-slowest" : ""}>
                  <td>{lap.lap}{laps.length > 1 && lap.split === fastest ? <small> fastest</small> : laps.length > 1 && lap.split === slowest ? <small> slowest</small> : null}</td>
                  <td>{lapClock(lap.split)}</td>
                  <td>{lapClock(lap.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="focus-note">Press <strong>Lap</strong> while it runs to split the time: a chapter, a question, a problem.</p>
        )}
        <Toggle checked={profile.preferences.stopwatchCountsAsWork} onChange={(stopwatchCountsAsWork) => void setPreferences({ stopwatchCountsAsWork })} label="Count it as work time" hint="The time it runs is added to your work calendar." />
        <h3>Colour</h3>
        <ColorPicker label="Stopwatch colour" value={profile.preferences.colors.stopwatch} onChange={(color) => void setPreferences({ colors: { ...profile.preferences.colors, stopwatch: color } })} />
      </section>
    </div>
  );
}

/** Tur süresi salisesiyle: bir saniyenin altındaki turlar "00:00" görünüyordu. */
function lapClock(ms: number) {
  return `${formatClock(ms)}.${String(Math.floor((ms % 1000) / 10)).padStart(2, "0")}`;
}

function repeatLabel(days: number[]) {
  if (!days.length) return "Once";
  if (days.length === 7) return "Every day";
  const sorted = [...days].sort().join(",");
  if (sorted === "1,2,3,4,5") return "Weekdays";
  if (sorted === "0,6") return "Weekends";
  return [...days].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7)).map((day) => WEEKDAYS[day]).join(" ");
}

function untilLabel(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "in less than a minute";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `in ${hours}h ${minutes % 60}m` : `in ${Math.round(hours / 24)} days`;
}

function AlarmsPanel() {
  const { profile, saveProfile } = useFocus();
  const now = useFocusClock();
  const [time, setTime] = useState("07:30");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [color, setColor] = useState<FocusColorId>(profile.preferences.colors.alarm);
  const [permission, setPermission] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const weekOrder = profile.preferences.weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const saveAlarms = (alarms: Alarm[]) => saveProfile({ ...profile, alarms });

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") await saveProfile({ ...profile, preferences: { ...profile.preferences, notifications: true } });
  }

  return (
    <div className="focus-mode focus-alarms" style={focusColorStyle(color)}>
      <section className="focus-dial-card focus-alarm-form" aria-label="New alarm">
        <h2>New alarm</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (profile.alarms.length >= MAX_ALARMS) return;
            const alarm: Alarm = { id: `alarm-${Date.now().toString(36)}`, time, label: label.trim(), days: [...days].sort(), enabled: true, color };
            void saveAlarms([...profile.alarms, alarm]).then((ok) => {
              if (ok) {
                setLabel("");
                setDays([]);
              }
            });
          }}
        >
          <label className="focus-alarm-time">
            <span>Time</span>
            <input type="time" required value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <label className="focus-task">
            <span>Label</span>
            <input placeholder="Start reading, stand up, call home…" maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <fieldset className="focus-days">
            <legend>Repeat</legend>
            {weekOrder.map((day) => (
              <button key={day} type="button" aria-pressed={days.includes(day)} aria-label={new Intl.DateTimeFormat("en", { weekday: "long" }).format(new Date(2026, 0, 4 + day))} onClick={() => setDays((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day]))}>
                {WEEKDAYS[day].slice(0, 2)}
              </button>
            ))}
            <small>{days.length ? repeatLabel(days) : "No day chosen: it rings once."}</small>
          </fieldset>
          <h3>Colour</h3>
          <ColorPicker label="Alarm colour" value={color} onChange={setColor} />
          <button type="submit" className="focus-primary" disabled={profile.alarms.length >= MAX_ALARMS}><Plus size={16} /> Add the alarm</button>
          {profile.alarms.length >= MAX_ALARMS ? <p className="focus-note">You have {MAX_ALARMS} alarms, the most there can be.</p> : null}
        </form>
      </section>

      <section className="focus-settings" aria-label="Your alarms">
        <h2>Your alarms</h2>
        {profile.alarms.length ? (
          <ul className="focus-alarm-list">
            {[...profile.alarms].sort((left, right) => left.time.localeCompare(right.time)).map((alarm) => {
              const next = now ? nextAlarm(alarm, now) : undefined;
              return (
                <li key={alarm.id} style={focusColorStyle(alarm.color)} className={alarm.enabled ? "" : "is-off"}>
                  <span className="focus-alarm-swatch" aria-hidden="true" />
                  <div>
                    <strong>{alarm.time}</strong>
                    <span>{alarm.label || "Alarm"} · {repeatLabel(alarm.days)}{next ? ` · ${untilLabel(next - now)}` : ""}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    className="focus-switch"
                    aria-checked={alarm.enabled}
                    aria-label={`Alarm at ${alarm.time}${alarm.label ? `, ${alarm.label}` : ""}`}
                    onClick={() => void saveAlarms(profile.alarms.map((item) => (item.id === alarm.id ? { ...item, enabled: !item.enabled } : item)))}
                  >
                    <span aria-hidden="true" />
                  </button>
                  <button type="button" className="focus-icon-button" aria-label={`Delete the alarm at ${alarm.time}`} onClick={() => void saveAlarms(profile.alarms.filter((item) => item.id !== alarm.id))}>
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="focus-note">No alarms yet. Add one to be called back to your desk, or to stop for the day.</p>
        )}
        <p className="focus-note">
          <Bell size={14} aria-hidden="true" /> Alarms ring while Trace is open in a browser tab, also in the background.
          {permission === "granted" && profile.preferences.notifications ? " Desktop notifications are on." : null}
        </p>
        {permission !== "unsupported" && !(permission === "granted" && profile.preferences.notifications) ? (
          <button type="button" className="focus-secondary" disabled={permission === "denied"} onClick={() => void enableNotifications()}>
            {permission === "denied" ? "Notifications are blocked in this browser" : "Show desktop notifications too"}
          </button>
        ) : null}
      </section>
    </div>
  );
}

/** Bugünün toplamı, hedef, haftanın günleri ve bugünkü oturumlar. */
function TodayCard({ onProfile }: { onProfile: () => void }) {
  const { profile, log, liveIntervals } = useFocus();
  const now = useFocusClock();
  const { preferences } = profile;
  const totals = useMemo(() => dailyTotals(log, now ? liveIntervals(now) : []), [log, liveIntervals, now]);
  if (!now) return <section className="focus-today" aria-label="Today" aria-busy="true" />;
  const today = new Date(now);
  const summary = workSummary(totals, today, { weekStart: preferences.weekStart, goalMinutes: preferences.dailyGoalMinutes });
  const goal = preferences.dailyGoalMinutes * 60;
  const weekStart = startOfWeek(today, preferences.weekStart);
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = addDaysLocal(weekStart, index);
    return { key: dayKey(day), label: new Intl.DateTimeFormat("en", { weekday: "short" }).format(day), seconds: totals.get(dayKey(day)) ?? 0 };
  });
  const most = Math.max(goal, ...week.map((day) => day.seconds));
  const todayKey = dayKey(today);
  const sessions = log.sessions.filter((session) => dayKey(new Date(session.start)) === todayKey || dayKey(new Date(session.end)) === todayKey).slice(-6).reverse();
  const time = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", hour12: preferences.clock === "12h" });

  return (
    <section className="focus-today" style={focusColorStyle(preferences.color)} aria-label="Today">
      <div className="focus-today-head">
        <div>
          <span>Today</span>
          <strong>{formatDuration(summary.today)}</strong>
          <small>of your {formatDuration(goal)} goal{summary.currentStreak > 1 ? ` · ${summary.currentStreak}-day streak` : ""}</small>
        </div>
        <button type="button" className="focus-secondary" onClick={onProfile}>Your calendar</button>
      </div>
      <div className="focus-goal" role="progressbar" aria-label="Today’s goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((summary.today / goal) * 100))}>
        <i style={{ width: `${Math.min(100, (summary.today / goal) * 100)}%` }} />
      </div>
      <ul className="focus-week" aria-label="This week">
        {week.map((day) => (
          <li key={day.key} className={day.key === todayKey ? "is-today" : ""} aria-label={`${day.label}: ${formatDuration(day.seconds)}`}>
            <span className="focus-week-bar" aria-hidden="true"><i style={{ height: `${Math.max(day.seconds ? 4 : 0, (day.seconds / most) * 100)}%` }} /></span>
            <small aria-hidden="true">{day.label}</small>
          </li>
        ))}
      </ul>
      {sessions.length ? (
        <ul className="focus-sessions" aria-label="Today’s sessions">
          {sessions.map((session) => (
            <li key={session.id}>
              <span>{time.format(new Date(session.start))}–{time.format(new Date(session.end))}</span>
              <span>{session.label || { focus: "Focus", timer: "Timer", stopwatch: "Stopwatch", manual: "Added by hand" }[session.kind]}</span>
              <strong>{formatDuration((Date.parse(session.end) - Date.parse(session.start)) / 1000)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="focus-note">Your finished rounds show up here, and in the calendar on your profile.</p>
      )}
    </section>
  );
}

/**
 * Çalışma saati: odak turları ve molalar, geri sayım, kronometre ve alarm.
 * Sayaçlar ekrandan çıkınca da sürüyor (`focus-provider.tsx`).
 */
export function FocusView({ projects, backLabel, onBack, onProfile }: { projects: ResearchProject[]; backLabel: string; onBack: () => void; onProfile: () => void }) {
  const { profile, profileError } = useFocus();
  const now = useFocusClock();
  const [tab, setTab] = useState<TimerMode>(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY);
      return TABS.some((item) => item.id === saved) ? (saved as TimerMode) : "focus";
    } catch {
      return "focus";
    }
  });
  const choose = (next: TimerMode) => {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      // yalnızca bu tarayıcıdaki bir kolaylık
    }
  };
  const papers = useMemo(() => [...new Set(projects.map((project) => project.evidence.paper.title))].slice(0, 200), [projects]);
  const firstName = profile.firstName.trim();

  return (
    <main className="compare-page focus-page" style={focusColorStyle(profile.preferences.color)}>
      <header className="library-header">
        <button className="brand" onClick={onBack} aria-label={backLabel}>
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>research studio</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> {backLabel}</button>
          <DisplayControl />
          <StudioNav />
        </div>
      </header>

      <section className="compare-hero focus-hero">
        <p className="landing-eyebrow"><span /> Focus</p>
        <h1>{now ? greeting(now) : "Hello"}{firstName ? `, ${firstName}` : ""}.</h1>
        <p>Work in rounds with breaks between them, time anything, and set alarms. Every minute you work is saved on this computer and shown in your calendar.</p>
      </section>
      {profileError ? <p className="regen-error stats-note" role="alert">{profileError}</p> : null}

      <div className="focus-layout">
        <div>
          <div className="focus-tabs" role="tablist" aria-label="Timers">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`focus-tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls="focus-tabpanel"
                  style={focusColorStyle(profile.preferences.colors[item.id])}
                  onClick={() => choose(item.id)}
                >
                  <Icon size={15} aria-hidden="true" /> {item.label}
                </button>
              );
            })}
          </div>
          <div id="focus-tabpanel" role="tabpanel" aria-labelledby={`focus-tab-${tab}`}>
            {tab === "focus" ? <FocusPanel papers={papers} /> : tab === "timer" ? <TimerPanel /> : tab === "stopwatch" ? <StopwatchPanel /> : <AlarmsPanel />}
          </div>
        </div>
        <TodayCard onProfile={onProfile} />
      </div>
    </main>
  );
}
