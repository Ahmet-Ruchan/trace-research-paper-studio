"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowLeft, BarChart3, Camera, Download, Pencil, Play, Timer, Trash2, Upload, X } from "lucide-react";
import { focusColorStyle } from "@/lib/focus-colors";
import { learningStats } from "@/lib/learning-stats";
import { displayName, MAX_PHOTO_CHARS, SOUNDS, type Preferences, type Profile, type SoundId } from "@/lib/profile";
import type { ResearchProject } from "@/lib/schema";
import { calendarYears, dailyTotals, dayDate, dayKey, formatDuration, SESSION_KIND_LABELS, sessionPieces, workSummary, type WorkSession } from "@/lib/work-log";
import { DisplayControl } from "../display-control";
import { useLibraryStudyState } from "../study-progress";
import { useFocus, useFocusClock } from "./focus-provider";
import { Avatar, ColorPicker, NumberField, Toggle } from "./focus-parts";
import { StudioNav } from "./studio-nav";
import { PaperTimeCard } from "./paper-time";
import { WeeklyReport } from "./weekly-report";
import { WorkCalendar, type CalendarRange } from "./work-calendar";

const longDate = new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });
const memberSince = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });

/** Fotoğraf 192 px kareye kırpılıp JPEG'e çevriliyor: profil dosyası küçük kalsın. */
async function photoFrom(file: File) {
  if (!/^image\//.test(file.type)) throw new Error("Choose an image file.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The image could not be read."));
      element.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    canvas.getContext("2d")!.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 192, 192);
    const data = canvas.toDataURL("image/jpeg", 0.85);
    if (data.length > MAX_PHOTO_CHARS) throw new Error("The image is too large.");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

type IdentityFields = Pick<Profile, "firstName" | "lastName" | "title" | "institution" | "field" | "email" | "bio">;
const IDENTITY: Array<{ key: keyof IdentityFields; label: string; placeholder: string; max: number; wide?: boolean }> = [
  { key: "firstName", label: "First name", placeholder: "Ada", max: 60 },
  { key: "lastName", label: "Last name", placeholder: "Lovelace", max: 60 },
  { key: "title", label: "Role", placeholder: "PhD student, research engineer…", max: 80 },
  { key: "institution", label: "Institution", placeholder: "University, lab or company", max: 120 },
  { key: "field", label: "Field of study", placeholder: "Machine learning, neuroscience…", max: 120 },
  { key: "email", label: "Email", placeholder: "Optional, only kept on this computer", max: 200 },
  { key: "bio", label: "About you", placeholder: "A line about what you are reading and why", max: 400, wide: true },
];

function IdentityCard({ onFocus }: { onFocus: () => void }) {
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
    <section className="profile-identity" style={focusColorStyle(profile.preferences.color)} aria-label="About you">
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
            void photoFrom(file)
              .then((photo) => saveProfile({ ...profile, photo }))
              .catch((error: unknown) => setPhotoError(error instanceof Error ? error.message : "The photo could not be used."));
          }}
        />
        <div>
          <button type="button" className="focus-secondary" onClick={() => photoInput.current?.click()}><Camera size={14} /> {profile.photo ? "Change photo" : "Add a photo"}</button>
          {profile.photo ? (
            <button type="button" className="focus-icon-button" aria-label="Remove the photo" onClick={() => void saveProfile({ ...profile, photo: undefined })}><X size={15} /></button>
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
              <span>{field.label}</span>
              {field.wide ? (
                <textarea rows={3} maxLength={field.max} placeholder={field.placeholder} value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
              ) : (
                <input
                  type={field.key === "email" ? "email" : "text"}
                  maxLength={field.max}
                  placeholder={field.placeholder}
                  autoComplete={field.key === "firstName" ? "given-name" : field.key === "lastName" ? "family-name" : field.key === "email" ? "email" : "off"}
                  value={draft[field.key]}
                  onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                />
              )}
            </label>
          ))}
          {profileError ? <p className="regen-error is-wide" role="alert">{profileError}</p> : null}
          <div className="profile-form-actions is-wide">
            <button type="submit" className="focus-primary">Save</button>
            <button type="button" className="focus-secondary" onClick={() => { setDraft(profile); setEditing(false); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="profile-about">
          <p className="landing-eyebrow"><span /> Profile</p>
          <h1>{name || "Your profile"}</h1>
          {details ? <p className="profile-details">{details}</p> : null}
          {profile.field ? <p className="profile-field">{profile.field}</p> : null}
          {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
          {!name ? <p className="profile-bio">Add your name and what you study; it greets you on the timer and stays on this computer.</p> : null}
          <p className="profile-meta">
            {profile.email ? <span>{profile.email}</span> : null}
            <span>Using Trace since {memberSince.format(new Date(profile.createdAt))}</span>
            {saved ? <span role="status">Saved.</span> : null}
          </p>
          <div className="profile-form-actions">
            <button type="button" className="focus-primary" onClick={() => { setDraft(profile); setSaved(false); setEditing(true); }}><Pencil size={14} /> Edit profile</button>
            <button type="button" className="focus-secondary" onClick={onFocus}><Timer size={14} /> Open the timer</button>
          </div>
        </div>
      )}
    </section>
  );
}

