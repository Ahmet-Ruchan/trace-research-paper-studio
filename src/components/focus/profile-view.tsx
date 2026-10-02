"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BarChart3, CalendarDays, Camera, Download, Pencil, Play, Timer, Trash2, Upload, X } from "lucide-react";
import { useT } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";
import { sessionsIcs, sessionsIcsName } from "@/lib/work-export";
import { focusColorStyle } from "@/lib/focus-colors";
import { learningStats } from "@/lib/learning-stats";
import { displayName, MAX_PHOTO_CHARS, MAX_WEEKLY_CARDS, MAX_WEEKLY_PAPERS, SOUNDS, type Preferences, type Profile, type SoundId } from "@/lib/profile";
import type { ResearchProject } from "@/lib/schema";
import { calendarYears, dailyTotals, dayDate, dayKey, sessionPieces, workSummary, type WorkSession } from "@/lib/work-log";
import { DisplayControl } from "../display-control";
import { useLibraryStudyState } from "../study-progress";
import { useFocus, useFocusClock } from "./focus-provider";
import { Avatar, ColorPicker, NumberField, Toggle } from "./focus-parts";
import { StudioNav } from "./studio-nav";
import { useReadingList } from "../reading-list";
import { PaperTimeCard } from "./paper-time";
import { WeeklyReport } from "./weekly-report";
import { WorkCalendar, type CalendarRange } from "./work-calendar";
import { ThisDeviceCard } from "../offline";
import { TeamCard } from "../team";

type Words = Messages["focus"];

/** Günlük kopyaların klasörü; yol, çevrilmiyor. */
const DAILY_BACKUPS = "~/.trace/backups";

/** Profilin tarih biçimleri, arayüzün dilinde. */
function useDates() {
  const locale = useT().common.locale;
  return useMemo(
    () => ({
      longDate: new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      shortDate: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }),
      memberSince: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
      backupDate: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }),
    }),
    [locale],
  );
}

/** Fotoğraf 192 px kareye kırpılıp JPEG'e çevriliyor: profil dosyası küçük kalsın. */
async function photoFrom(file: File, t: Words["identity"]) {
  if (!/^image\//.test(file.type)) throw new Error(t.photoNotImage);
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(t.photoUnreadable));
      element.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    canvas.getContext("2d")!.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 192, 192);
    const data = canvas.toDataURL("image/jpeg", 0.85);
    if (data.length > MAX_PHOTO_CHARS) throw new Error(t.photoTooLarge);
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

type IdentityFields = Pick<Profile, "firstName" | "lastName" | "title" | "institution" | "field" | "email" | "bio">;
/** Alanların adı ve örneği sözlükte (`t.focus.identity.fields`). */
const IDENTITY: Array<{ key: keyof IdentityFields; max: number; wide?: boolean }> = [
  { key: "firstName", max: 60 },
  { key: "lastName", max: 60 },
  { key: "title", max: 80 },
  { key: "institution", max: 120 },
  { key: "field", max: 120 },
  { key: "email", max: 200 },
  { key: "bio", max: 400, wide: true },
];

