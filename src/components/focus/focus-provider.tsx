"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FocusColorId } from "@/lib/focus-colors";
import {
  advanceCountdown,
  advanceFocus,
  advanceStopwatch,
  ALARM_GRACE_MS,
  countdownRemaining,
  dueAlarms,
  elapsedOf,
  extendCountdown,
  focusRemaining,
  focusRound,
  lapStopwatch,
  pauseCountdown,
  pauseFocus,
  pauseStopwatch,
  phaseMs,
  resumeCountdown,
  resumeFocus,
  resumeStopwatch,
  skipFocus,
  startCountdown,
  startFocus,
  startStopwatch,
  stopFocus,
  type CountdownRun,
  type FocusRun,
  type Segment,
  type StopwatchRun,
  type Subject,
  type TimerEvent,
} from "@/lib/focus-timer";
import { emptyProfile, WORK_DATA_KIND, type Alarm, type Profile } from "@/lib/profile";
import { describeBackupImport, type BackupSummary } from "@/lib/full-backup";
import { lastWeekSummary, weekSummaryText } from "@/lib/work-export";
import { addSessions, emptyWorkLog, formatClock, formatDuration, MAX_SESSION_NOTE, removeSession, roundSession, sessionPieces, type ReviewBlock, type WorkLog, type WorkSession } from "@/lib/work-log";
import { playSound, setAmbient, stopAmbient, unlockAudio } from "./focus-sound";

/**
 * Çalışma saatinin durumu, bütün ekranlar için.
 *
 * Sayaç stüdyonun kökünde yaşıyor: okuyucu Lab'de makale okurken de tur
 * bitiyor, mola başlıyor, alarm çalıyor. Çalışan sayaçların durumu bu
 * tarayıcıda (`localStorage`) tutuluyor, sayfa yenilenince kaldığı yerden
 * sürüyor; biten her çalışma aralığı sunucudaki kayda yazılıyor
 * (`/api/profile/sessions`). Yazılamayan aralık bekleme listesinde kalıyor ve
 * yeniden deneniyor: sunucu kapalıyken yapılan çalışma da kaybolmuyor.
 *
 * Birden çok sekme açıksa yalnızca biri ("önder") zamanı ilerletiyor, kaydediyor
 * ve zili çalıyor; ötekiler aynı durumu gösteriyor. Görünen sekme önderliği
 * arka plandakinden alıyor.
 */

const STORAGE_KEY = "trace-focus-v1";
const LEADER_KEY = "trace-focus-leader";
const LEADER_STALE_MS = 5_000;
const RING_EVERY_MS = 4_000;
const RING_FOR_MS = 60_000;
const RETRY_MS = 15_000;
const MAX_ALERTS = 4;
/** Haftalık özetin gösterildiği hafta (ilk günü). */
const WEEK_SUMMARY_KEY = "trace-week-summary";
export const SNOOZE_MS = 5 * 60_000;

type Snooze = { alarmId: string; at: number };

export type FocusAlert = {
  id: string;
  kind: "phase" | "done" | "timer" | "alarm" | "notice" | "summary";
  title: string;
  body?: string;
  color: FocusColorId;
  at: number;
  /** Zil bu ana kadar çalıyor; 0 sessiz. */
  ringUntil: number;
  /** `report`: profilin haftalık raporu (bildirim çubuğu açıyor). */
  action?: "start-next" | "skip-break" | "restart" | "extend" | "snooze" | "resume" | "report";
  /** Düğmenin yazısı, eylemin varsayılanından farklıysa. */
  actionLabel?: string;
  alarmId?: string;
  resume?: "focus" | "timer" | "stopwatch";
  /** Biten odak turunun bitiş anı: bildirimde "ne yaptın?" notu o turun oturumuna yazılıyor. */
  roundEnd?: number;
};

export type FocusStore = {
  version: 1;
  focus?: FocusRun;
  timer?: CountdownRun;
  stopwatch?: StopwatchRun;
  lastAlive: number;
  alarmCheck: number;
  snoozes: Snooze[];
  alerts: FocusAlert[];
  /** Sunucuya henüz yazılamamış oturumlar. */
  pending: WorkSession[];
  /**
   * Tarayıcı arka plandaki sekmeyi dondurdu (Chrome'un enerji tasarrufu, bellek
   * tasarrufu). Sekme kapanmadı: donmuş kaldığı süre de çalışılmış sayılıyor.
   */
  frozenAt?: number;
};

const freshStore = (now: number): FocusStore => ({ version: 1, lastAlive: now, alarmCheck: now, snoozes: [], alerts: [], pending: [] });

function readStore(now: number): FocusStore {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<FocusStore> | null;
    if (!raw || raw.version !== 1) return freshStore(now);
    return { ...freshStore(now), ...raw, snoozes: raw.snoozes ?? [], alerts: raw.alerts ?? [], pending: raw.pending ?? [] };
  } catch {
    return freshStore(now);
  }
}

