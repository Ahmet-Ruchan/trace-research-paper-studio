import { createHash, randomInt, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
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
import { findBuiltInTemplate, templateIssues } from "./narrative-templates";
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

async function acquireAccentLock(dataDirectory: string) {
  const lockPath = join(dataDirectory, STATE_LOCK);
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });

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
  throw new Error("The Trace accent cycle is busy. Please retry in a moment.");
}

export async function allocatePaperAccent(paperIdentity: string): Promise<PaperAccent> {
  if (!paperIdentity.trim()) throw new Error("A paper identity is required for accent allocation.");
  const dataDirectory = traceDataDirectory();
  const statePath = join(dataDirectory, STATE_FILE);
  const release = await acquireAccentLock(dataDirectory);
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
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
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
