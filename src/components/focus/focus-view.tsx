"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlarmClock, ArrowLeft, Bell, BookOpen, Flag, Hourglass, Layers, Maximize2, Minimize2, Pause, Play, Plus, RotateCcw, SkipForward, Square, Timer, Trash2, Volume2, Watch } from "lucide-react";
import { useT } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";
import { focusColorStyle, type FocusColorId } from "@/lib/focus-colors";
import { countdownRemaining, elapsedOf, lapTimes, nextAlarm, shortBreakKey, type Subject } from "@/lib/focus-timer";
import { AMBIENT_SOUNDS, MAX_ALARMS, type Alarm, type AmbientId, type Preferences, type TimerMode } from "@/lib/profile";
import type { ResearchProject } from "@/lib/schema";
import { addDaysLocal, dailyTotals, dayKey, formatClock, startOfWeek, workSummary } from "@/lib/work-log";
import { DisplayControl } from "../display-control";
import { BreakReviewCard, useBreakReview, type BreakReview } from "./break-review";
import { focusDisplay, useFocus, useFocusClock } from "./focus-provider";
import { ColorPicker, Dial, NumberField, Toggle } from "./focus-parts";
import { StudioNav } from "./studio-nav";

const TAB_KEY = "trace-focus-tab";
const TABS: Array<{ id: TimerMode; icon: typeof Timer }> = [
  { id: "focus", icon: Timer },
  { id: "timer", icon: Hourglass },
  { id: "stopwatch", icon: Watch },
  { id: "alarm", icon: AlarmClock },
];
const TIMER_PRESETS = [5, 10, 15, 25, 30, 45, 60, 90];

type Words = Messages["focus"];

/** Tercihi değiştirip kaydeden yardımcı. */
function usePreferences() {
  const { profile, saveProfile } = useFocus();
  return (patch: Partial<Preferences>) => saveProfile({ ...profile, preferences: { ...profile.preferences, ...patch } });
}

function Controls({ children }: { children: ReactNode }) {
  return <div className="focus-controls">{children}</div>;
}

type Paper = { id: string; title: string };
type Subjects = Record<"focus" | "timer" | "stopwatch", string>;

/** Yazılan ad kütüphanedeki bir makalenin başlığıysa süre o makaleye yazılıyor. */
function resolveSubject(text: string, papers: readonly Paper[]): Subject {
  const label = text.trim();
  const match = papers.find((paper) => paper.title.trim().toLocaleLowerCase("en") === label.toLocaleLowerCase("en"));
  return { ...(label ? { label } : {}), ...(match ? { projectId: match.id } : {}) };
}

/** Ne üzerinde çalışıldığı: serbest metin ya da kütüphaneden bir makale. */
function SubjectField({ label, placeholder, value, onChange, active, papers }: { label: string; placeholder: string; value: string; onChange: (text: string) => void; active?: Subject; papers: readonly Paper[] }) {
  const t = useT().focus.view;
  const shown = active ? active.label ?? "" : value;
  const linked = active ? active.projectId : resolveSubject(value, papers).projectId;
  const paper = linked ? papers.find((item) => item.id === linked) : undefined;
  return (
    <label className="focus-task">
      <span>{label}</span>
      <input list="focus-papers" placeholder={placeholder} maxLength={120} value={shown} disabled={Boolean(active)} onChange={(event) => onChange(event.target.value)} />
      {paper ? (
        <small className="focus-linked"><BookOpen size={13} aria-hidden="true" /> {t.linked}</small>
      ) : papers.length && !active ? (
        <small className="focus-linked-hint">{t.linkHint}</small>
      ) : null}
    </label>
  );
}

type PanelProps = { papers: readonly Paper[]; subject: string; onSubject: (text: string) => void; onStage: () => void };

