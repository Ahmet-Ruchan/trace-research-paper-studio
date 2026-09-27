import type { Alarm, FocusSettings } from "./profile";
import type { SessionKind } from "./work-log";

/**
 * Çalışma saatinin motoru: odak döngüleri, geri sayım, kronometre ve alarm.
 *
 * Saf fonksiyonlar, zaman milisaniye olarak dışarıdan geliyor; tarayıcı
 * sayacı yalnızca "şimdi"yi soruyor. Süre saymak yerine zaman damgası
 * tutuluyor: arka plandaki bir sekmede tarayıcı zamanlayıcıları dakikada bir
 * kereye kadar yavaşlatıyor, sayılan saniyeler kayardı; damgadan hesaplanan
 * süre kaymıyor.
 *
 * Bir fazın bitişi GERÇEK bitiş anına yazılıyor, fark edildiği ana değil: arka
 * planda bir dakika geç fark edilen tur yine tam 25 dakika kaydediliyor ve
 * sonraki faz o anda başlıyor. Otomatik döngü sayfa açık kaldıkça sürüyor.
 *
 * Sayfa kapalıyken ya da bilgisayar uykudayken çalışılmış sayılmıyor: son
 * canlı an (`lastAlive`) `STALE_MS`'ten eskiyse sayaç o anda duraklatılıyor ve
 * kayıt oraya kadar yapılıyor. Kapalı bir sekmede "çalışan" kronometre ertesi
 * gün 14 saat yazmıyor.
 */

/** Bu kadar süre canlılık işareti gelmediyse sayfa kapalıydı ya da makine uyuyordu. */
export const STALE_MS = 3 * 60_000;
/** Kaçırılan bir alarm bu kadar gecikmeyle hâlâ çalıyor; daha eskisi sessizce geçiyor. */
export const ALARM_GRACE_MS = 2 * 60_000;
export const MAX_LAPS = 99;

export type Clock = { running: boolean; since: number; elapsed: number };
export const idleClock: Clock = { running: false, since: 0, elapsed: 0 };

export function elapsedOf(clock: Clock, now: number) {
  return clock.elapsed + (clock.running ? Math.max(0, now - clock.since) : 0);
}

const startClock = (clock: Clock, now: number): Clock => ({ running: true, since: now, elapsed: clock.elapsed });
const pauseClock = (clock: Clock, at: number): Clock => ({ running: false, since: 0, elapsed: elapsedOf(clock, at) });

/** Kaydedilecek bir çalışma aralığı. */
export type Segment = { kind: SessionKind; start: number; end: number; label?: string };

const segmentOf = (kind: SessionKind, clock: Clock, until: number, label?: string): Segment[] =>
  clock.running && until - clock.since >= 1000 ? [{ kind, start: clock.since, end: until, ...(label ? { label } : {}) }] : [];

export type FocusPhase = "work" | "short" | "long";

export type FocusRun = {
  phase: FocusPhase;
  /** Tamamlanan odak turları. */
  completed: number;
  clock: Clock;
  /** Fazın süresi, faz başlarken alınıyor: ayar ortada değişirse süren faz zıplamıyor. */
  duration: number;
  /** Faz bitti, sonraki okuyucunun başlatmasını bekliyor (otomatik başlatma kapalı). */
  waiting: boolean;
  /** İstenen tur sayısı tamamlandı. */
  finished: boolean;
  label?: string;
};

export type TimerEvent =
  | { type: "phase-end"; from: FocusPhase; to: FocusPhase | "done"; at: number; autoStarted: boolean }
  | { type: "countdown-end"; at: number; label?: string }
  | { type: "interrupted"; at: number; timer: "focus" | "timer" | "stopwatch" };

export type Advance<T> = { run: T; segments: Segment[]; events: TimerEvent[] };

export function phaseMs(settings: FocusSettings, phase: FocusPhase) {
  return (phase === "work" ? settings.work : phase === "short" ? settings.shortBreak : settings.longBreak) * 60_000;
}

/** Ekrandaki tur: odakta sıradaki, molada az önce biten. */
export function focusRound(run: Pick<FocusRun, "phase" | "completed">) {
  return run.phase === "work" ? run.completed + 1 : run.completed;
}

export function startFocus(settings: FocusSettings, now: number, label?: string): FocusRun {
  return { phase: "work", completed: 0, clock: startClock(idleClock, now), duration: phaseMs(settings, "work"), waiting: false, finished: false, ...(label?.trim() ? { label: label.trim() } : {}) };
}

export function focusRemaining(run: FocusRun, now: number) {
  return Math.max(0, run.duration - elapsedOf(run.clock, now));
}