function writeStore(store: FocusStore) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Dolu ya da kapalı depolama: sayaç bu sekmede sürüyor, yalnızca yenilemede kalmıyor.
  }
}

export type FocusActions = {
  startFocus: (subject?: Subject) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  skipFocus: () => void;
  stopFocus: () => void;
  startTimer: (ms: number, subject?: Subject) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  extendTimer: (ms: number) => void;
  stopTimer: () => void;
  startStopwatch: (subject?: Subject) => void;
  pauseStopwatch: () => void;
  resumeStopwatch: () => void;
  lapStopwatch: () => void;
  stopStopwatch: () => void;
};

export type FocusContextValue = {
  profile: Profile;
  profileReady: boolean;
  profileError?: string;
  saveProfile: (next: Profile) => Promise<boolean>;
  log: WorkLog;
  logReady: boolean;
  logError?: string;
  addSessions: (sessions: WorkSession[]) => Promise<boolean>;
  deleteSession: (id: string) => Promise<boolean>;
  importData: (file: File) => Promise<string>;
  store: FocusStore;
  actions: FocusActions;
  /** Şu an süren ve çalışma sayılan aralıklar: "bugün" canlı artsın. */
  liveIntervals: (now: number) => Array<[number, number]>;
  dismissAlert: (id: string) => void;
  runAlert: (alert: FocusAlert) => void;
  previewSound: () => void;
  /** Arka plan sesini birkaç saniye çalar (odak turu sürmüyorsa sonra susuyor). */
  previewAmbient: () => void;
  /** Tekrar ekranında geçen süre (`extendReviewBlock`); ayar kapalıysa yazılmıyor. */
  logReviewTime: (block: ReviewBlock, subject?: Subject) => void;
  /** Study yolunda geçen süre; `ReviewBlock` gibi adım adım uzayan bir oturum. */
  logStudyTime: (block: ReviewBlock, subject?: Subject) => void;
  /** Biten turun oturumuna "ne yaptın?" notu; tur bulunamazsa `false`. */
  noteRound: (endAt: number, note: string) => boolean;
};

const FocusContext = createContext<FocusContextValue | undefined>(undefined);
const ClockContext = createContext(0);

export function useFocus() {
  const value = useContext(FocusContext);
  if (!value) throw new Error("useFocus must be used inside FocusProvider.");
  return value;
}

/** Saniyede bir güncellenen "şimdi"; yalnızca sayaç gösteren bileşenler abone. */
export function useFocusClock() {
  return useContext(ClockContext);
}

const withoutAlerts = (current: FocusStore, kinds: FocusAlert["kind"][]) => ({ ...current, alerts: current.alerts.filter((alert) => !kinds.includes(alert.kind)) });

const clockTime = (at: number, clock: "24h" | "12h") =>
  new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", hour12: clock === "12h" }).format(at);

const phaseName = { work: "focus", short: "short break", long: "long break" } as const;

function alertFor(event: TimerEvent, store: FocusStore, profile: Profile, now: number): FocusAlert | undefined {
  const { preferences } = profile;
  const base = { id: `${event.type}-${event.at}`, at: event.at };
  const ring = now + RING_FOR_MS;
  if (event.type === "phase-end") {
    const focus = store.focus;
    const minutes = (phase: "short" | "long") => (phase === "short" ? preferences.focus.shortBreak : preferences.focus.longBreak);
    if (event.to === "done") {
      const rounds = focus?.completed ?? 0;
      return { ...base, kind: "done", title: "All rounds done", body: `${rounds} ${rounds === 1 ? "round" : "rounds"}, ${formatDuration(rounds * preferences.focus.work * 60)} of focus. Well done.`, color: preferences.colors.focus, ringUntil: ring, action: "restart", roundEnd: event.at };
    }
    if (event.from === "work") {
      const to = event.to as "short" | "long";
      return event.autoStarted
        ? { ...base, kind: "phase", title: "Time for a break", body: `Focus round ${focus?.completed ?? ""} done. Your ${minutes(to)}-minute ${phaseName[to]} has started.`, color: preferences.colors.focus, ringUntil: ring, action: "skip-break", roundEnd: event.at }
        : { ...base, kind: "phase", title: "Focus round done", body: `Start your ${minutes(to)}-minute ${phaseName[to]} when you are ready.`, color: preferences.colors.focus, ringUntil: ring, action: "start-next", actionLabel: "Start the break", roundEnd: event.at };
    }
    const round = (focus?.completed ?? 0) + 1;
    return event.autoStarted
      ? { ...base, kind: "phase", title: "Back to focus", body: `Round ${round} has started.`, color: preferences.colors.focus, ringUntil: ring }
      : { ...base, kind: "phase", title: "Break is over", body: `Start round ${round} when you are ready.`, color: preferences.colors.focus, ringUntil: ring, action: "start-next", actionLabel: "Start focus" };
  }
  if (event.type === "countdown-end") {
    return { ...base, kind: "timer", title: "Time’s up", body: event.label || "Your timer has finished.", color: preferences.colors.timer, ringUntil: ring, action: "extend" };
  }
  const names = { focus: "focus timer", timer: "timer", stopwatch: "stopwatch" } as const;
  return {
    id: `interrupted-${event.timer}-${event.at}`,
    at: event.at,
    kind: "notice",
    title: `Your ${names[event.timer]} was paused`,
    body: `Trace was closed or the computer was asleep. The time up to ${clockTime(event.at, preferences.clock)} is saved; nothing after it was counted.`,
    color: preferences.colors[event.timer],
    ringUntil: 0,
    action: "resume",
    resume: event.timer,
  };
}

