import { createHash, randomInt, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  isRevisionFileName,
  revisionFileName,
  revisionId,
  revisionIdPattern,
  revisionRecordSchema,
  revisionsToPrune,
  shouldSnapshot,
  summarizeRevision,
  type RevisionReason,
  type RevisionRecord,
  type RevisionSummary,
} from "./project-revisions";
import { isLibraryTagsFile, libraryTagsToJson, parseLibraryTags, tagListSchema } from "./library-tags";
import { aliasFileSchema, isAliasFile, parseAliasFile, type AliasFile } from "./concept-aliases";
import { findBuiltInTemplate, templateIssues } from "./narrative-templates";
import { isStudyFile, parseStudyFile, studyFileToJson, studyProgressSchema, type StudyProgress } from "./study-path";
import { isNotesFile, notesFileToJson, parseNotesFile, readerNotesSchema, type ReaderNote } from "./reader-notes";
import { emptyProfile, isProfile, parseProfile, profileSchema, type Profile } from "./profile";
import { dayKey, isWorkLog, parseWorkLog, workLogSchema, workLogToJson, type WorkLog } from "./work-log";
import {
  projectContentFingerprint,
  projectForPublication,
  publicationIdPattern,
  publicationRecordSchema,
  summarizePublication,
  type PublicationRecord,
  type PublicationSettings,
} from "./publications";
import { narrativeTemplateSchema, researchProjectSchema, type NarrativeTemplate, type ResearchProject } from "./schema";

export const TRACE_ACCENT_PALETTE = [
  "#2563EB",
  "#38BDF8",
  "#06B6D4",
  "#1E3A8A",
  "#7C3AED",
  "#A78BFA",
  "#D946EF",
  "#EC4899",
  "#F9A8D4",
  "#EF4444",
  "#9F1239",
  "#F97316",
  "#FB923C",
  "#FACC15",
  "#D97706",
  "#22C55E",
  "#166534",
  "#84CC16",
  "#34D399",
  "#65A30D",
] as const;

const STATE_VERSION = 1;
const STATE_FILE = "accent-cycle.json";
const STATE_LOCK = "accent-cycle.lock";
const LOCK_STALE_MS = 30_000;
const LOCK_ATTEMPTS = 200;

type AccentAssignment = {
  accent: string;
  paletteIndex: number;
  cycle: number;
  assignedAt: string;
};

type AccentState = {
  version: typeof STATE_VERSION;
  order: string[];
  nextIndex: number;
  assignmentCount: number;
  assignments: Record<string, AccentAssignment>;
};

export type PaperAccent = AccentAssignment & { reused: boolean };

export function traceDataDirectory() {
  return process.env.TRACE_DATA_DIR
    ? resolve(process.env.TRACE_DATA_DIR)
    : join(homedir(), ".trace");
}

export function traceLibraryDirectory() {
  return process.env.TRACE_LIBRARY_DIR
    ? resolve(process.env.TRACE_LIBRARY_DIR)
    : join(traceDataDirectory(), "library");
}

export function paperIdentityFromBytes(bytes: ArrayBuffer | Uint8Array) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function shufflePalette() {
  const order = [...TRACE_ACCENT_PALETTE];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const selected = randomInt(index + 1);
    [order[index], order[selected]] = [order[selected], order[index]];
  }
  return order;
}

function freshAccentState(): AccentState {
  return {
    version: STATE_VERSION,
    order: shufflePalette(),
    nextIndex: 0,
    assignmentCount: 0,
    assignments: {},
  };
}