/** Bir odak turundan sonra: uzun mola her `longEvery` turda bir; istenen tur sayısına ulaşıldıysa bitti. */
export function nextPhase(settings: FocusSettings, run: Pick<FocusRun, "phase" | "completed">): { phase: FocusPhase; completed: number } | "done" {
  if (run.phase !== "work") return { phase: "work", completed: run.completed };
  const completed = run.completed + 1;
  if (settings.rounds && completed >= settings.rounds) return "done";
  return { phase: completed % settings.longEvery === 0 ? "long" : "short", completed };
}

export function pauseFocus(run: FocusRun, now: number): Advance<FocusRun> {
  return { run: { ...run, clock: pauseClock(run.clock, now) }, segments: run.phase === "work" ? segmentOf("focus", run.clock, now, run.label) : [], events: [] };
}

/** Duraklatılmış fazı sürdürür ya da bekleyen fazı başlatır. */
export function resumeFocus(run: FocusRun, now: number): FocusRun {
  if (run.finished || run.clock.running) return run;
  return { ...run, waiting: false, clock: startClock(run.clock, now) };
}

function enter(settings: FocusSettings, run: FocusRun, next: { phase: FocusPhase; completed: number }, at: number, running: boolean): FocusRun {
  return {
    ...run,
    phase: next.phase,
    completed: next.completed,
    duration: phaseMs(settings, next.phase),
    clock: running ? { running: true, since: at, elapsed: 0 } : idleClock,
    waiting: !running,
  };
}

/** Sıradaki faza geç: okuyucu istediği için hemen başlıyor. Odaktan atlanırsa çalışılan kısmı kaydediliyor ama tur sayılmıyor. */
export function skipFocus(run: FocusRun, settings: FocusSettings, now: number): Advance<FocusRun> {
  const segments = run.phase === "work" ? segmentOf("focus", run.clock, now, run.label) : [];
  const next = run.phase === "work" ? { phase: "short" as const, completed: run.completed } : { phase: "work" as const, completed: run.completed };
  return { run: enter(settings, run, next, now, true), segments, events: [] };
}

export function stopFocus(run: FocusRun, now: number): Segment[] {
  return run.phase === "work" ? segmentOf("focus", run.clock, now, run.label) : [];
}

/**
 * Zamanı ilerletir: biten fazları gerçek bitiş anlarıyla kapatır, otomatik
 * başlatma açıksa sonrakini o anda başlatır. Sayfa kapalı kaldıysa son canlı
 * anda duraklatır.
 */
export function advanceFocus(run: FocusRun, settings: FocusSettings, now: number, lastAlive: number): Advance<FocusRun> {
  const alive = now - lastAlive > STALE_MS ? lastAlive : now;
  const segments: Segment[] = [];
  const events: TimerEvent[] = [];
  let current = run;
  for (let guard = 0; guard < 500 && current.clock.running; guard += 1) {
    const endAt = current.clock.since + (current.duration - current.clock.elapsed);
    if (endAt > alive) break;
    if (current.phase === "work") segments.push(...segmentOf("focus", current.clock, endAt, current.label));
    const next = nextPhase(settings, current);
    if (next === "done") {
      current = { ...current, completed: current.completed + 1, clock: { running: false, since: 0, elapsed: current.duration }, finished: true, waiting: false };
      events.push({ type: "phase-end", from: "work", to: "done", at: endAt, autoStarted: false });
      break;
    }
    const auto = next.phase === "work" ? settings.autoStartWork : settings.autoStartBreaks;
    events.push({ type: "phase-end", from: current.phase, to: next.phase, at: endAt, autoStarted: auto });
    current = enter(settings, current, next, endAt, auto);
  }
  if (alive < now && current.clock.running) {
    if (current.phase === "work") segments.push(...segmentOf("focus", current.clock, alive, current.label));
    current = { ...current, clock: pauseClock(current.clock, alive) };
    events.push({ type: "interrupted", at: alive, timer: "focus" });
  }
  return { run: current, segments, events };
}

/* ------------------------------------------------------------------ *
 * Geri sayım
 * ------------------------------------------------------------------ */

export type CountdownRun = { duration: number; clock: Clock; done: boolean; label?: string };

export function startCountdown(duration: number, now: number, label?: string): CountdownRun {
  return { duration, clock: startClock(idleClock, now), done: false, ...(label?.trim() ? { label: label.trim() } : {}) };
}

export function countdownRemaining(run: CountdownRun, now: number) {
  return Math.max(0, run.duration - elapsedOf(run.clock, now));
}

export function pauseCountdown(run: CountdownRun, now: number): Advance<CountdownRun> {
  return { run: { ...run, clock: pauseClock(run.clock, now) }, segments: segmentOf("timer", run.clock, now, run.label), events: [] };
}

export function resumeCountdown(run: CountdownRun, now: number): CountdownRun {
  return run.done || run.clock.running ? run : { ...run, clock: startClock(run.clock, now) };
}