function StudyingCard({ projects, onProgress }: { projects: ResearchProject[]; onProgress: () => void }) {
  const state = useLibraryStudyState();
  const now = useFocusClock();
  const stats = useMemo(() => (state.status === "ready" && now ? learningStats(projects, state.study, new Date(now).toISOString()) : undefined), [projects, state, now]);
  if (!stats) return null;
  return (
    <section className="stats-block profile-studying" aria-label="Studying">
      <h2>Studying</h2>
      <p>
        {stats.papers.length
          ? `${stats.totals.finished} ${stats.totals.finished === 1 ? "paper" : "papers"} finished and ${stats.totals.started} in progress. ${stats.totals.reviews ? `You remembered ${stats.totals.remembered} of ${stats.totals.reviews} reviews` : "No reviews yet"}, and ${stats.totals.due} ${stats.totals.due === 1 ? "card is" : "cards are"} waiting.`
          : "Open a paper and start Study: what you answer and read is counted here."}
      </p>
      <button type="button" className="focus-secondary" onClick={onProgress}><BarChart3 size={14} /> Your progress</button>
    </section>
  );
}

function PreferencesCard() {
  const { profile, saveProfile, previewSound } = useFocus();
  const { preferences } = profile;
  const set = (patch: Partial<Preferences>) => void saveProfile({ ...profile, preferences: { ...preferences, ...patch } });
  const [permission, setPermission] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const goalHours = Math.floor(preferences.dailyGoalMinutes / 60);
  const goalMinutes = preferences.dailyGoalMinutes % 60;

  return (
    <section className="stats-block profile-preferences" aria-label="Goals and preferences">
      <h2>Goals and preferences</h2>
      <div className="focus-number-grid">
        <NumberField label="Daily goal, hours" value={goalHours} min={0} max={24} onChange={(hours) => set({ dailyGoalMinutes: Math.min(1440, Math.max(15, hours * 60 + goalMinutes)) })} />
        <NumberField label="and minutes" value={goalMinutes} min={0} max={59} onChange={(minutes) => set({ dailyGoalMinutes: Math.min(1440, Math.max(15, goalHours * 60 + minutes)) })} />
      </div>
      <div className="profile-choices">
        <div role="group" aria-label="Week starts on">
          <span>Week starts on</span>
          {([[1, "Monday"], [0, "Sunday"]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={preferences.weekStart === value} onClick={() => set({ weekStart: value })}>{label}</button>
          ))}
        </div>
        <div role="group" aria-label="Clock">
          <span>Clock</span>
          {([["24h", "24-hour"], ["12h", "12-hour"]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={preferences.clock === value} onClick={() => set({ clock: value })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="profile-sound">
        <label className="focus-select">
          <span>Sound</span>
          <select value={preferences.sound} onChange={(event) => set({ sound: event.target.value as SoundId })}>
            {SOUNDS.map((sound) => <option key={sound.id} value={sound.id}>{sound.label}</option>)}
          </select>
        </label>
        <label className="profile-volume">
          <span>Volume</span>
          <input type="range" min={0} max={1} step={0.05} value={preferences.volume} onChange={(event) => set({ volume: Number(event.target.value) })} aria-valuetext={`${Math.round(preferences.volume * 100)}%`} />
        </label>
        <button type="button" className="focus-secondary" onClick={previewSound} disabled={preferences.sound === "none" || !preferences.volume}><Play size={14} /> Play it</button>
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
        label="Desktop notifications"
        hint={permission === "denied" ? "Blocked in this browser; allow them in the site settings." : "When a round ends or an alarm rings while Trace is in the background."}
      />
      <Toggle checked={preferences.reviewCountsAsWork} onChange={(reviewCountsAsWork) => set({ reviewCountsAsWork })} label="Count review time as work" hint="The time you spend on cards in Review, up to five minutes a card, is added to your calendar." />
    </section>
  );
}

function SessionsCard({ selected }: { selected?: string }) {
  const { log, addSessions, deleteSession, logError, profile } = useFocus();
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [start, setStart] = useState("09:00");
  const [minutes, setMinutes] = useState(30);
  const [label, setLabel] = useState("");
  const [added, setAdded] = useState<string>();
  const time = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", hour12: profile.preferences.clock === "12h" });
  const shown = (selected ? log.sessions.filter((session) => dayKey(new Date(session.start)) === selected || dayKey(new Date(session.end)) === selected) : log.sessions.slice(-12)).slice().reverse();

  return (
    <section className="stats-block profile-sessions" aria-label="Sessions">
      <h2>{selected ? longDate.format(dayDate(selected)) : "Recent sessions"}</h2>
      {shown.length ? (
        <ul className="focus-sessions">
          {shown.map((session: WorkSession) => (
            <li key={session.id}>
              <span>{selected ? "" : `${shortDate.format(new Date(session.start))}, `}{time.format(new Date(session.start))}–{time.format(new Date(session.end))}</span>
              <span>{session.label || SESSION_KIND_LABELS[session.kind]}</span>
              <strong>{formatDuration((Date.parse(session.end) - Date.parse(session.start)) / 1000)}</strong>
              <button type="button" className="focus-icon-button" aria-label={`Delete the session at ${time.format(new Date(session.start))}`} onClick={() => void deleteSession(session.id)}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{selected ? "No work recorded on this day." : "No sessions yet. Start a focus round, or add time you worked without the timer."}</p>
      )}
      <form
        className="profile-manual"
        aria-label="Add time by hand"
        onSubmit={(event) => {
          event.preventDefault();
          const [hours, mins] = start.split(":").map(Number);
          const from = dayDate(date);
          from.setHours(hours, mins, 0, 0);
          const begin = from.getTime();
          const end = Math.min(begin + minutes * 60_000, Date.now());
          if (end <= begin) return setAdded("That time has not come yet.");
          const sessions = sessionPieces({ kind: "manual", label, color: profile.preferences.color, id: `manual-${begin}` }, begin, end);
          void addSessions(sessions).then((ok) => {
            if (ok) {
              setAdded(`${formatDuration((end - begin) / 1000)} added to ${shortDate.format(from)}.`);
              setLabel("");
            }
          });
        }}
      >
        <h3>Add time by hand</h3>
        <p>For work you did without the timer.</p>
        <label><span>Day</span><input type="date" required max={dayKey(new Date())} value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>From</span><input type="time" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <NumberField label="Minutes" value={minutes} min={1} max={720} onChange={setMinutes} />
        <label className="is-wide"><span>Label</span><input maxLength={120} placeholder="What you worked on" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <button type="submit" className="focus-secondary">Add</button>
        {added ? <p role="status">{added}</p> : null}
        {logError ? <p className="regen-error" role="alert">{logError}</p> : null}
      </form>
    </section>
  );
}

function DataCard() {
  const { importData } = useFocus();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();

  return (
    <section className="stats-block profile-data" aria-label="Your data">
      <h2>Your data</h2>
      <p>
        Your profile and every minute you worked are kept on this computer, in <code>~/.trace/profile.json</code> and <code>~/.trace/focus-log.json</code>, with a
        daily copy of the last seven days in <code>~/.trace/backups</code>. Nothing is sent anywhere. Download it all to move to another computer; importing adds
        sessions to yours and never removes any.
      </p>
      <div className="profile-form-actions">
        <button
          type="button"
          className="focus-secondary"
          onClick={() =>
            void fetch("/api/profile/data", { cache: "no-store" })
              .then((response) => response.text())
              .then((text) => download(`trace-work-data-${dayKey(new Date())}.json`, text))
          }
        >
          <Download size={14} /> Download my data
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
            void importData(file)
              .then((text) => setMessage({ ok: true, text }))
              .catch((error: unknown) => setMessage({ ok: false, text: error instanceof Error ? error.message : "The file could not be imported." }));
          }}
        />
        <button type="button" className="focus-secondary" onClick={() => input.current?.click()}><Upload size={14} /> Import a file</button>
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
}: {
  projects: ResearchProject[];
  backLabel: string;
  onBack: () => void;
  onFocus: () => void;
  onProgress: () => void;
  onOpen: (project: ResearchProject) => void;
}) {
  const { profile, saveProfile, log, logReady, liveIntervals, profileReady } = useFocus();
  const now = useFocusClock();
  const [range, setRange] = useState<CalendarRange>("recent");
  const [selected, setSelected] = useState<string>();
  const { preferences } = profile;
  const totals = useMemo(() => dailyTotals(log, now ? liveIntervals(now) : []), [log, liveIntervals, now]);
  const today = useMemo(() => new Date(now || 0), [now]);
  const summary = workSummary(totals, today, { weekStart: preferences.weekStart, goalMinutes: preferences.dailyGoalMinutes });
  const years = calendarYears(totals, today);
  // Makale başına süre, takvimde gösterilen aralıkta.
  const paperRange = useMemo(() => {
    if (range === "recent") return { from: new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1).getTime(), label: "The last 12 months" };
    return { from: new Date(range, 0, 1).getTime(), to: new Date(range + 1, 0, 1).getTime(), label: `In ${range}` };
  }, [range, today]);

  const tiles = [
    { label: "Today", value: formatDuration(summary.today), note: `goal ${formatDuration(preferences.dailyGoalMinutes * 60)}` },
    { label: "This week", value: formatDuration(summary.week), note: `goal met on ${summary.goalDaysThisWeek} ${summary.goalDaysThisWeek === 1 ? "day" : "days"}` },
    { label: "This month", value: formatDuration(summary.month), note: `${formatDuration(summary.total)} in all` },
    { label: "Streak", value: `${summary.currentStreak} ${summary.currentStreak === 1 ? "day" : "days"}`, note: `longest ${summary.longestStreak} ${summary.longestStreak === 1 ? "day" : "days"}` },
    { label: "Daily average", value: formatDuration(summary.average), note: `over ${summary.activeDays} ${summary.activeDays === 1 ? "day" : "days"} worked` },
    { label: "Best day", value: summary.best ? formatDuration(summary.best.seconds) : "—", note: summary.best ? shortDate.format(dayDate(summary.best.day)) : "nothing yet" },
  ];

  return (
    <main className="compare-page profile-page" style={focusColorStyle(preferences.color)}>
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

      {profileReady ? <IdentityCard key={profile.createdAt} onFocus={onFocus} /> : <p className="stats-note" role="status">Reading your profile…</p>}

      <section className="stat-tiles profile-tiles" aria-label="Work summary">
        {tiles.map((tile) => (
          <div key={tile.label} className="stat-tile">
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
            <small>{tile.note}</small>
          </div>
        ))}
      </section>

      <section className="stats-block profile-calendar" aria-label="Work calendar">
        <div className="profile-calendar-head">
          <h2>Work calendar</h2>
          <label className="focus-select">
            <span>Show</span>
            <select value={String(range)} onChange={(event) => { setSelected(undefined); setRange(event.target.value === "recent" ? "recent" : Number(event.target.value)); }}>
              <option value="recent">The last 12 months</option>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
        </div>
        <p>Each square is a day; the darker, the closer you came to your daily goal. Choose a day to see its sessions.</p>
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
          <p className="stats-note" role="status">Reading your work log…</p>
        )}
        <div className="profile-calendar-color">
          <h3>Calendar colour</h3>
          <ColorPicker label="Calendar colour" value={preferences.color} onChange={(color) => void saveProfile({ ...profile, preferences: { ...preferences, color } })} />
        </div>
      </section>

      {logReady && now ? <WeeklyReport projects={projects} onOpen={onOpen} /> : null}

      <div className="stats-columns profile-columns">
        <SessionsCard key={selected ?? "recent"} selected={selected} />
        <div className="profile-stack">
          <PaperTimeCard projects={projects} onOpen={onOpen} range={paperRange} />
          <PreferencesCard />
          <StudyingCard projects={projects} onProgress={onProgress} />
          <DataCard />
        </div>
      </div>
    </main>
  );
}