function alarmAlert(alarm: Alarm, at: number, now: number, clock: "24h" | "12h"): FocusAlert {
  return {
    id: `alarm-${alarm.id}-${at}`,
    at,
    kind: "alarm",
    title: `${clockTime(at, clock)}${alarm.label ? ` · ${alarm.label}` : ""}`,
    body: alarm.label ? "Your alarm is ringing." : "Alarm",
    color: alarm.color,
    ringUntil: now + RING_FOR_MS,
    action: "snooze",
    alarmId: alarm.id,
  };
}

function notify(alert: FocusAlert, profile: Profile) {
  if (!profile.preferences.notifications || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    new Notification(alert.title, { body: alert.body, tag: alert.id });
  } catch {
    // Bazı tarayıcılar yalnızca service worker üzerinden bildirim gösteriyor.
  }
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile>(() => emptyProfile(new Date(0).toISOString()));
  const [profileReady, setProfileReady] = useState(false);
  const [profileError, setProfileError] = useState<string>();
  const [log, setLog] = useState<WorkLog>(emptyWorkLog);
  const logRef = useRef(log);
  useEffect(() => {
    logRef.current = log;
  }, [log]);
  const [logReady, setLogReady] = useState(false);
  const [logError, setLogError] = useState<string>();
  const [store, setStore] = useState<FocusStore>(() => freshStore(0));
  const [now, setNow] = useState(0);

  const storeRef = useRef(store);
  const profileRef = useRef(profile);
  const readyRef = useRef(false);
  const loadedRef = useRef(false);
  const tabId = useRef("");
  const lastRing = useRef(0);
  const flushing = useRef(false);
  const lastFlush = useRef(0);
  const lastPersist = useRef(0);
  const ambientPreview = useRef(false);
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  const commit = useCallback((next: FocusStore) => {
    storeRef.current = next;
    writeStore(next);
    setStore(next);
  }, []);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  /** Sunucuya yazılamamış oturumları gönderir; başaramazsa bir sonraki denemeye kalıyor. */
  const flush = useCallback(async () => {
    const pending = storeRef.current.pending;
    if (!pending.length || flushing.current) return;
    flushing.current = true;
    lastFlush.current = Date.now();
    try {
      const response = await fetch("/api/profile/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessions: pending.slice(0, 500) }) });
      const sent = new Set(pending.slice(0, 500).map((session) => session.id));
      // 400: geçersiz bir oturum (ör. saati çok ileri bir sekme) sonsuza kadar denenmesin.
      if (response.ok || response.status === 400) commit({ ...storeRef.current, pending: storeRef.current.pending.filter((session) => !sent.has(session.id)) });
    } catch {
      // Sunucu kapalı: oturumlar bekleme listesinde, sonra yeniden deneniyor.
    } finally {
      flushing.current = false;
    }
  }, [commit]);

  /** Biten aralıkları kayda çeviriyor; geri sayım ve kronometre ayara göre sayılıyor. */
  const record = useCallback((segments: Segment[], current: FocusStore): FocusStore => {
    const { preferences } = profileRef.current;
    const sessions = segments
      .filter((segment) => segment.kind === "focus" || segment.kind === "manual" || (segment.kind === "timer" ? preferences.timerCountsAsWork : preferences.stopwatchCountsAsWork))
      .flatMap((segment) =>
        sessionPieces({ kind: segment.kind, label: segment.label, projectId: segment.projectId, color: preferences.colors[segment.kind === "timer" || segment.kind === "stopwatch" ? segment.kind : "focus"] }, segment.start, segment.end),
      );
    if (!sessions.length) return current;
    setLog((existing) => addSessions(existing, sessions));
    return { ...current, pending: [...current.pending, ...sessions] };
  }, []);

  const isLeader = useCallback((now: number) => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(LEADER_KEY) ?? "null") as { id: string; at: number; visible: boolean } | null;
      const visible = document.visibilityState === "visible";
      const lead = !raw || raw.id === tabId.current || now - raw.at > LEADER_STALE_MS || (!raw.visible && visible);
      if (lead) window.localStorage.setItem(LEADER_KEY, JSON.stringify({ id: tabId.current, at: now, visible }));
      return lead;
    } catch {
      return true;
    }
  }, []);

  const raise = useCallback((alerts: FocusAlert[], current: FocusStore, at: number) => {
    if (!alerts.length) return current;
    const fresh = alerts.filter((alert) => !current.alerts.some((existing) => existing.id === alert.id));
    if (!fresh.length) return current;
    if (fresh.some((alert) => alert.ringUntil > at)) {
      playSound(profileRef.current.preferences.sound, profileRef.current.preferences.volume);
      lastRing.current = at;
    }
    for (const alert of fresh) notify(alert, profileRef.current);
    return { ...current, alerts: [...fresh.reverse(), ...current.alerts].slice(0, MAX_ALERTS) };
  }, []);

  const saveProfile = useCallback(async (next: Profile) => {
    setProfile(next);
    profileRef.current = next;
    const run = saving.current.then(async () => {
      const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: next }) });
      const data = (await response.json().catch(() => undefined)) as { profile?: Profile; error?: string } | undefined;
      if (!response.ok || !data?.profile) throw new Error(data?.error ?? "Your profile could not be saved.");
      return data.profile;
    });
    saving.current = run.catch(() => undefined);
    try {
      const saved = await run;
      // Bu arada daha yeni bir değişiklik yapıldıysa onun üzerine yazılmasın.
      if (profileRef.current === next) {
        setProfile(saved);
        profileRef.current = saved;
      }
      setProfileError(undefined);
      return true;
    } catch (caught) {
      setProfileError(caught instanceof Error ? caught.message : "Your profile could not be saved.");
      return false;
    }
  }, []);
  const saveProfileRef = useRef(saveProfile);

  /** Zamanı ilerletir: fazlar, geri sayım, kronometre, alarmlar, zil. Yalnızca önder sekme. */
  const tick = useCallback(() => {
    const at = Date.now();
    setNow((previous) => (Math.floor(previous / 1000) === Math.floor(at / 1000) ? previous : at));
    if (!readyRef.current || !loadedRef.current) return;
    // Arka plan sesi de zil gibi yalnızca önder sekmede: iki sekme iki kez çalmasın.
    if (!isLeader(at)) return stopAmbient();
    const profileNow = profileRef.current;
    let current = storeRef.current;
    // Dondurulan sekme yeniden çalıştı: arada sayfa açıktı, süre kesintisiz sayılıyor.
    const lastAlive = current.frozenAt ? at : current.lastAlive;
    const segments: Segment[] = [];
    const events: TimerEvent[] = [];
    if (current.focus) {
      const step = advanceFocus(current.focus, profileNow.preferences.focus, at, lastAlive);
      current = { ...current, focus: step.run };
      segments.push(...step.segments);
      events.push(...step.events);
    }
    if (current.timer && !current.timer.done) {
      const step = advanceCountdown(current.timer, at, lastAlive);
      current = { ...current, timer: step.run };
      segments.push(...step.segments);
      events.push(...step.events);
    }
    if (current.stopwatch) {
      const step = advanceStopwatch(current.stopwatch, at, lastAlive);
      current = { ...current, stopwatch: step.run };
      segments.push(...step.segments);
      events.push(...step.events);
    }
    const alerts: FocusAlert[] = [];
    for (const event of events) {
      const alert = alertFor(event, current, profileNow, at);
      if (alert) alerts.push(alert);
    }
    const rung = dueAlarms(profileNow.alarms, current.alarmCheck || at, at);
    for (const { alarm, at: moment } of rung) alerts.push(alarmAlert(alarm, moment, at, profileNow.preferences.clock));
    const snoozed = current.snoozes.filter((snooze) => snooze.at <= at);
    for (const snooze of snoozed) {
      const alarm = profileNow.alarms.find((item) => item.id === snooze.alarmId);
      if (alarm && at - snooze.at <= ALARM_GRACE_MS) alerts.push(alarmAlert(alarm, snooze.at, at, profileNow.preferences.clock));
    }
    const onceRung = rung.filter(({ alarm }) => !alarm.days.length).map(({ alarm }) => alarm.id);
    if (onceRung.length) {
      const next = { ...profileNow, alarms: profileNow.alarms.map((alarm) => (onceRung.includes(alarm.id) ? { ...alarm, enabled: false } : alarm)) };
      void saveProfileRef.current(next);
    }
    const { ambient, ambientVolume } = profileNow.preferences;
    if (current.focus?.clock.running && current.focus.phase === "work" && ambient !== "none") setAmbient(ambient, ambientVolume);
    else if (!ambientPreview.current) stopAmbient();
    current = record(segments, current);
    current = raise(alerts, { ...current, snoozes: current.snoozes.filter((snooze) => snooze.at > at) }, at);
    const ringing = current.alerts.some((alert) => alert.ringUntil > at);
    if (ringing && at - lastRing.current >= RING_EVERY_MS) {
      playSound(profileNow.preferences.sound, profileNow.preferences.volume);
      lastRing.current = at;
    }
    // Yalnızca bir şey olduysa React durumu değişiyor; canlılık damgası beş saniyede bir diske.
    const changed = segments.length > 0 || events.length > 0 || alerts.length > 0 || snoozed.length > 0 || current.frozenAt !== undefined;
    current = { ...current, lastAlive: at, alarmCheck: at, frozenAt: undefined };
    if (changed) commit(current);
    else {
      storeRef.current = current;
      if (at - lastPersist.current > 5_000) {
        writeStore(current);
        lastPersist.current = at;
      }
    }
    if (current.pending.length && (segments.length || at - lastFlush.current > RETRY_MS)) void flush();
  }, [commit, flush, isLeader, raise, record]);


  // Açılış: bu tarayıcıdaki sayaçlar, sunucudaki profil ve kayıt.
  useEffect(() => {
    tabId.current = Math.random().toString(36).slice(2);
    let cancelled = false;
    // Durum bir sonraki turda okunuyor: stüdyonun açılışı gibi (`app-shell.tsx`), etkinin gövdesinde değil.
    const opening = window.setTimeout(() => {
      const opened = Date.now();
      const read = readStore(opened);
      // Donmuş sekme tarayıcı tarafından atılıp yeniden yüklendiyse sayfa hep açıktı; okuyucu
      // kapattıysa donduğu an son canlı an.
      const discarded = Boolean((document as Document & { wasDiscarded?: boolean }).wasDiscarded);
      const initial = read.frozenAt && !discarded ? { ...read, frozenAt: undefined } : read;
      storeRef.current = initial;
      loadedRef.current = true;
      setStore(initial);
      setNow(opened);
    }, 0);
    void (async () => {
      try {
        const response = await fetch("/api/profile", { cache: "no-store" });
        const data = (await response.json()) as { profile?: Profile; error?: string };
        if (!data.profile) throw new Error(data.error ?? "Your profile could not be read.");
        if (cancelled) return;
        setProfile(data.profile);
        profileRef.current = data.profile;
      } catch (caught) {
        if (!cancelled) setProfileError(caught instanceof Error ? caught.message : "Your profile could not be read.");
      } finally {
        if (!cancelled) {
          readyRef.current = true;
          setProfileReady(true);
        }
      }
    })();
    void (async () => {
      try {
        const response = await fetch("/api/profile/sessions", { cache: "no-store" });
        const data = (await response.json()) as { log?: WorkLog; error?: string };
        if (!data.log) throw new Error(data.error ?? "Your work log could not be read.");
        if (!cancelled) setLog((local) => addSessions(data.log!, [...local.sessions, ...storeRef.current.pending]));
      } catch (caught) {
        if (!cancelled) setLogError(caught instanceof Error ? caught.message : "Your work log could not be read.");
      } finally {
        if (!cancelled) setLogReady(true);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(opening);
    };
  }, []);

  // Haftalık tam yedek (`backup-storage.ts`): açılıştan biraz sonra, ilk yüklemelerle yarışmadan. Sunucu haftada birden fazla yazmıyor.
  useEffect(() => {
    const timer = window.setTimeout(() => void fetch("/api/backup", { method: "POST" }).catch(() => undefined), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(tick, 500);
    /**
     * Arka plandaki sekmede tarayıcı pencere zamanlayıcılarını dakikada bire
     * kadar yavaşlatıyor; tur bittiğinde zil bir dakika geç çalardı. Ayrı bir
     * iş parçacığının (Web Worker) saniyede bir gönderdiği ileti yavaşlatılmıyor:
     * sekme gizliyken sayaç onunla ilerliyor. Worker açılamazsa pencere sayacı yetiyor.
     */
    let worker: Worker | undefined;
    let workerUrl: string | undefined;
    try {
      workerUrl = URL.createObjectURL(new Blob(["setInterval(function () { postMessage(0); }, 1000);"], { type: "text/javascript" }));
      worker = new Worker(workerUrl);
      worker.onmessage = () => {
        if (document.visibilityState === "hidden") tick();
      };
    } catch {
      worker = undefined;
    }
    const onVisible = () => tick();
    // Donma: sekme kapanmıyor, yalnızca bir süre çalışmıyor (bkz. `frozenAt`).
    const onFreeze = () => {
      const frozen = { ...storeRef.current, lastAlive: Date.now(), frozenAt: Date.now() };
      storeRef.current = frozen;
      writeStore(frozen);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      const next = readStore(Date.now());
      storeRef.current = next;
      setStore(next);
    };
    // Kapanış anı canlılığın son anı: sayfa kapandıktan sonrası sayılmasın.
    const onHide = () => {
      if (storeRef.current.focus || storeRef.current.timer || storeRef.current.stopwatch) writeStore({ ...storeRef.current, lastAlive: Date.now(), frozenAt: undefined });
    };
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("freeze", onFreeze);
    document.addEventListener("resume", onVisible);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(interval);
      stopAmbient();
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("freeze", onFreeze);
      document.removeEventListener("resume", onVisible);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onHide);
    };
  }, [tick]);

  // Sekmenin başlığı çalışan sayacı gösteriyor: başka bir sekmedeyken de görülsün.
  const baseTitle = useRef<string>("");
  useEffect(() => {
    if (!baseTitle.current) baseTitle.current = document.title;
    const at = now || Date.now();
    const { focus, timer, stopwatch } = store;
    const title = focus?.clock.running
      ? `${formatClock(focusRemaining(focus, at), "up")} · ${focus.phase === "work" ? "Focus" : "Break"}`
      : timer?.clock.running
        ? `${formatClock(countdownRemaining(timer, at), "up")} · Timer`
        : stopwatch?.clock.running
          ? `${formatClock(elapsedOf(stopwatch.clock, at))} · Stopwatch`
          : "";
    document.title = title ? `${title} — ${baseTitle.current}` : baseTitle.current;
  }, [now, store]);

  const act = useCallback(
    (change: (current: FocusStore, at: number) => { store: FocusStore; segments?: Segment[] }) => {
      unlockAudio();
      const at = Date.now();
      const result = change(storeRef.current, at);
      const next = record(result.segments ?? [], { ...result.store, lastAlive: at });
      commit(next);
      if (result.segments?.length) void flush();
    },
    [commit, flush, record],
  );

  const actions = useMemo<FocusActions>(() => {
    const settings = () => profileRef.current.preferences.focus;
    return {
      startFocus: (subject) =>
        act((current, at) => {
          if (current.focus && !current.focus.finished) return { store: { ...withoutAlerts(current, ["phase", "done"]), focus: resumeFocus(current.focus, at) } };
          return { store: { ...withoutAlerts(current, ["phase", "done"]), focus: startFocus(settings(), at, subject) } };
        }),
      pauseFocus: () => act((current, at) => (current.focus ? (({ run, segments }) => ({ store: { ...current, focus: run }, segments }))(pauseFocus(current.focus, at)) : { store: current })),
      resumeFocus: () => act((current, at) => ({ store: { ...withoutAlerts(current, ["phase"]), ...(current.focus ? { focus: resumeFocus(current.focus, at) } : {}) } })),
      skipFocus: () => act((current, at) => (current.focus ? (({ run, segments }) => ({ store: { ...withoutAlerts(current, ["phase"]), focus: run }, segments }))(skipFocus(current.focus, settings(), at)) : { store: current })),
      stopFocus: () => act((current, at) => ({ store: { ...withoutAlerts(current, ["phase", "done"]), focus: undefined }, segments: current.focus ? stopFocus(current.focus, at) : [] })),
      startTimer: (ms, subject) => act((current, at) => ({ store: { ...withoutAlerts(current, ["timer"]), timer: startCountdown(ms, at, subject) } })),
      pauseTimer: () => act((current, at) => (current.timer ? (({ run, segments }) => ({ store: { ...current, timer: run }, segments }))(pauseCountdown(current.timer, at)) : { store: current })),
      resumeTimer: () => act((current, at) => ({ store: { ...current, ...(current.timer ? { timer: resumeCountdown(current.timer, at) } : {}) } })),
      extendTimer: (ms) => act((current, at) => ({ store: { ...withoutAlerts(current, ["timer"]), ...(current.timer ? { timer: extendCountdown(current.timer, ms, at) } : {}) } })),
      stopTimer: () => act((current, at) => ({ store: { ...withoutAlerts(current, ["timer"]), timer: undefined }, segments: current.timer && !current.timer.done ? pauseCountdown(current.timer, at).segments : [] })),
      startStopwatch: (subject) => act((current, at) => ({ store: { ...current, stopwatch: current.stopwatch ? resumeStopwatch(current.stopwatch, at) : startStopwatch(at, subject) } })),
      pauseStopwatch: () => act((current, at) => (current.stopwatch ? (({ run, segments }) => ({ store: { ...current, stopwatch: run }, segments }))(pauseStopwatch(current.stopwatch, at)) : { store: current })),
      resumeStopwatch: () => act((current, at) => ({ store: { ...current, ...(current.stopwatch ? { stopwatch: resumeStopwatch(current.stopwatch, at) } : {}) } })),
      lapStopwatch: () => act((current, at) => ({ store: { ...current, ...(current.stopwatch ? { stopwatch: lapStopwatch(current.stopwatch, at) } : {}) } })),
      stopStopwatch: () => act((current, at) => ({ store: { ...current, stopwatch: undefined }, segments: current.stopwatch ? pauseStopwatch(current.stopwatch, at).segments : [] })),
    };
  }, [act]);

  const dismissAlert = useCallback((id: string) => {
    commit({ ...storeRef.current, alerts: storeRef.current.alerts.filter((alert) => alert.id !== id) });
  }, [commit]);

  const runAlert = useCallback(
    (alert: FocusAlert) => {
      if (alert.action === "start-next" || (alert.action === "resume" && alert.resume === "focus")) actions.resumeFocus();
      else if (alert.action === "skip-break") actions.skipFocus();
      else if (alert.action === "restart") actions.startFocus({ label: storeRef.current.focus?.label, projectId: storeRef.current.focus?.projectId });
      else if (alert.action === "extend") actions.extendTimer(60_000);
      else if (alert.action === "resume" && alert.resume === "timer") actions.resumeTimer();
      else if (alert.action === "resume" && alert.resume === "stopwatch") actions.resumeStopwatch();
      else if (alert.action === "snooze" && alert.alarmId) {
        commit({ ...storeRef.current, snoozes: [...storeRef.current.snoozes, { alarmId: alert.alarmId, at: Date.now() + SNOOZE_MS }] });
      }
      commit({ ...storeRef.current, alerts: storeRef.current.alerts.filter((item) => item.id !== alert.id) });
    },
    [actions, commit],
  );

  const liveIntervals = useCallback(
    (at: number) => {
      const { focus, timer, stopwatch } = store;
      const { preferences } = profile;
      const intervals: Array<[number, number]> = [];
      if (focus?.clock.running && focus.phase === "work") intervals.push([focus.clock.since, at]);
      if (timer?.clock.running && preferences.timerCountsAsWork) intervals.push([timer.clock.since, at]);
      if (stopwatch?.clock.running && preferences.stopwatchCountsAsWork) intervals.push([stopwatch.clock.since, at]);
      return intervals;
    },
    [profile, store],
  );

  const addManual = useCallback(
    async (sessions: WorkSession[]) => {
      const response = await fetch("/api/profile/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessions }) }).catch(() => undefined);
      if (!response?.ok) {
        const data = (await response?.json().catch(() => undefined)) as { error?: string } | undefined;
        setLogError(data?.error ?? "The time could not be added.");
        return false;
      }
      setLog((existing) => addSessions(existing, sessions));
      setLogError(undefined);
      return true;
    },
    [],
  );

  // Tekrar oturumu büyüdükçe aynı kimlikle yeniden yazılıyor; bekleyen eski hâli yenisiyle değişiyor.
  const logBlock = useCallback(
    (kind: "review" | "study", block: ReviewBlock, subject: Subject = {}) => {
      const { preferences } = profileRef.current;
      if (!(kind === "review" ? preferences.reviewCountsAsWork : preferences.studyCountsAsWork)) return;
      const sessions = sessionPieces({ kind, id: block.id, label: subject.label, projectId: subject.projectId, color: preferences.colors.focus }, block.start, block.end);
      if (!sessions.length) return;
      const ids = new Set(sessions.map((session) => session.id));
      setLog((existing) => addSessions(existing, sessions));
      commit({ ...storeRef.current, pending: [...storeRef.current.pending.filter((session) => !ids.has(session.id)), ...sessions] });
      void flush();
    },
    [commit, flush],
  );
  const logReviewTime = useCallback((block: ReviewBlock, subject?: Subject) => logBlock("review", block, subject), [logBlock]);
  const logStudyTime = useCallback((block: ReviewBlock, subject?: Subject) => logBlock("study", block, subject), [logBlock]);

  // Yeni haftanın ilk açılışında geçen haftanın özeti, bir kez (bu tarayıcıda hatırlanıyor).
  useEffect(() => {
    if (!logReady || !profileReady) return;
    const show = setTimeout(() => {
      const { preferences } = profileRef.current;
      if (!preferences.weeklySummary) return;
      const summary = lastWeekSummary(logRef.current, new Date(), preferences.weekStart);
      if (!summary) return;
      try {
        if (window.localStorage.getItem(WEEK_SUMMARY_KEY) === summary.from) return;
        window.localStorage.setItem(WEEK_SUMMARY_KEY, summary.from);
      } catch {
        return;
      }
      const at = Date.now();
      const alert: FocusAlert = { id: `week-${summary.from}`, kind: "summary", title: "Your week", body: weekSummaryText(summary), color: preferences.color, at, ringUntil: 0, action: "report", actionLabel: "See the weekly report" };
      commit(raise([alert], storeRef.current, at));
    }, 1500);
    return () => clearTimeout(show);
  }, [commit, logReady, profileReady, raise]);

  const noteRound = useCallback(
    (endAt: number, note: string) => {
      const session = roundSession([...logRef.current.sessions, ...storeRef.current.pending], endAt);
      if (!session) return false;
      // Boş not, varsa eskisini siliyor (`addSessions`).
      const noted: WorkSession = { ...session, note: note.trim().slice(0, MAX_SESSION_NOTE) };
      setLog((existing) => addSessions(existing, [noted]));
      commit({ ...storeRef.current, pending: [...storeRef.current.pending.filter((item) => item.id !== noted.id), noted] });
      void flush();
      return true;
    },
    [commit, flush],
  );

  const deleteSession = useCallback(async (id: string) => {
    const response = await fetch(`/api/profile/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    if (!response?.ok && response?.status !== 404) {
      setLogError("The session could not be deleted.");
      return false;
    }
    setLog((existing) => removeSession(existing, id));
    commit({ ...storeRef.current, pending: storeRef.current.pending.filter((session) => session.id !== id) });
    return true;
  }, [commit]);

  const importData = useCallback(async (file: File) => {
    let body: unknown;
    try {
      body = JSON.parse(await file.text());
    } catch {
      throw new Error("The file is not valid JSON.");
    }
    if ((body as { kind?: string })?.kind !== WORK_DATA_KIND) throw new Error("This is not a Trace work data file.");
    const response = await fetch("/api/profile/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => undefined)) as { added?: number; profileAdopted?: boolean; library?: BackupSummary; error?: string } | undefined;
    if (!response.ok || data?.added === undefined) throw new Error(data?.error ?? "Your data could not be imported.");
    const [profileResponse, logResponse] = await Promise.all([fetch("/api/profile", { cache: "no-store" }), fetch("/api/profile/sessions", { cache: "no-store" })]);
    const fresh = (await profileResponse.json()) as { profile?: Profile };
    const freshLog = (await logResponse.json()) as { log?: WorkLog };
    if (fresh.profile) {
      setProfile(fresh.profile);
      profileRef.current = fresh.profile;
    }
    if (freshLog.log) setLog(freshLog.log);
    return describeBackupImport(data.added, Boolean(data.profileAdopted), data.library);
  }, []);

  const previewSound = useCallback(() => {
    unlockAudio();
    playSound(profileRef.current.preferences.sound, profileRef.current.preferences.volume);
  }, []);

  const previewAmbient = useCallback(() => {
    unlockAudio();
    const { ambient, ambientVolume } = profileRef.current.preferences;
    ambientPreview.current = true;
    // Ses bağlamı ilk tıklamada açılıyor; bir an sonra çalmaya hazır.
    window.setTimeout(() => setAmbient(ambient, ambientVolume), 50);
    window.setTimeout(() => {
      ambientPreview.current = false;
    }, 4_000);
  }, []);

  useEffect(() => {
    saveProfileRef.current = saveProfile;
  }, [saveProfile]);

  const value = useMemo<FocusContextValue>(
    () => ({
      profile,
      profileReady,
      profileError,
      saveProfile,
      log,
      logReady,
      logError,
      addSessions: addManual,
      deleteSession,
      importData,
      store,
      actions,
      liveIntervals,
      dismissAlert,
      runAlert,
      previewSound,
      previewAmbient,
      logReviewTime,
      logStudyTime,
      noteRound,
    }),
    [actions, addManual, deleteSession, dismissAlert, importData, liveIntervals, log, logError, logReady, logReviewTime, logStudyTime, noteRound, previewAmbient, previewSound, profile, profileError, profileReady, runAlert, saveProfile, store],
  );

  return (
    <FocusContext.Provider value={value}>
      <ClockContext.Provider value={now}>{children}</ClockContext.Provider>
    </FocusContext.Provider>
  );
}

/** Şu an süren ve çalışma sayılan aralıklar, oturum biçiminde (makalesiyle birlikte). */
export function liveSessions(store: FocusStore, profile: Profile, now: number) {
  const { preferences } = profile;
  const runs = [
    store.focus?.clock.running && store.focus.phase === "work" ? store.focus : undefined,
    store.timer?.clock.running && preferences.timerCountsAsWork ? store.timer : undefined,
    store.stopwatch?.clock.running && preferences.stopwatchCountsAsWork ? store.stopwatch : undefined,
  ];
  return runs.flatMap((run) =>
    run && now > run.clock.since ? [{ start: new Date(run.clock.since).toISOString(), end: new Date(now).toISOString(), ...(run.projectId ? { projectId: run.projectId } : {}) }] : [],
  );
}

/** Odağın göstergesi: kalan süre, faz ve tur. */
export function focusDisplay(focus: FocusRun | undefined, profile: Profile, now: number) {
  const settings = profile.preferences.focus;
  if (!focus) return { remaining: phaseMs(settings, "work"), total: phaseMs(settings, "work"), phase: "work" as const, round: 1, running: false, waiting: false, finished: false };
  return {
    remaining: focusRemaining(focus, now),
    total: focus.duration,
    phase: focus.phase,
    round: focusRound(focus),
    running: focus.clock.running,
    waiting: focus.waiting,
    finished: focus.finished,
  };
}