function isAccentState(value: unknown): value is AccentState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<AccentState>;
  const palette = new Set<string>(TRACE_ACCENT_PALETTE);
  return (
    state.version === STATE_VERSION &&
    Array.isArray(state.order) &&
    state.order.length === TRACE_ACCENT_PALETTE.length &&
    new Set(state.order).size === TRACE_ACCENT_PALETTE.length &&
    state.order.every((color) => typeof color === "string" && palette.has(color)) &&
    Number.isInteger(state.nextIndex) &&
    (state.nextIndex ?? -1) >= 0 &&
    (state.nextIndex ?? TRACE_ACCENT_PALETTE.length) < TRACE_ACCENT_PALETTE.length &&
    Number.isInteger(state.assignmentCount) &&
    (state.assignmentCount ?? -1) >= 0 &&
    Boolean(state.assignments) &&
    typeof state.assignments === "object"
  );
}

async function atomicWrite(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/**
 * Süreçler arası kilit: aynı dizinde `mkdir` yalnızca bir kez başarılı olur.
 * Oku-değiştir-yaz yapan her durum dosyası (renk döngüsü, etiketler) bunu
 * kullanıyor; iki stüdyo ya da stüdyo ile ajan aynı anda yazabiliyor.
 */
async function acquireDirectoryLock(directory: string, name: string, busyMessage: string) {
  const lockPath = join(directory, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockPath);
      return async () => rmdir(lockPath).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
          await rmdir(lockPath);
          continue;
        }
      } catch (lockError) {
        if ((lockError as NodeJS.ErrnoException).code !== "ENOENT") throw lockError;
      }
      await new Promise((done) => setTimeout(done, 10 + Math.min(attempt, 40)));
    }
  }
  throw new Error(busyMessage);
}

export async function allocatePaperAccent(paperIdentity: string): Promise<PaperAccent> {
  if (!paperIdentity.trim()) throw new Error("A paper identity is required for accent allocation.");
  const dataDirectory = traceDataDirectory();
  const statePath = join(dataDirectory, STATE_FILE);
  const release = await acquireDirectoryLock(dataDirectory, STATE_LOCK, "The Trace accent cycle is busy. Please retry in a moment.");
  try {
    let state = freshAccentState();
    try {
      const parsed: unknown = JSON.parse(await readFile(statePath, "utf8"));
      if (isAccentState(parsed)) state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }

    const existing = state.assignments[paperIdentity];
    if (existing && TRACE_ACCENT_PALETTE.includes(existing.accent as (typeof TRACE_ACCENT_PALETTE)[number])) {
      return { ...existing, reused: true };
    }

    const paletteIndex = state.nextIndex;
    const assignment: AccentAssignment = {
      accent: state.order[paletteIndex],
      paletteIndex,
      cycle: Math.floor(state.assignmentCount / TRACE_ACCENT_PALETTE.length) + 1,
      assignedAt: new Date().toISOString(),
    };
    state.assignments[paperIdentity] = assignment;
    state.assignmentCount += 1;
    state.nextIndex = (paletteIndex + 1) % TRACE_ACCENT_PALETTE.length;
    await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
    return { ...assignment, reused: false };
  } finally {
    await release();
  }
}

function projectFileStem(projectId: string) {
  return `project-${createHash("sha256").update(projectId).digest("hex").slice(0, 24)}`;
}

function projectFileName(projectId: string) {
  return `${projectFileStem(projectId)}.trace.json`;
}

/**
 * Revizyonlar projenin yanında değil kendi dizininde: kütüphane listesi
 * `*.trace.json` dosyalarını tarıyor ve eski sürümler orada görünmemeli.
 */
export function projectRevisionDirectory(projectId: string) {
  return join(traceLibraryDirectory(), "revisions", projectFileStem(projectId));
}