function FocusPanel({ papers, subject, onSubject, onStage, review, projects }: PanelProps & { review: BreakReview; projects: readonly ResearchProject[] }) {
  const words = useT().focus;
  const { view, focusPanel: t } = words;
  const { profile, store, actions, previewAmbient } = useFocus();
  const now = useFocusClock();
  const setPreferences = usePreferences();
  const settings = profile.preferences.focus;
  const focus = store.focus;
  const shown = focusDisplay(focus, profile, now);
  const active = Boolean(focus && !focus.finished);
  const rounds = t.round(shown.round, settings.rounds);
  const setFocus = (patch: Partial<Preferences["focus"]>) => void setPreferences({ focus: { ...settings, ...patch } });
  // Uzun molaya kadarki turlar: uzun molada hepsi dolu, sonra baştan.
  const filled = !focus ? 0 : focus.phase === "long" || focus.finished ? settings.longEvery : focus.completed % settings.longEvery;
  const cycle = Array.from({ length: settings.longEvery }, (_, index) => index < filled);

  return (
    <div className="focus-mode" style={focusColorStyle(profile.preferences.colors.focus)}>
      <div className="focus-stack">
        <section className="focus-dial-card" aria-label={t.region}>
          <button type="button" className="focus-expand" onClick={onStage} aria-label={view.fullScreen} title={view.fullScreenTitle}><Maximize2 size={15} /></button>
          <p className="focus-phase">
            <span className={`focus-phase-chip is-${shown.phase}`}>{shown.finished ? t.done : view.phases[shown.phase]}</span>
            {shown.finished ? t.roundsDone(focus?.completed ?? 0) : rounds}
          </p>
          <Dial progress={active ? 1 - shown.remaining / shown.total : 0} label={t.dialLabel(shown.phase, formatClock(shown.remaining, "up"))}>
            <strong className="focus-time">{formatClock(shown.remaining, "up")}</strong>
            <small>{shown.waiting ? t.readyFor(shown.phase) : shown.running ? (shown.phase === "work" ? t.stayWithIt : t.restYourEyes) : active ? view.paused : t.idle(settings.work, settings.shortBreak)}</small>
          </Dial>
          <ol className="focus-cycle" aria-label={t.cycle(focus?.completed ?? 0, settings.longEvery)}>
            {cycle.map((done, index) => <li key={index} className={done ? "is-done" : ""} />)}
          </ol>
          <Controls>
            {!active ? (
              <button type="button" className="focus-primary" onClick={() => actions.startFocus(resolveSubject(subject, papers))}><Play size={16} /> {focus?.finished ? view.startAgain : t.startFocus}</button>
            ) : shown.running ? (
              <button type="button" className="focus-primary" onClick={actions.pauseFocus}><Pause size={16} /> {view.pause}</button>
            ) : (
              <button type="button" className="focus-primary" onClick={actions.resumeFocus}><Play size={16} /> {shown.waiting ? t.startPhase(shown.phase) : view.resume}</button>
            )}
            {active ? <button type="button" onClick={actions.skipFocus}><SkipForward size={15} /> {shown.phase === "work" ? t.skipToBreak : t.skipBreak}</button> : null}
            {focus ? <button type="button" onClick={actions.stopFocus}><Square size={14} /> {view.stop}</button> : null}
          </Controls>
          <SubjectField label={t.subject} placeholder={t.subjectPlaceholder} value={subject} onChange={onSubject} active={active ? focus : undefined} papers={papers} />
        </section>
        <BreakReviewCard review={review} projects={projects} />
      </div>

      <section className="focus-settings" aria-label={t.settings}>
        <h2>{t.heading}</h2>
        <div className="focus-number-grid">
          <NumberField label={view.phases.work} unit={view.minutesUnit} value={settings.work} min={1} max={240} onChange={(work) => setFocus({ work })} />
          <NumberField label={view.phases.short} unit={view.minutesUnit} value={settings.shortBreak} min={1} max={60} onChange={(shortBreak) => setFocus({ shortBreak })} />
          <NumberField label={view.phases.long} unit={view.minutesUnit} value={settings.longBreak} min={1} max={120} onChange={(longBreak) => setFocus({ longBreak })} />
          <NumberField label={t.longEvery} unit={t.roundsUnit} value={settings.longEvery} min={1} max={12} onChange={(longEvery) => setFocus({ longEvery })} />
        </div>
        <label className="focus-select">
          <span>{t.howMany}</span>
          <select value={settings.rounds} onChange={(event) => setFocus({ rounds: Number(event.target.value) })}>
            <option value={0}>{t.untilStop}</option>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{t.roundCount(count)}</option>)}
          </select>
        </label>
        <Toggle checked={settings.autoStartBreaks} onChange={(autoStartBreaks) => setFocus({ autoStartBreaks })} label={t.autoBreaks} hint={t.autoBreaksHint} />
        <Toggle checked={settings.autoStartWork} onChange={(autoStartWork) => setFocus({ autoStartWork })} label={t.autoWork} hint={t.autoWorkHint} />
        <Toggle checked={profile.preferences.breakReview} onChange={(breakReview) => void setPreferences({ breakReview })} label={t.breakReview} hint={t.breakReviewHint} />
        <p className="focus-note">{t.changesNote}</p>
        <div className="focus-ambient">
          <label className="focus-select">
            <span>{t.ambient}</span>
            <select value={profile.preferences.ambient} onChange={(event) => void setPreferences({ ambient: event.target.value as AmbientId })}>
              {AMBIENT_SOUNDS.map((sound) => <option key={sound.id} value={sound.id}>{words.ambientSounds[sound.id]}</option>)}
            </select>
          </label>
          <label className="profile-volume">
            <span>{t.volume}</span>
            <input type="range" min={0} max={1} step={0.05} value={profile.preferences.ambientVolume} onChange={(event) => void setPreferences({ ambientVolume: Number(event.target.value) })} aria-valuetext={words.percent(Math.round(profile.preferences.ambientVolume * 100))} disabled={profile.preferences.ambient === "none"} />
          </label>
          <button type="button" className="focus-secondary" onClick={previewAmbient} disabled={profile.preferences.ambient === "none"}><Volume2 size={14} /> {t.listen}</button>
        </div>
        <p className="focus-note">{t.ambientNote}</p>
        <h3>{view.colour}</h3>
        <ColorPicker label={t.colour} value={profile.preferences.colors.focus} onChange={(color) => void setPreferences({ colors: { ...profile.preferences.colors, focus: color } })} />
      </section>
    </div>
  );
}