function IdentityCard({ onFocus }: { onFocus: () => void }) {
  const { common, focus: words } = useT();
  const t = words.identity;
  const { memberSince } = useDates();
  const { profile, saveProfile, profileError } = useFocus();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IdentityFields>(profile);
  const [photoError, setPhotoError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const name = displayName(profile);
  const details = [profile.title, profile.institution].filter(Boolean).join(" · ");

  async function save() {
    const ok = await saveProfile({ ...profile, ...draft });
    if (ok) {
      setEditing(false);
      setSaved(true);
    }
  }

  return (
    <section className="profile-identity" style={focusColorStyle(profile.preferences.color)} aria-label={t.region}>
      <div className="profile-photo">
        <Avatar profile={profile} size="large" />
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setPhotoError(undefined);
            void photoFrom(file, t)
              .then((photo) => saveProfile({ ...profile, photo }))
              .catch((error: unknown) => setPhotoError(error instanceof Error ? error.message : t.photoFailed));
          }}
        />
        <div>
          <button type="button" className="focus-secondary" onClick={() => photoInput.current?.click()}><Camera size={14} /> {profile.photo ? t.changePhoto : t.addPhoto}</button>
          {profile.photo ? (
            <button type="button" className="focus-icon-button" aria-label={t.removePhoto} onClick={() => void saveProfile({ ...profile, photo: undefined })}><X size={15} /></button>
          ) : null}
        </div>
        {photoError ? <p className="regen-error" role="alert">{photoError}</p> : null}
      </div>

      {editing ? (
        <form
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {IDENTITY.map((field) => (
            <label key={field.key} className={field.wide ? "is-wide" : ""}>
              <span>{t.fields[field.key].label}</span>
              {field.wide ? (
                <textarea rows={3} maxLength={field.max} placeholder={t.fields[field.key].placeholder} value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
              ) : (
                <input
                  type={field.key === "email" ? "email" : "text"}
                  maxLength={field.max}
                  placeholder={t.fields[field.key].placeholder}
                  autoComplete={field.key === "firstName" ? "given-name" : field.key === "lastName" ? "family-name" : field.key === "email" ? "email" : "off"}
                  value={draft[field.key]}
                  onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                />
              )}
            </label>
          ))}
          {profileError ? <p className="regen-error is-wide" role="alert">{profileError}</p> : null}
          <div className="profile-form-actions is-wide">
            <button type="submit" className="focus-primary">{common.save}</button>
            <button type="button" className="focus-secondary" onClick={() => { setDraft(profile); setEditing(false); }}>{common.cancel}</button>
          </div>
        </form>
      ) : (
        <div className="profile-about">
          <p className="landing-eyebrow"><span /> {t.eyebrow}</p>
          <h1>{name || t.yourProfile}</h1>
          {details ? <p className="profile-details">{details}</p> : null}
          {profile.field ? <p className="profile-field">{profile.field}</p> : null}
          {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
          {!name ? <p className="profile-bio">{t.emptyBio}</p> : null}
          <p className="profile-meta">
            {profile.email ? <span>{profile.email}</span> : null}
            <span>{t.since(memberSince.format(new Date(profile.createdAt)))}</span>
            {saved ? <span role="status">{t.saved}</span> : null}
          </p>
          <div className="profile-form-actions">
            <button type="button" className="focus-primary" onClick={() => { setDraft(profile); setSaved(false); setEditing(true); }}><Pencil size={14} /> {t.edit}</button>
            <button type="button" className="focus-secondary" onClick={onFocus}><Timer size={14} /> {t.openTimer}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function StudyingCard({ projects, state, onProgress }: { projects: ResearchProject[]; state: ReturnType<typeof useLibraryStudyState>; onProgress: () => void }) {
  const t = useT().focus.studying;
  const now = useFocusClock();
  const stats = useMemo(() => (state.status === "ready" && now ? learningStats(projects, state.study, new Date(now).toISOString()) : undefined), [projects, state, now]);
  if (!stats) return null;
  return (
    <section className="stats-block profile-studying" aria-label={t.region}>
      <h2>{t.region}</h2>
      <p>{stats.papers.length ? t.summary(stats.totals) : t.empty}</p>
      <button type="button" className="focus-secondary" onClick={onProgress}><BarChart3 size={14} /> {t.progress}</button>
    </section>
  );
}

function PreferencesCard() {
  const words = useT().focus;
  const t = words.preferences;
  const { profile, saveProfile, previewSound } = useFocus();
  const { preferences } = profile;
  const set = (patch: Partial<Preferences>) => void saveProfile({ ...profile, preferences: { ...preferences, ...patch } });
  const [permission, setPermission] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const blocked = permission === "denied";
  const goalHours = Math.floor(preferences.dailyGoalMinutes / 60);
  const goalMinutes = preferences.dailyGoalMinutes % 60;

  return (
    <section className="stats-block profile-preferences" aria-label={t.region}>
      <h2>{t.region}</h2>
      <div className="focus-number-grid">
        <NumberField label={t.goalHours} value={goalHours} min={0} max={24} onChange={(hours) => set({ dailyGoalMinutes: Math.min(1440, Math.max(15, hours * 60 + goalMinutes)) })} />
        <NumberField label={t.goalMinutes} value={goalMinutes} min={0} max={59} onChange={(minutes) => set({ dailyGoalMinutes: Math.min(1440, Math.max(15, goalHours * 60 + minutes)) })} />
      </div>
      <div className="focus-number-grid profile-weekly-goals">
        <NumberField label={t.weeklyPapers} value={preferences.weeklyGoals.papers} min={0} max={MAX_WEEKLY_PAPERS} onChange={(papers) => set({ weeklyGoals: { ...preferences.weeklyGoals, papers } })} />
        <NumberField label={t.weeklyCards} value={preferences.weeklyGoals.cards} min={0} max={MAX_WEEKLY_CARDS} onChange={(cards) => set({ weeklyGoals: { ...preferences.weeklyGoals, cards } })} />
      </div>
      <p className="focus-note">{t.weeklyNote}</p>
      <div className="profile-choices">
        <div role="group" aria-label={t.weekStarts}>
          <span>{t.weekStarts}</span>
          {([[1, t.monday], [0, t.sunday]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={preferences.weekStart === value} onClick={() => set({ weekStart: value })}>{label}</button>
          ))}
        </div>
        <div role="group" aria-label={t.clock}>
          <span>{t.clock}</span>
          {([["24h", t.hour24], ["12h", t.hour12]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={preferences.clock === value} onClick={() => set({ clock: value })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="profile-sound">
        <label className="focus-select">
          <span>{t.sound}</span>
          <select value={preferences.sound} onChange={(event) => set({ sound: event.target.value as SoundId })}>
            {SOUNDS.map((sound) => <option key={sound.id} value={sound.id}>{words.sounds[sound.id]}</option>)}
          </select>
        </label>
        <label className="profile-volume">
          <span>{t.volume}</span>
          <input type="range" min={0} max={1} step={0.05} value={preferences.volume} onChange={(event) => set({ volume: Number(event.target.value) })} aria-valuetext={words.percent(Math.round(preferences.volume * 100))} />
        </label>
        <button type="button" className="focus-secondary" onClick={previewSound} disabled={preferences.sound === "none" || !preferences.volume}><Play size={14} /> {t.play}</button>
      </div>
      <Toggle
        checked={preferences.notifications && permission === "granted"}
        onChange={(on) => {
          if (!on) return set({ notifications: false });
          if (typeof Notification === "undefined") return;
          void Notification.requestPermission().then((result) => {
            setPermission(result);
            if (result === "granted") set({ notifications: true });
          });
        }}
        label={t.notifications}
        hint={blocked ? t.notificationsBlocked : t.notificationsHint}
      />
      <Toggle checked={preferences.reviewCountsAsWork} onChange={(reviewCountsAsWork) => set({ reviewCountsAsWork })} label={t.reviewAsWork} hint={t.reviewAsWorkHint} />
      <Toggle checked={preferences.weeklySummary} onChange={(weeklySummary) => set({ weeklySummary })} label={t.weeklySummary} hint={t.weeklySummaryHint} />
      <Toggle checked={preferences.studyCountsAsWork} onChange={(studyCountsAsWork) => set({ studyCountsAsWork })} label={t.studyAsWork} hint={t.studyAsWorkHint} />
    </section>
  );
}

function SessionsCard({ selected }: { selected?: string }) {
  const { common, focus: words } = useT();
  const t = words.sessions;
  const { longDate, shortDate } = useDates();
  const { log, addSessions, deleteSession, logError, profile } = useFocus();
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [start, setStart] = useState("09:00");
  const [minutes, setMinutes] = useState(30);
  const [label, setLabel] = useState("");
  const [added, setAdded] = useState<string>();
  const time = useMemo(() => new Intl.DateTimeFormat(common.locale, { hour: "numeric", minute: "2-digit", hour12: profile.preferences.clock === "12h" }), [common.locale, profile.preferences.clock]);
  const shown = (selected ? log.sessions.filter((session) => dayKey(new Date(session.start)) === selected || dayKey(new Date(session.end)) === selected) : log.sessions.slice(-12)).slice().reverse();

  return (
    <section className="stats-block profile-sessions" aria-label={t.region}>
      <h2>{selected ? longDate.format(dayDate(selected)) : t.recent}</h2>
      {shown.length ? (
        <ul className="focus-sessions">
          {shown.map((session: WorkSession) => (
            <li key={session.id}>
              <span>{selected ? "" : `${shortDate.format(new Date(session.start))}, `}{time.format(new Date(session.start))}–{time.format(new Date(session.end))}</span>
              <span>
                {session.label || words.sessionKinds[session.kind]}
                {session.note ? <small className="focus-session-note">{session.note}</small> : null}
              </span>
              <strong>{words.duration((Date.parse(session.end) - Date.parse(session.start)) / 1000)}</strong>
              <button type="button" className="focus-icon-button" aria-label={t.delete(time.format(new Date(session.start)))} onClick={() => void deleteSession(session.id)}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{selected ? t.emptyDay : t.empty}</p>
      )}
      <form
        className="profile-manual"
        aria-label={t.manual}
        onSubmit={(event) => {
          event.preventDefault();
          const [hours, mins] = start.split(":").map(Number);
          const from = dayDate(date);
          from.setHours(hours, mins, 0, 0);
          const begin = from.getTime();
          const end = Math.min(begin + minutes * 60_000, Date.now());
          if (end <= begin) return setAdded(t.notYet);
          const sessions = sessionPieces({ kind: "manual", label, color: profile.preferences.color, id: `manual-${begin}` }, begin, end);
          void addSessions(sessions).then((ok) => {
            if (ok) {
              setAdded(t.added(words.duration((end - begin) / 1000), shortDate.format(from)));
              setLabel("");
            }
          });
        }}
      >
        <h3>{t.manual}</h3>
        <p>{t.manualIntro}</p>
        <label><span>{t.day}</span><input type="date" required max={dayKey(new Date())} value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>{t.from}</span><input type="time" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <NumberField label={t.minutes} value={minutes} min={1} max={720} onChange={setMinutes} />
        <label className="is-wide"><span>{t.labelField}</span><input maxLength={120} placeholder={t.placeholder} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <button type="submit" className="focus-secondary">{common.add}</button>
        {added ? <p role="status">{added}</p> : null}
        {logError ? <p className="regen-error" role="alert">{logError}</p> : null}
      </form>
    </section>
  );
}

/**
 * Okuyucunun bütün verisi (`full-backup.ts`): profil, çalışma kaydı ve
 * kütüphanenin yanındaki kayıtları; istenirse makalelerle birlikte. İçe
 * aktarma birleştiriyor, hiçbir şey silmiyor.
 */
function DataCard({ papers, onLibraryChanged }: { papers: number; onLibraryChanged?: () => void }) {
  const t = useT().focus.data;
  const { backupDate } = useDates();
  const { importData } = useFocus();
  const reading = useReadingList();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [withPapers, setWithPapers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [weekly, setWeekly] = useState<{ directory: string; kept: number; backups: Array<{ day: string; bytes: number }> }>();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/backup", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (!cancelled && data) setWeekly(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const latest = weekly?.backups[0];

  return (
    <section className="stats-block profile-data" aria-label={t.region}>
      <h2>{t.region}</h2>
      <p>
        {t.introBefore}
        <code>{DAILY_BACKUPS}</code>
        {t.introAfter}
      </p>
      {weekly ? (
        <p className="profile-weekly-backup">
          {t.weeklyBefore}
          <code>{weekly.directory}</code>
          {t.weeklyAfter(weekly.kept)}{" "}
          {latest
            ? t.latest(backupDate.format(dayDate(latest.day)), latest.bytes < 1_000_000 ? `${Math.max(1, Math.round(latest.bytes / 1000))} kB` : t.megabytes(latest.bytes / 1_000_000))
            : t.firstPending}
        </p>
      ) : null}
      <label className="profile-data-papers">
        <input type="checkbox" checked={withPapers} onChange={(event) => setWithPapers(event.target.checked)} />
        <span>{t.includePapers(papers)}</span>
      </label>
      <div className="profile-form-actions">
        <button
          type="button"
          className="focus-secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void fetch(`/api/profile/data${withPapers ? "" : "?papers=0"}`, { cache: "no-store" })
              .then((response) => response.text())
              .then((text) => download(`trace-data-${dayKey(new Date())}.json`, text))
              .finally(() => setBusy(false));
          }}
        >
          <Download size={14} /> {t.download}
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setBusy(true);
            void importData(file)
              .then((text) => {
                setMessage({ ok: true, text });
                onLibraryChanged?.();
                void reading?.reload();
              })
              .catch((error: unknown) => setMessage({ ok: false, text: error instanceof Error ? error.message : t.importFailed }))
              .finally(() => setBusy(false));
          }}
        />
        <button type="button" className="focus-secondary" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} /> {t.import}</button>
        {/* Bütün kütüphane bir Obsidian kasası olarak: makale başına bir not, ortak kavramlar, dizin. */}
        <a className="focus-secondary" href="/api/library/obsidian" download title={t.obsidianTitle}>
          <Download size={14} /> {t.obsidian}
        </a>
      </div>
      {message ? <p className={message.ok ? "" : "regen-error"} role={message.ok ? "status" : "alert"}>{message.text}</p> : null}
    </section>
  );
}

/**
 * Profil: okuyucunun kimliği, çalışma takvimi ve istatistikleri, tercihleri,
 * oturumları ve verisi. Hepsi bu bilgisayarda (`~/.trace`).
 */
export function ProfileView({
  projects,
  backLabel,
  onBack,
  onFocus,
  onProgress,
  onOpen,
  onLibraryChanged,
}: {
  projects: ResearchProject[];
  backLabel: string;
  onBack: () => void;
  onFocus: () => void;
  onProgress: () => void;
  onOpen: (project: ResearchProject) => void;
  /** Yedek içe aktarılınca kütüphane yeniden okunuyor. */
  onLibraryChanged?: () => void;
}) {
  const { common, focus: words } = useT();
  const t = words.profile;
  const { shortDate } = useDates();
  const { profile, saveProfile, log, logReady, liveIntervals, profileReady } = useFocus();
  const now = useFocusClock();
  const studyState = useLibraryStudyState();
  const [range, setRange] = useState<CalendarRange>("recent");
  const [selected, setSelected] = useState<string>();
  const { preferences } = profile;
  const totals = useMemo(() => dailyTotals(log, now ? liveIntervals(now) : []), [log, liveIntervals, now]);
  const today = useMemo(() => new Date(now || 0), [now]);
  const summary = workSummary(totals, today, { weekStart: preferences.weekStart, goalMinutes: preferences.dailyGoalMinutes });
  const years = calendarYears(totals, today);
  // Makale başına süre, takvimde gösterilen aralıkta.
  const paperRange = useMemo(() => {
    if (range === "recent") return { from: new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1).getTime(), label: t.last12Months };
    return { from: new Date(range, 0, 1).getTime(), to: new Date(range + 1, 0, 1).getTime(), label: t.inYear(range) };
  }, [range, t, today]);

  // Takvim dosyası, gösterilen aralığın oturumları.
  const rangeSessions = useMemo(
    () => log.sessions.filter((session) => Date.parse(session.end) > paperRange.from && (paperRange.to === undefined || Date.parse(session.start) < paperRange.to)),
    [log.sessions, paperRange],
  );

  const { duration } = words;
  const tile = t.tiles;
  const tiles = [
    { label: tile.today, value: duration(summary.today), note: tile.todayNote(duration(preferences.dailyGoalMinutes * 60)) },
    { label: tile.week, value: duration(summary.week), note: tile.weekNote(summary.goalDaysThisWeek) },
    { label: tile.month, value: duration(summary.month), note: tile.monthNote(duration(summary.total)) },
    { label: tile.streak, value: tile.streakValue(summary.currentStreak), note: tile.streakNote(summary.longestStreak) },
    { label: tile.average, value: duration(summary.average), note: tile.averageNote(summary.activeDays) },
    { label: tile.best, value: summary.best ? duration(summary.best.seconds) : "—", note: summary.best ? shortDate.format(dayDate(summary.best.day)) : tile.bestNone },
  ];

  return (
    <main className="compare-page profile-page" style={focusColorStyle(preferences.color)}>
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

      {profileReady ? <IdentityCard key={profile.createdAt} onFocus={onFocus} /> : <p className="stats-note" role="status">{t.loading}</p>}

      <section className="stat-tiles profile-tiles" aria-label={t.summary}>
        {tiles.map((tile) => (
          <div key={tile.label} className="stat-tile">
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
            <small>{tile.note}</small>
          </div>
        ))}
      </section>

      <section className="stats-block profile-calendar" aria-label={t.calendar}>
        <div className="profile-calendar-head">
          <h2>{t.calendar}</h2>
          <div className="profile-calendar-tools">
            <label className="focus-select">
              <span>{common.show}</span>
              <select value={String(range)} onChange={(event) => { setSelected(undefined); setRange(event.target.value === "recent" ? "recent" : Number(event.target.value)); }}>
                <option value="recent">{t.last12Months}</option>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="focus-secondary"
              disabled={!rangeSessions.length}
              title={t.calendarFileTitle}
              onClick={() => {
                const titles = new Map(projects.map((project) => [project.id, project.evidence.paper.title]));
                const file = sessionsIcs(rangeSessions, { paperTitle: (id) => titles.get(id), now: new Date() });
                download(sessionsIcsName(new Date()), file, "text/calendar;charset=utf-8");
              }}
            >
              <CalendarDays size={14} /> {t.calendarFile}
            </button>
          </div>
        </div>
        <p>{t.calendarIntro}</p>
        {logReady && now ? (
          <WorkCalendar
            totals={totals}
            range={range}
            color={preferences.color}
            weekStart={preferences.weekStart}
            goalMinutes={preferences.dailyGoalMinutes}
            today={today}
            selected={selected}
            onSelect={setSelected}
          />
        ) : (
          <p className="stats-note" role="status">{t.loadingLog}</p>
        )}
        <div className="profile-calendar-color">
          <h3>{t.calendarColour}</h3>
          <ColorPicker label={t.calendarColour} value={preferences.color} onChange={(color) => void saveProfile({ ...profile, preferences: { ...preferences, color } })} />
        </div>
      </section>

      {logReady && now ? <WeeklyReport projects={projects} study={studyState.status === "ready" ? studyState.study : undefined} onOpen={onOpen} /> : null}

      <div className="stats-columns profile-columns">
        <SessionsCard key={selected ?? "recent"} selected={selected} />
        <div className="profile-stack">
          <PaperTimeCard projects={projects} onOpen={onOpen} range={paperRange} />
          <PreferencesCard />
          <StudyingCard projects={projects} state={studyState} onProgress={onProgress} />
          <DataCard papers={projects.length} onLibraryChanged={onLibraryChanged} />
          <ThisDeviceCard />
          <TeamCard />
        </div>
      </div>
    </main>
  );
}