/** Süre ekler; bitmiş bir sayımı da yeniden başlatıyor ("bir dakika daha"). */
export function extendCountdown(run: CountdownRun, ms: number, now: number): CountdownRun {
  if (run.done) return { ...run, done: false, duration: run.duration + ms, clock: startClock(run.clock, now) };
  return { ...run, duration: run.duration + ms };
}

export function advanceCountdown(run: CountdownRun, now: number, lastAlive: number): Advance<CountdownRun> {
  const alive = now - lastAlive > STALE_MS ? lastAlive : now;
  if (!run.clock.running) return { run, segments: [], events: [] };
  const endAt = run.clock.since + (run.duration - run.clock.elapsed);
  if (endAt <= alive) {
    return {
      run: { ...run, done: true, clock: { running: false, since: 0, elapsed: run.duration } },
      segments: segmentOf("timer", run.clock, endAt, run.label),
      events: [{ type: "countdown-end", at: endAt, ...(run.label ? { label: run.label } : {}) }],
    };
  }
  if (alive < now) {
    return { run: { ...run, clock: pauseClock(run.clock, alive) }, segments: segmentOf("timer", run.clock, alive, run.label), events: [{ type: "interrupted", at: alive, timer: "timer" }] };
  }
  return { run, segments: [], events: [] };
}

/* ------------------------------------------------------------------ *
 * Kronometre
 * ------------------------------------------------------------------ */

export type StopwatchRun = { clock: Clock; laps: number[]; label?: string };

export function startStopwatch(now: number, label?: string): StopwatchRun {
  return { clock: startClock(idleClock, now), laps: [], ...(label?.trim() ? { label: label.trim() } : {}) };
}

export function pauseStopwatch(run: StopwatchRun, now: number): Advance<StopwatchRun> {
  return { run: { ...run, clock: pauseClock(run.clock, now) }, segments: segmentOf("stopwatch", run.clock, now, run.label), events: [] };
}

export function resumeStopwatch(run: StopwatchRun, now: number): StopwatchRun {
  return run.clock.running ? run : { ...run, clock: startClock(run.clock, now) };
}

/** Tur: o ana kadarki toplam süre kaydediliyor; tur süresi farktan. */
export function lapStopwatch(run: StopwatchRun, now: number): StopwatchRun {
  if (run.laps.length >= MAX_LAPS) return run;
  return { ...run, laps: [...run.laps, elapsedOf(run.clock, now)] };
}

export function lapTimes(run: Pick<StopwatchRun, "laps">) {
  return run.laps.map((total, index) => ({ lap: index + 1, split: total - (run.laps[index - 1] ?? 0), total }));
}

export function advanceStopwatch(run: StopwatchRun, now: number, lastAlive: number): Advance<StopwatchRun> {
  if (!run.clock.running || now - lastAlive <= STALE_MS) return { run, segments: [], events: [] };
  return {
    run: { ...run, clock: pauseClock(run.clock, lastAlive) },
    segments: segmentOf("stopwatch", run.clock, lastAlive, run.label),
    events: [{ type: "interrupted", at: lastAlive, timer: "stopwatch" }],
  };
}

/* ------------------------------------------------------------------ *
 * Alarm
 * ------------------------------------------------------------------ */

/** Alarmın verilen gündeki anı, yerel saatle. */
export function alarmAt(alarm: Pick<Alarm, "time">, day: Date) {
  const [hours, minutes] = alarm.time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes).getTime();
}

const ringsOn = (alarm: Pick<Alarm, "days">, day: Date) => !alarm.days.length || alarm.days.includes(day.getDay());

/**
 * (since, now] aralığında çalması gereken alarmlar. Gece yarısını geçen bir
 * aralık için dün de bakılıyor; `ALARM_GRACE_MS`'ten eski bir an çalmıyor
 * (bilgisayar sabaha kadar uyuduysa akşamki alarm sabah çalmasın).
 */
export function dueAlarms(alarms: readonly Alarm[], since: number, now: number) {
  const today = new Date(now);
  const days = [new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1), today];
  return alarms.flatMap((alarm) => {
    if (!alarm.enabled) return [];
    const at = days.filter((day) => ringsOn(alarm, day)).map((day) => alarmAt(alarm, day)).find((moment) => moment > since && moment <= now && now - moment <= ALARM_GRACE_MS);
    return at === undefined ? [] : [{ alarm, at }];
  });
}

/** Alarmın bir sonraki çalışı; kapalıysa ya da hiçbir gün seçili değilse ve bugün geçtiyse yarın. */
export function nextAlarm(alarm: Alarm, now: number) {
  if (!alarm.enabled) return undefined;
  const today = new Date(now);
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const at = alarmAt(alarm, day);
    if (at > now && ringsOn(alarm, day)) return at;
  }
  return undefined;
}