function TimerPanel({ papers, subject, onSubject, onStage }: PanelProps) {
  const { view, timerPanel: t } = useT().focus;
  const { profile, store, actions } = useFocus();
  const now = useFocusClock();
  const setPreferences = usePreferences();
  const total = profile.preferences.timerSeconds;
  const timer = store.timer;
  const remaining = timer ? countdownRemaining(timer, now) : total * 1000;
  const [hours, minutes, seconds] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const setTotal = (next: number) => void setPreferences({ timerSeconds: Math.min(24 * 3600 - 1, Math.max(1, next)) });

  return (
    <div className="focus-mode" style={focusColorStyle(profile.preferences.colors.timer)}>
      <section className="focus-dial-card" aria-label={t.label}>
        <button type="button" className="focus-expand" onClick={onStage} aria-label={view.fullScreen} title={view.fullScreenTitle}><Maximize2 size={15} /></button>
        <p className="focus-phase">
          <span className="focus-phase-chip">{timer?.done ? t.timesUp : timer?.clock.running ? t.countingDown : timer ? view.paused : t.label}</span>
          {timer ? timer.label ?? "" : subject}
        </p>
        <Dial progress={timer ? 1 - remaining / timer.duration : 0} label={t.dialLabel(formatClock(remaining, "up"))}>
          <strong className="focus-time">{formatClock(remaining, "up")}</strong>
          <small>{timer ? t.of(formatClock(timer.duration)) : t.setAndStart}</small>
        </Dial>
        <Controls>
          {!timer || timer.done ? (
            <button type="button" className="focus-primary" onClick={() => actions.startTimer(total * 1000, resolveSubject(subject, papers))}><Play size={16} /> {timer?.done ? view.startAgain : view.start}</button>
          ) : timer.clock.running ? (
            <button type="button" className="focus-primary" onClick={actions.pauseTimer}><Pause size={16} /> {view.pause}</button>
          ) : (
            <button type="button" className="focus-primary" onClick={actions.resumeTimer}><Play size={16} /> {view.resume}</button>
          )}
          {timer ? <button type="button" onClick={() => actions.extendTimer(60_000)}><Plus size={15} /> {t.oneMinute}</button> : null}
          {timer ? <button type="button" onClick={actions.stopTimer}><RotateCcw size={15} /> {view.reset}</button> : null}
        </Controls>
        <SubjectField label={view.label} placeholder={t.placeholder} value={subject} onChange={onSubject} active={timer && !timer.done ? timer : undefined} papers={papers} />
      </section>

      <section className="focus-settings" aria-label={t.settings}>
        <h2>{t.heading}</h2>
        <div className="focus-presets" role="group" aria-label={t.presets}>
          {TIMER_PRESETS.map((preset) => (
            <button key={preset} type="button" aria-pressed={total === preset * 60} onClick={() => setTotal(preset * 60)}>{t.preset(preset)}</button>
          ))}
        </div>
        <div className="focus-number-grid">
          <NumberField label={t.hours} value={hours} min={0} max={23} onChange={(value) => setTotal(value * 3600 + minutes * 60 + seconds)} />
          <NumberField label={t.minutes} value={minutes} min={0} max={59} onChange={(value) => setTotal(hours * 3600 + value * 60 + seconds)} />
          <NumberField label={t.seconds} value={seconds} min={0} max={59} onChange={(value) => setTotal(hours * 3600 + minutes * 60 + value)} />
        </div>
        <Toggle checked={profile.preferences.timerCountsAsWork} onChange={(timerCountsAsWork) => void setPreferences({ timerCountsAsWork })} label={view.countAsWork} hint={view.countAsWorkHint} />
        <h3>{view.colour}</h3>
        <ColorPicker label={t.colour} value={profile.preferences.colors.timer} onChange={(color) => void setPreferences({ colors: { ...profile.preferences.colors, timer: color } })} />
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

function StopwatchPanel({ papers, subject, onSubject, onStage }: PanelProps) {
  const { view, stopwatchPanel: t } = useT().focus;
  const { profile, store, actions } = useFocus();
  const now = useFocusClock();
  const setPreferences = usePreferences();
  const stopwatch = store.stopwatch;
  const elapsed = stopwatch ? elapsedOf(stopwatch.clock, now) : 0;
  const laps = stopwatch ? lapTimes(stopwatch) : [];
  const splits = laps.map((lap) => lap.split);
  const [fastest, slowest] = [Math.min(...splits), Math.max(...splits)];

  return (
    <div className="focus-mode" style={focusColorStyle(profile.preferences.colors.stopwatch)}>
      <section className="focus-dial-card" aria-label={t.label}>
        <button type="button" className="focus-expand" onClick={onStage} aria-label={view.fullScreen} title={view.fullScreenTitle}><Maximize2 size={15} /></button>
        <p className="focus-phase">
          <span className="focus-phase-chip">{stopwatch?.clock.running ? t.running : stopwatch ? view.paused : t.label}</span>
          {stopwatch ? stopwatch.label ?? "" : subject}
        </p>
        <Dial progress={(elapsed % 60_000) / 60_000} label={t.dialLabel(formatClock(elapsed))}>
          <strong className="focus-time">
            {formatClock(elapsed)}
            {stopwatch ? <LiveElapsed since={stopwatch.clock.since} elapsed={stopwatch.clock.elapsed} running={stopwatch.clock.running} /> : <span className="focus-hundredths" aria-hidden="true">.00</span>}
          </strong>
          <small>{laps.length ? t.laps(laps.length) : t.lapsAppear}</small>
        </Dial>
        <Controls>
          {!stopwatch || !stopwatch.clock.running ? (
            <button type="button" className="focus-primary" onClick={() => (stopwatch ? actions.resumeStopwatch() : actions.startStopwatch(resolveSubject(subject, papers)))}><Play size={16} /> {stopwatch ? view.resume : view.start}</button>
          ) : (
            <button type="button" className="focus-primary" onClick={actions.pauseStopwatch}><Pause size={16} /> {view.pause}</button>
          )}
          {stopwatch?.clock.running ? <button type="button" onClick={actions.lapStopwatch}><Flag size={15} /> {t.lap}</button> : null}
          {stopwatch ? <button type="button" onClick={actions.stopStopwatch}><RotateCcw size={15} /> {view.reset}</button> : null}
        </Controls>
        <SubjectField label={view.label} placeholder={t.placeholder} value={subject} onChange={onSubject} active={stopwatch} papers={papers} />
      </section>

      <section className="focus-settings" aria-label={t.settings}>
        <h2>{t.heading}</h2>
        {laps.length ? (
          <table className="focus-laps">
            <thead><tr><th scope="col">{t.lap}</th><th scope="col">{t.lapTime}</th><th scope="col">{t.total}</th></tr></thead>
            <tbody>
              {[...laps].reverse().map((lap) => (
                <tr key={lap.lap} className={laps.length > 1 && lap.split === fastest ? "is-fastest" : laps.length > 1 && lap.split === slowest ? "is-slowest" : ""}>
                  <td>{lap.lap}{laps.length > 1 && lap.split === fastest ? <small> {t.fastest}</small> : laps.length > 1 && lap.split === slowest ? <small> {t.slowest}</small> : null}</td>
                  <td>{lapClock(lap.split)}</td>
                  <td>{lapClock(lap.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="focus-note">{t.hintBefore}<strong>{t.lap}</strong>{t.hintAfter}</p>
        )}
        <Toggle checked={profile.preferences.stopwatchCountsAsWork} onChange={(stopwatchCountsAsWork) => void setPreferences({ stopwatchCountsAsWork })} label={view.countAsWork} hint={view.countAsWorkHint} />
        <h3>{view.colour}</h3>
        <ColorPicker label={t.colour} value={profile.preferences.colors.stopwatch} onChange={(color) => void setPreferences({ colors: { ...profile.preferences.colors, stopwatch: color } })} />
      </section>
    </div>
  );
}

/** Tur süresi salisesiyle: bir saniyenin altındaki turlar "00:00" görünüyordu. */
function lapClock(ms: number) {
  return `${formatClock(ms)}.${String(Math.floor((ms % 1000) / 10)).padStart(2, "0")}`;
}

function repeatLabel(days: number[], t: Words["alarms"]) {
  if (!days.length) return t.once;
  if (days.length === 7) return t.everyDay;
  const sorted = [...days].sort().join(",");
  if (sorted === "1,2,3,4,5") return t.weekdays;
  if (sorted === "0,6") return t.weekends;
  return [...days].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7)).map((day) => t.dayShort[day]).join(" ");
}

function untilLabel(ms: number, t: Words["alarms"]["until"]) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return t.underAMinute;
  if (minutes < 60) return t.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? t.hours(hours, minutes % 60) : t.days(Math.round(hours / 24));
}

function AlarmsPanel() {
  const { common, focus: words } = useT();
  const t = words.alarms;
  const dayName = useMemo(() => new Intl.DateTimeFormat(common.locale, { weekday: "long" }), [common.locale]);
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
      <section className="focus-dial-card focus-alarm-form" aria-label={t.newAlarm}>
        <h2>{t.newAlarm}</h2>
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
            <span>{t.time}</span>
            <input type="time" required value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <label className="focus-task">
            <span>{words.view.label}</span>
            <input placeholder={t.placeholder} maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <fieldset className="focus-days">
            <legend>{t.repeat}</legend>
            {weekOrder.map((day) => (
              <button key={day} type="button" aria-pressed={days.includes(day)} aria-label={dayName.format(new Date(2026, 0, 4 + day))} onClick={() => setDays((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day]))}>
                {t.dayButton[day]}
              </button>
            ))}
            <small>{days.length ? repeatLabel(days, t) : t.noDay}</small>
          </fieldset>
          <h3>{words.view.colour}</h3>
          <ColorPicker label={t.colour} value={color} onChange={setColor} />
          <button type="submit" className="focus-primary" disabled={profile.alarms.length >= MAX_ALARMS}><Plus size={16} /> {t.add}</button>
          {profile.alarms.length >= MAX_ALARMS ? <p className="focus-note">{t.full(MAX_ALARMS)}</p> : null}
        </form>
      </section>

      <section className="focus-settings" aria-label={t.yours}>
        <h2>{t.yours}</h2>
        {profile.alarms.length ? (
          <ul className="focus-alarm-list">
            {[...profile.alarms].sort((left, right) => left.time.localeCompare(right.time)).map((alarm) => {
              const next = now ? nextAlarm(alarm, now) : undefined;
              return (
                <li key={alarm.id} style={focusColorStyle(alarm.color)} className={alarm.enabled ? "" : "is-off"}>
                  <span className="focus-alarm-swatch" aria-hidden="true" />
                  <div>
                    <strong>{alarm.time}</strong>
                    <span>{alarm.label || t.alarm} · {repeatLabel(alarm.days, t)}{next ? ` · ${untilLabel(next - now, t.until)}` : ""}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    className="focus-switch"
                    aria-checked={alarm.enabled}
                    aria-label={t.switchLabel(alarm.time, alarm.label)}
                    onClick={() => void saveAlarms(profile.alarms.map((item) => (item.id === alarm.id ? { ...item, enabled: !item.enabled } : item)))}
                  >
                    <span aria-hidden="true" />
                  </button>
                  <button type="button" className="focus-icon-button" aria-label={t.delete(alarm.time)} onClick={() => void saveAlarms(profile.alarms.filter((item) => item.id !== alarm.id))}>
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="focus-note">{t.empty}</p>
        )}
        <p className="focus-note">
          <Bell size={14} aria-hidden="true" /> {t.ringNote}
          {permission === "granted" && profile.preferences.notifications ? ` ${t.notificationsOn}` : null}
        </p>
        {permission !== "unsupported" && !(permission === "granted" && profile.preferences.notifications) ? (
          <button type="button" className="focus-secondary" disabled={permission === "denied"} onClick={() => void enableNotifications()}>
            {permission === "denied" ? t.blocked : t.enable}
          </button>
        ) : null}
      </section>
    </div>
  );
}

/** Bugünün toplamı, hedef, haftanın günleri ve bugünkü oturumlar. */
function TodayCard({ onProfile }: { onProfile: () => void }) {
  const { common, focus: words } = useT();
  const t = words.today;
  const { profile, log, liveIntervals } = useFocus();
  const now = useFocusClock();
  const { preferences } = profile;
  const totals = useMemo(() => dailyTotals(log, now ? liveIntervals(now) : []), [log, liveIntervals, now]);
  // Gün adları ve saat arayüzün dilinde.
  const { weekday, time } = useMemo(
    () => ({
      weekday: new Intl.DateTimeFormat(common.locale, { weekday: "short" }),
      time: new Intl.DateTimeFormat(common.locale, { hour: "numeric", minute: "2-digit", hour12: preferences.clock === "12h" }),
    }),
    [common.locale, preferences.clock],
  );
  if (!now) return <section className="focus-today" aria-label={t.label} aria-busy="true" />;
  const today = new Date(now);
  const summary = workSummary(totals, today, { weekStart: preferences.weekStart, goalMinutes: preferences.dailyGoalMinutes });
  const goal = preferences.dailyGoalMinutes * 60;
  const weekStart = startOfWeek(today, preferences.weekStart);
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = addDaysLocal(weekStart, index);
    return { key: dayKey(day), label: weekday.format(day), seconds: totals.get(dayKey(day)) ?? 0 };
  });
  const most = Math.max(goal, ...week.map((day) => day.seconds));
  const todayKey = dayKey(today);
  const sessions = log.sessions.filter((session) => dayKey(new Date(session.start)) === todayKey || dayKey(new Date(session.end)) === todayKey).slice(-6).reverse();

  return (
    <section className="focus-today" style={focusColorStyle(preferences.color)} aria-label={t.label}>
      <div className="focus-today-head">
        <div>
          <span>{t.label}</span>
          <strong>{words.duration(summary.today)}</strong>
          <small>{t.ofGoal(words.duration(goal), summary.currentStreak)}</small>
        </div>
        <button type="button" className="focus-secondary" onClick={onProfile}>{t.calendar}</button>
      </div>
      <div className="focus-goal" role="progressbar" aria-label={t.goal} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((summary.today / goal) * 100))}>
        <i style={{ width: `${Math.min(100, (summary.today / goal) * 100)}%` }} />
      </div>
      <ul className="focus-week" aria-label={t.week}>
        {week.map((day) => (
          <li key={day.key} className={day.key === todayKey ? "is-today" : ""} aria-label={`${day.label}: ${words.duration(day.seconds)}`}>
            <span className="focus-week-bar" aria-hidden="true"><i style={{ height: `${Math.max(day.seconds ? 4 : 0, (day.seconds / most) * 100)}%` }} /></span>
            <small aria-hidden="true">{day.label}</small>
          </li>
        ))}
      </ul>
      {sessions.length ? (
        <ul className="focus-sessions" aria-label={t.sessions}>
          {sessions.map((session) => (
            <li key={session.id}>
              <span>{time.format(new Date(session.start))}–{time.format(new Date(session.end))}</span>
              <span>
                {session.label || words.sessionKinds[session.kind]}
                {session.note ? <small className="focus-session-note">{session.note}</small> : null}
              </span>
              <strong>{words.duration((Date.parse(session.end) - Date.parse(session.start)) / 1000)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="focus-note">{t.empty}</p>
      )}
    </section>
  );
}

/**
 * Tam ekran: yalnızca büyük saat, faz, bir ilerleme çizgisi ve iki düğme.
 * Tarayıcı izin verirse gerçekten tam ekran; vermezse sayfayı kaplayan bir katman.
 */
function FocusStage({ tab, subject, papers, onClose, reviewWaiting, onReview }: { tab: Exclude<TimerMode, "alarm">; subject: string; papers: readonly Paper[]; onClose: () => void; reviewWaiting: number; onReview: () => void }) {
  const { view, stage: t, timerPanel, stopwatchPanel } = useT().focus;
  const { profile, store, actions } = useFocus();
  const now = useFocusClock();
  const ref = useRef<HTMLDivElement>(null);
  const entered = useRef(false);

  useEffect(() => {
    const element = ref.current;
    element?.focus();
    const onChange = () => {
      if (document.fullscreenElement) entered.current = true;
      else if (entered.current) onClose();
    };
    document.addEventListener("fullscreenchange", onChange);
    if (element?.requestFullscreen && !document.fullscreenElement) void element.requestFullscreen().catch(() => undefined);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);

  let time = "00:00";
  let caption = "";
  let progress = 0;
  let label = "";
  let running = false;
  let color = profile.preferences.colors[tab];
  if (tab === "focus") {
    const shown = focusDisplay(store.focus, profile, now);
    time = formatClock(shown.remaining, "up");
    caption = shown.finished ? t.allDone : t.caption(shown.phase, shown.round, profile.preferences.focus.rounds);
    progress = store.focus && !store.focus.finished ? 1 - shown.remaining / shown.total : 0;
    label = store.focus?.label ?? subject;
    running = shown.running;
  } else if (tab === "timer") {
    const timer = store.timer;
    const remaining = timer ? countdownRemaining(timer, now) : profile.preferences.timerSeconds * 1000;
    time = formatClock(remaining, "up");
    caption = timer?.done ? timerPanel.timesUp : timerPanel.label;
    progress = timer ? 1 - remaining / timer.duration : 0;
    label = timer?.label ?? subject;
    running = Boolean(timer?.clock.running);
  } else {
    const stopwatch = store.stopwatch;
    time = formatClock(stopwatch ? elapsedOf(stopwatch.clock, now) : 0);
    caption = stopwatchPanel.label;
    progress = stopwatch ? (elapsedOf(stopwatch.clock, now) % 60_000) / 60_000 : 0;
    label = stopwatch?.label ?? subject;
    running = Boolean(stopwatch?.clock.running);
    color = profile.preferences.colors.stopwatch;
  }
  const toggle = () => primaryAction(tab, store, actions, profile.preferences.timerSeconds, resolveSubject(subject, papers));

  return (
    <div
      ref={ref}
      className="focus-stage"
      role="dialog"
      aria-modal="true"
      aria-label={t.label}
      tabIndex={-1}
      style={focusColorStyle(color)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <p className="focus-stage-phase">{caption}</p>
      <strong className="focus-stage-time" role="timer">{time}</strong>
      {label ? <p className="focus-stage-label">{label}</p> : null}
      <div className="focus-stage-bar" aria-hidden="true"><i style={{ width: `${Math.round(progress * 1000) / 10}%` }} /></div>
      <div className="focus-controls">
        <button type="button" className="focus-primary" onClick={toggle}>{running ? <><Pause size={16} /> {view.pause}</> : <><Play size={16} /> {tab === "focus" && store.focus && !store.focus.finished ? view.resume : view.start}</>}</button>
        {tab === "focus" && store.focus && !store.focus.finished ? <button type="button" onClick={actions.skipFocus}><SkipForward size={15} /> {t.skip}</button> : null}
        <button type="button" onClick={onClose}><Minimize2 size={15} /> {t.leave}</button>
      </div>
      {tab === "focus" && reviewWaiting ? (
        <button type="button" className="focus-stage-review" onClick={onReview}><Layers size={15} /> {t.review(reviewWaiting)}</button>
      ) : null}
      <small className="focus-stage-keys">{t.keys}</small>
    </div>
  );
}

/** Boşluk tuşu ve tam ekrandaki düğme: sekmedeki sayacı başlat, duraklat ya da sürdür. */
function primaryAction(tab: Exclude<TimerMode, "alarm">, store: ReturnType<typeof useFocus>["store"], actions: ReturnType<typeof useFocus>["actions"], timerSeconds: number, subject: Subject) {
  if (tab === "focus") {
    const focus = store.focus;
    if (!focus || focus.finished) actions.startFocus(subject);
    else if (focus.clock.running) actions.pauseFocus();
    else actions.resumeFocus();
  } else if (tab === "timer") {
    const timer = store.timer;
    if (!timer || timer.done) actions.startTimer(timerSeconds * 1000, subject);
    else if (timer.clock.running) actions.pauseTimer();
    else actions.resumeTimer();
  } else {
    const stopwatch = store.stopwatch;
    if (!stopwatch) actions.startStopwatch(subject);
    else if (stopwatch.clock.running) actions.pauseStopwatch();
    else actions.resumeStopwatch();
  }
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || Boolean(target.closest("[role='radiogroup'], [role='tablist']")));

/**
 * Çalışma saati: odak turları ve molalar, geri sayım, kronometre ve alarm.
 * Sayaçlar ekrandan çıkınca da sürüyor (`focus-provider.tsx`).
 */
export function FocusView({ projects, backLabel, onBack, onProfile }: { projects: ResearchProject[]; backLabel: string; onBack: () => void; onProfile: () => void }) {
  const words = useT().focus;
  const t = words.view;
  const { profile, profileError, store, actions } = useFocus();
  const now = useFocusClock();
  const [subjects, setSubjects] = useState<Subjects>({ focus: "", timer: "", stopwatch: "" });
  const [stage, setStage] = useState(false);
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
  const papers = useMemo<Paper[]>(() => {
    const seen = new Set<string>();
    return projects.flatMap((project) => {
      const title = project.evidence.paper.title;
      if (seen.has(title)) return [];
      seen.add(title);
      return [{ id: project.id, title }];
    }).slice(0, 300);
  }, [projects]);
  const firstName = profile.firstName.trim();
  const timerTab = tab === "alarm" ? undefined : tab;
  const closeStage = useCallback(() => setStage(false), []);
  const review = useBreakReview(projects, profile.preferences.breakReview ? shortBreakKey(store.focus) : undefined);

  // Klavye: boşluk başlat/duraklat, F tam ekran, S atla, L tur, 1–4 sekmeler. Yazarken ya da bir düğmedeyken değil.
  const latest = useRef({ tab, store, actions, subjects, papers, timerSeconds: profile.preferences.timerSeconds });
  useEffect(() => {
    latest.current = { tab, store, actions, subjects, papers, timerSeconds: profile.preferences.timerSeconds };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || typing(event.target)) return;
      const current = latest.current;
      const key = event.key.toLowerCase();
      if (/^[1-4]$/.test(key)) {
        choose(TABS[Number(key) - 1].id);
        return;
      }
      if (current.tab === "alarm") return;
      if (key === " ") {
        event.preventDefault();
        primaryAction(current.tab, current.store, current.actions, current.timerSeconds, resolveSubject(current.subjects[current.tab], current.papers));
      } else if (key === "f") setStage((open) => !open);
      else if (key === "s" && current.tab === "focus" && current.store.focus && !current.store.focus.finished) current.actions.skipFocus();
      else if (key === "l" && current.tab === "stopwatch" && current.store.stopwatch?.clock.running) current.actions.lapStopwatch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="compare-page focus-page" style={focusColorStyle(profile.preferences.color)}>
      <header className="library-header">
        <button className="brand" onClick={onBack} aria-label={backLabel}>
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>{words.brandTagline}</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> {backLabel}</button>
          <DisplayControl />
          <StudioNav />
        </div>
      </header>

      <section className="compare-hero focus-hero">
        <p className="landing-eyebrow"><span /> {t.eyebrow}</p>
        <h1>{now ? t.greeting(new Date(now).getHours()) : t.hello}{firstName ? `, ${firstName}` : ""}.</h1>
        <p>{t.intro}</p>
      </section>
      {profileError ? <p className="regen-error stats-note" role="alert">{profileError}</p> : null}

      <div className="focus-layout">
        <div>
          <div className="focus-tabs" role="tablist" aria-label={t.tablist}>
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
                  <Icon size={15} aria-hidden="true" /> {t.tabs[item.id]}
                </button>
              );
            })}
          </div>
          <div id="focus-tabpanel" role="tabpanel" aria-labelledby={`focus-tab-${tab}`}>
            {timerTab ? (
              (() => {
                const props: PanelProps = { papers, subject: subjects[timerTab], onSubject: (text) => setSubjects((current) => ({ ...current, [timerTab]: text })), onStage: () => setStage(true) };
                if (timerTab === "focus") return <FocusPanel {...props} review={review} projects={projects} />;
                const Panel = timerTab === "timer" ? TimerPanel : StopwatchPanel;
                return <Panel {...props} />;
              })()
            ) : (
              <AlarmsPanel />
            )}
          </div>
          <datalist id="focus-papers">{papers.map((paper) => <option key={paper.id} value={paper.title} />)}</datalist>
          <p className="focus-keys">
            <kbd>Space</kbd> {t.keys.startPause} · <kbd>F</kbd> {t.keys.fullScreen} · <kbd>S</kbd> {t.keys.skip} · <kbd>L</kbd> {t.keys.lap} · <kbd>1</kbd>–<kbd>4</kbd> {t.keys.switchTimers}
          </p>
        </div>
        <TodayCard onProfile={onProfile} />
      </div>
      {stage && timerTab ? (
        <FocusStage
          tab={timerTab}
          subject={subjects[timerTab]}
          papers={papers}
          onClose={closeStage}
          reviewWaiting={review.waiting}
          onReview={() => {
            closeStage();
            review.begin();
          }}
        />
      ) : null}
    </main>
  );
}