export async function listStoredProjects() {
  const directory = traceLibraryDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entries = await readdir(directory, { withFileTypes: true });
  const projects: ResearchProject[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".trace.json")) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(directory, entry.name), "utf8"));
      const outcome = researchProjectSchema.safeParse(parsed);
      if (outcome.success) projects.push(outcome.data);
    } catch {
      // One damaged user file must not hide the rest of the library.
    }
  }
  return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function revisionIds(projectId: string) {
  try {
    const entries = await readdir(projectRevisionDirectory(projectId), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isRevisionFileName(entry.name))
      .map((entry) => entry.name.slice(0, -".revision.json".length))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeRevision(project: unknown, projectId: string, reason: RevisionReason, label?: string) {
  const savedAt = new Date().toISOString();
  const record: RevisionRecord = {
    version: 1,
    id: revisionId(savedAt, reason, randomUUID().replace(/-/g, "")),
    projectId,
    savedAt,
    reason,
    ...(label?.trim() ? { label: label.trim() } : {}),
    project,
  };
  const directory = projectRevisionDirectory(projectId);
  await atomicWrite(join(directory, revisionFileName(record.id)), `${JSON.stringify(record)}\n`);
  for (const stale of revisionsToPrune(await revisionIds(projectId))) {
    await unlink(join(directory, revisionFileName(stale))).catch(() => undefined);
  }
  return record;
}

async function readStoredProjectFile(projectId: string) {
  try {
    return JSON.parse(await readFile(join(traceLibraryDirectory(), projectFileName(projectId)), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export type SaveOptions = { reason?: RevisionReason; label?: string };

export async function saveStoredProject(project: ResearchProject, options: SaveOptions = {}) {
  const validated = researchProjectSchema.parse(project);
  const reason = options.reason ?? "edit";
  const previous = await readStoredProjectFile(validated.id);
  const newest = (await revisionIds(validated.id)).at(-1);
  const newestRevisionAt = newest ? await readRevisionSavedAt(validated.id, newest) : undefined;
  if (shouldSnapshot({ previous, next: validated, reason, newestRevisionAt, now: new Date().toISOString() })) {
    await writeRevision(previous, validated.id, reason, options.label);
  }
  const path = join(traceLibraryDirectory(), projectFileName(validated.id));
  await atomicWrite(path, `${JSON.stringify(validated, null, 2)}\n`);
  return path;
}

async function readRevisionSavedAt(projectId: string, id: string) {
  try {
    const record = revisionRecordSchema.parse(JSON.parse(await readFile(join(projectRevisionDirectory(projectId), revisionFileName(id)), "utf8")));
    return record.savedAt;
  } catch {
    return undefined;
  }
}

/** Kaydedilmiş hâlin şu anki kopyasını elle bir sürüm olarak işaretler. */
export async function createProjectRevision(projectId: string, label?: string) {
  const current = await readStoredProjectFile(projectId);
  if (current === undefined) return undefined;
  const record = await writeRevision(current, projectId, "manual", label);
  return summarizeRevision(record, researchProjectSchema.parse(current));
}

export async function listProjectRevisions(projectId: string): Promise<RevisionSummary[]> {
  const summaries: RevisionSummary[] = [];
  for (const id of (await revisionIds(projectId)).reverse()) {
    const loaded = await readProjectRevision(projectId, id).catch(() => undefined);
    if (loaded) summaries.push(loaded.summary);
  }
  return summaries;
}

export async function readProjectRevision(projectId: string, id: string) {
  if (!revisionIdPattern.test(id)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(projectRevisionDirectory(projectId), revisionFileName(id)), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const record = revisionRecordSchema.safeParse(raw);
  if (!record.success || record.data.projectId !== projectId) return undefined;
  // Eski bir sürüm bugünkü şemaya uymayabilir; o zaman listede görünmez
  // ama dosya silinmez — kullanıcının verisi.
  const project = researchProjectSchema.safeParse(record.data.project);
  if (!project.success) return undefined;
  return { summary: summarizeRevision(record.data, project.data), project: project.data };
}

export async function deleteStoredProject(projectId: string) {
  const path = join(traceLibraryDirectory(), projectFileName(projectId));
  // Kütüphaneden kaldırmak projenin geçmişini de kaldırır; yetim revizyonlar
  // hiçbir arayüzden görünmeyen, silinemeyen kopyalar olarak kalırdı.
  await rm(projectRevisionDirectory(projectId), { recursive: true, force: true });
  // Silinen bir projenin paylaşılmış bağlantıları da kapanmalı; yazar
  // projeyi kaldırdığında onun dışarıda okunmaya devam etmesini beklemez.
  for (const publication of await listPublications(projectId)) {
    await deletePublication(publication.id);
  }
  // Etiket kaydı da gitmeli; kalırsa aynı kimlikle yeniden eklenen proje
  // silinmeden önceki koleksiyonlarına geri dönerdi. Bu adım başarısız olursa
  // silme yine tamamlanıyor: artakalan kayıt hiçbir listede görünmüyor.
  await saveStoredProjectTags(projectId, []).catch(() => undefined);
  // Çalışma ilerlemesi de: aynı kimlikle eklenen başka bir makale eski yanıtları devralmamalı.
  await saveStudyProgress(projectId, undefined).catch(() => undefined);
  // Notlar da; günlük yedekte yedi gün kalıyorlar (`saveReaderNotes`).
  await saveReaderNotes(projectId, []).catch(() => undefined);
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Kütüphane etiketleri — ~/.trace/library/tags.json
 *
 * Neden projenin içinde değil: `library-tags.ts`. Dosya kütüphanenin yanında
 * duruyor, çünkü etiketler proje kimliklerine bağlı ve `TRACE_LIBRARY_DIR`
 * kütüphaneyi taşıdığında onlar da birlikte gitmeli. Kütüphane listesi
 * yalnızca `*.trace.json` dosyalarını okuduğu için bu dosya orada görünmüyor.
 * ------------------------------------------------------------------ */

const TAGS_FILE = "tags.json";
const TAGS_LOCK = "tags.lock";

async function readTagsFile(): Promise<{ exists: boolean; raw: unknown }> {
  try {
    return { exists: true, raw: JSON.parse(await readFile(join(traceLibraryDirectory(), TAGS_FILE), "utf8")) as unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, raw: undefined };
    if (error instanceof SyntaxError) return { exists: true, raw: undefined };
    throw error;
  }
}

export async function readLibraryTags() {
  return parseLibraryTags((await readTagsFile()).raw);
}

/**
 * Bir projenin etiketlerini yazar; boş liste kaydı kaldırır. Hiçbir şey
 * değişmiyorsa dosyaya dokunulmuyor: etiketi olmayan bir projeyi silmek boş
 * bir `tags.json` yaratmamalı.
 *
 * Tanınmayan (bozuk ya da elle bozulmuş) bir dosyanın üzerine yazılmıyor;
 * dosya `tags.damaged-<zaman>.json` adıyla kenara alınıyor. İçindeki etiketler
 * kullanıcının emeği ve kurtarılabilir kalmalı.
 */
export async function saveStoredProjectTags(projectId: string, tags: readonly string[]) {
  const next = tagListSchema.parse(tags);
  const directory = traceLibraryDirectory();
  const release = await acquireDirectoryLock(directory, TAGS_LOCK, "The Trace tags are busy. Please retry in a moment.");
  try {
    const file = await readTagsFile();
    const current = parseLibraryTags(file.raw);
    const previous = current.get(projectId) ?? [];
    if (previous.length === next.length && previous.every((tag, index) => tag === next[index])) return next;
    if (file.exists && !isLibraryTagsFile(file.raw)) {
      const stamp = new Date().toISOString().replace(/[-:.]/g, "");
      await rename(join(directory, TAGS_FILE), join(directory, `tags.damaged-${stamp}.json`));
    }
    if (next.length) current.set(projectId, next);
    else current.delete(projectId);
    await atomicWrite(join(directory, TAGS_FILE), `${JSON.stringify(libraryTagsToJson(current), null, 2)}\n`);
    return next;
  } finally {
    await release();
  }
}

/* ------------------------------------------------------------------ *
 * Çalışma ilerlemesi — ~/.trace/library/study.json
 *
 * Etiketler gibi kütüphanenin bilgisi, makalenin değil (`study-path.ts`):
 * çalışmak projeyi değiştirmiyor ve paylaşılan bir JSON kişinin yanıtlarını
 * taşımıyor. Aynı kilit ve bozuk dosyayı kenara alma kuralı geçerli.
 * ------------------------------------------------------------------ */

const STUDY_FILE = "study.json";
const STUDY_LOCK = "study.lock";

async function readStudyFile(): Promise<{ exists: boolean; raw: unknown }> {
  try {
    return { exists: true, raw: JSON.parse(await readFile(join(traceLibraryDirectory(), STUDY_FILE), "utf8")) as unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, raw: undefined };
    if (error instanceof SyntaxError) return { exists: true, raw: undefined };
    throw error;
  }
}

export async function readAllStudyProgress() {
  return parseStudyFile((await readStudyFile()).raw);
}

export async function readStudyProgress(projectId: string) {
  return (await readAllStudyProgress()).get(projectId);
}

/** Bir projenin ilerlemesini yazar; `undefined` kaydı kaldırır. Değişiklik yoksa dosyaya dokunulmuyor. */
export async function saveStudyProgress(projectId: string, progress: StudyProgress | undefined) {
  const next = progress === undefined ? undefined : studyProgressSchema.parse(progress);
  const directory = traceLibraryDirectory();
  const release = await acquireDirectoryLock(directory, STUDY_LOCK, "The study progress is busy. Please retry in a moment.");
  try {
    const file = await readStudyFile();
    const current = parseStudyFile(file.raw);
    if (!next && !current.has(projectId)) return next;
    if (file.exists && !isStudyFile(file.raw)) {
      const stamp = new Date().toISOString().replace(/[-:.]/g, "");
      await rename(join(directory, STUDY_FILE), join(directory, `study.damaged-${stamp}.json`));
    }
    if (next) current.set(projectId, next);
    else current.delete(projectId);
    await atomicWrite(join(directory, STUDY_FILE), `${JSON.stringify(studyFileToJson(current), null, 2)}\n`);
    return next;
  } finally {
    await release();
  }
}

/* ------------------------------------------------------------------ *
 * Okuyucunun notları — ~/.trace/library/notes.json
 *
 * Çalışma ilerlemesi gibi okuyucunun kaydı (`reader-notes.ts`). Notlar
 * okuyucunun kendi yazdığı metin: her günün ilk yazımından önce dosyanın bir
 * kopyası `~/.trace/backups` içine alınıyor, bozuk dosya kenara konuyor.
 * ------------------------------------------------------------------ */

const NOTES_FILE = "notes.json";
const NOTES_LOCK = "notes.lock";

export async function readAllReaderNotes() {
  return parseNotesFile((await readJsonFile(join(traceLibraryDirectory(), NOTES_FILE))).raw);
}

export async function readReaderNotes(projectId: string) {
  return (await readAllReaderNotes()).get(projectId) ?? [];
}

/** Bir makalenin notlarını yazar; boş liste kaydı kaldırır. Değişiklik yoksa dosyaya dokunulmuyor. */
export async function saveReaderNotes(projectId: string, notes: readonly ReaderNote[]) {
  const next = readerNotesSchema.parse(notes);
  const directory = traceLibraryDirectory();
  const path = join(directory, NOTES_FILE);
  const release = await acquireDirectoryLock(directory, NOTES_LOCK, "Your notes are busy. Please retry in a moment.");
  try {
    const file = await readJsonFile(path);
    const current = parseNotesFile(file.raw);
    if (!next.length && !current.has(projectId)) return next;
    if (file.exists && !isNotesFile(file.raw)) await setAsideDamaged(path, "notes");
    else if (file.exists) await dailyBackup(path, "notes");
    if (next.length) current.set(projectId, next);
    else current.delete(projectId);
    await atomicWrite(path, `${JSON.stringify(notesFileToJson(current), null, 2)}\n`);
    return next;
  } finally {
    await release();
  }
}

/* ------------------------------------------------------------------ *
 * Kavram eşleri — ~/.trace/library/aliases.json
 *
 * Okuyucunun "aynı kavram" / "farklı" kararları (`concept-aliases.ts`).
 * Etiketler gibi kütüphanenin bilgisi; aynı kilit ve bozuk dosyayı kenara
 * alma kuralı.
 * ------------------------------------------------------------------ */

const ALIASES_FILE = "aliases.json";
const ALIASES_LOCK = "aliases.lock";

async function readAliasesFile(): Promise<{ exists: boolean; raw: unknown }> {
  try {
    return { exists: true, raw: JSON.parse(await readFile(join(traceLibraryDirectory(), ALIASES_FILE), "utf8")) as unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, raw: undefined };
    if (error instanceof SyntaxError) return { exists: true, raw: undefined };
    throw error;
  }
}

export async function readConceptAliases(): Promise<AliasFile> {
  return parseAliasFile((await readAliasesFile()).raw);
}

/** Kararları kilidin altında değiştirir; tanınmayan bir dosya kenara alınıyor, üzerine yazılmıyor. */
export async function updateConceptAliases(change: (file: AliasFile) => AliasFile): Promise<AliasFile> {
  const directory = traceLibraryDirectory();
  const release = await acquireDirectoryLock(directory, ALIASES_LOCK, "The concept links are busy. Please retry in a moment.");
  try {
    const file = await readAliasesFile();
    const next = aliasFileSchema.parse(change(parseAliasFile(file.raw)));
    if (file.exists && !isAliasFile(file.raw)) {
      const stamp = new Date().toISOString().replace(/[-:.]/g, "");
      await rename(join(directory, ALIASES_FILE), join(directory, `aliases.damaged-${stamp}.json`));
    }
    await atomicWrite(join(directory, ALIASES_FILE), `${JSON.stringify(next, null, 2)}\n`);
    return next;
  } finally {
    await release();
  }
}

/* ------------------------------------------------------------------ *
 * Profil ve çalışma kaydı — ~/.trace/profile.json, ~/.trace/focus-log.json
 *
 * Kütüphaneye değil okuyucuya ait; bu yüzden kütüphane dizininde değil veri
 * dizininin kökünde. Kayıt geriye dönük kaybolmamalı: yazımlar atomik ve
 * kilitli, tanınmayan dosya kenara alınıyor (üzerine yazılmıyor) ve her
 * dosyanın günde bir yedeği `backups/` altında son yedi günlük tutuluyor.
 * ------------------------------------------------------------------ */

const PROFILE_FILE = "profile.json";
const PROFILE_LOCK = "profile.lock";
const WORK_LOG_FILE = "focus-log.json";
const WORK_LOG_LOCK = "focus-log.lock";
const BACKUPS_KEPT = 7;

async function readJsonFile(path: string): Promise<{ exists: boolean; raw: unknown }> {
  try {
    return { exists: true, raw: JSON.parse(await readFile(path, "utf8")) as unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, raw: undefined };
    if (error instanceof SyntaxError) return { exists: true, raw: undefined };
    throw error;
  }
}

/** Günün ilk yazımından önce dosyanın bir kopyası; en yeni yedi gün kalıyor. */
async function dailyBackup(path: string, stem: string) {
  const directory = join(traceDataDirectory(), "backups");
  const target = join(directory, `${stem}-${dayKey(new Date())}.json`);
  try {
    await stat(target);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await copyFile(path, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const kept = (await readdir(directory)).filter((name) => new RegExp(`^${stem}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(name)).sort();
  for (const old of kept.slice(0, -BACKUPS_KEPT)) await rm(join(directory, old), { force: true });
}

async function setAsideDamaged(path: string, stem: string) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  await rename(path, join(dirname(path), `${stem}.damaged-${stamp}.json`));
}

export async function readProfile(): Promise<Profile> {
  const file = await readJsonFile(join(traceDataDirectory(), PROFILE_FILE));
  return file.exists ? parseProfile(file.raw, new Date().toISOString()) : emptyProfile(new Date().toISOString());
}

export async function updateProfile(change: (profile: Profile) => Profile): Promise<Profile> {
  const directory = traceDataDirectory();
  const path = join(directory, PROFILE_FILE);
  const release = await acquireDirectoryLock(directory, PROFILE_LOCK, "The profile is busy. Please retry in a moment.");
  try {
    const file = await readJsonFile(path);
    const now = new Date().toISOString();
    const next = profileSchema.parse(change(parseProfile(file.raw, now)));
    if (file.exists && !isProfile(file.raw)) await setAsideDamaged(path, "profile");
    else if (file.exists) await dailyBackup(path, "profile");
    await atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  } finally {
    await release();
  }
}

export async function readWorkLog(): Promise<WorkLog> {
  return parseWorkLog((await readJsonFile(join(traceDataDirectory(), WORK_LOG_FILE))).raw);
}

export async function updateWorkLog(change: (log: WorkLog) => WorkLog): Promise<WorkLog> {
  const directory = traceDataDirectory();
  const path = join(directory, WORK_LOG_FILE);
  const release = await acquireDirectoryLock(directory, WORK_LOG_LOCK, "The work log is busy. Please retry in a moment.");
  try {
    const file = await readJsonFile(path);
    const next = workLogSchema.parse(change(parseWorkLog(file.raw)));
    if (file.exists && !isWorkLog(file.raw)) await setAsideDamaged(path, "focus-log");
    else if (file.exists) await dailyBackup(path, "focus-log");
    await atomicWrite(path, workLogToJson(next));
    return next;
  } finally {
    await release();
  }
}

/* ------------------------------------------------------------------ *
 * Anlatı şablonları — ~/.trace/templates
 *
 * Kütüphane gibi makineye ait: Codex, Claude Code, Antigravity ve stüdyo aynı
 * şablonları görüyor. Hazır şablonlar kodda duruyor, burada değil.
 * ------------------------------------------------------------------ */

export function traceTemplateDirectory() {
  return process.env.TRACE_TEMPLATE_DIR
    ? resolve(process.env.TRACE_TEMPLATE_DIR)
    : join(traceDataDirectory(), "templates");
}

function templatePath(id: string) {
  // Kimlik şemayla kebab-case'e kısıtlı; yine de yol üretmeden önce doğrulanıyor.
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error("The template id is not valid.");
  return join(traceTemplateDirectory(), `${id}.template.json`);
}

export async function listStoredTemplates() {
  const directory = traceTemplateDirectory();
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const templates: NarrativeTemplate[] = [];
  for (const name of names) {
    if (!name.endsWith(".template.json")) continue;
    try {
      const parsed = narrativeTemplateSchema.safeParse(JSON.parse(await readFile(join(directory, name), "utf8")));
      if (parsed.success) templates.push({ ...parsed.data, builtIn: false });
    } catch {
      // Bozuk bir dosya ötekileri gizlememeli.
    }
  }
  return templates.sort((left, right) => left.name.localeCompare(right.name));
}

export async function saveStoredTemplate(input: unknown) {
  const template = { ...narrativeTemplateSchema.parse(input), builtIn: false };
  if (findBuiltInTemplate(template.id)) throw new Error("That id belongs to a built-in template; choose another name.");
  const issues = templateIssues(template);
  if (issues.length) throw new Error(`The template cannot be used: ${issues.join("; ")}.`);
  await atomicWrite(templatePath(template.id), `${JSON.stringify(template, null, 2)}\n`);
  return template;
}

export async function deleteStoredTemplate(id: string) {
  try {
    await unlink(templatePath(id));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Yayınlar — ~/.trace/publications
 * ------------------------------------------------------------------ */

export function tracePublicationDirectory() {
  return process.env.TRACE_PUBLICATION_DIR
    ? resolve(process.env.TRACE_PUBLICATION_DIR)
    : join(traceDataDirectory(), "publications");
}

function publicationFile(id: string) {
  if (!publicationIdPattern.test(id)) throw new Error("The publication id is not valid.");
  return join(tracePublicationDirectory(), `${id}.publication.json`);
}

/** Kütüphanedeki kaydedilmiş hâl; yayın her zaman diske yazılmış sürümden alınır. */
export async function readStoredProject(projectId: string) {
  const raw = await readStoredProjectFile(projectId);
  const parsed = researchProjectSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export async function readPublication(id: string): Promise<PublicationRecord | undefined> {
  if (!publicationIdPattern.test(id)) return undefined;
  try {
    const parsed = publicationRecordSchema.safeParse(JSON.parse(await readFile(publicationFile(id), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function writePublication(record: PublicationRecord) {
  await atomicWrite(publicationFile(record.id), `${JSON.stringify(record)}\n`);
}

export async function listPublications(projectId?: string) {
  let names: string[] = [];
  try {
    names = await readdir(tracePublicationDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const now = new Date().toISOString();
  const summaries = [];
  for (const name of names) {
    const match = /^([a-f0-9]{20})\.publication\.json$/.exec(name);
    if (!match) continue;
    const record = await readPublication(match[1]).catch(() => undefined);
    if (record && (!projectId || record.projectId === projectId)) summaries.push(summarizePublication(record, now));
  }
  return summaries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createPublication(projectId: string, settings: PublicationSettings) {
  const project = await readStoredProject(projectId);
  if (!project) return undefined;
  const now = new Date().toISOString();
  const record: PublicationRecord = {
    version: 1,
    // 80 bit rastgelelik: bağlantı tek erişim denetimi, tahmin edilememeli.
    id: randomUUID().replace(/-/g, "").slice(0, 20),
    projectId,
    title: project.story.title,
    createdAt: now,
    updatedAt: now,
    publishedFrom: project.updatedAt,
    contentFingerprint: projectContentFingerprint(project),
    status: "live",
    settings,
    project: projectForPublication(project, settings.include),
  };
  await writePublication(record);
  return summarizePublication(record, now);
}

export type PublicationPatch = {
  status?: PublicationRecord["status"];
  settings?: PublicationSettings;
  /** Kopyayı kütüphanedeki güncel sürümle yenile. */
  refresh?: boolean;
};

export async function updatePublication(id: string, patch: PublicationPatch) {
  const record = await readPublication(id);
  if (!record) return undefined;
  const now = new Date().toISOString();
  const settings = patch.settings ?? record.settings;
  let source: ResearchProject | undefined;
  if (patch.refresh) {
    source = await readStoredProject(record.projectId);
    if (!source) throw new Error("The project is no longer in the library, so this publication cannot be updated.");
  } else if (patch.settings) {
    // Denetim değişince kopya YENİDEN süzülmeli; ama yazarın yayından sonra
    // yaptığı düzenlemeler bu yolla sızmamalı. Kaynak, yayındaki içerik —
    // çıkarılmış bir blok ancak "güncelle" ile geri gelebilir.
    source = researchProjectSchema.parse(record.project);
  }
  const next: PublicationRecord = {
    ...record,
    updatedAt: now,
    status: patch.status ?? record.status,
    settings,
    ...(source
      ? {
          title: source.story.title,
          publishedFrom: patch.refresh ? source.updatedAt : record.publishedFrom,
          contentFingerprint: patch.refresh ? projectContentFingerprint(source) : record.contentFingerprint,
          project: projectForPublication(source, settings.include),
        }
      : {}),
  };
  await writePublication(next);
  return summarizePublication(next, now);
}

export async function deletePublication(id: string) {
  try {
    await unlink(publicationFile(id));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
