import { createHash, randomInt, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { researchProjectSchema, type ResearchProject } from "./schema";

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

function projectFileName(projectId: string) {
  return `project-${createHash("sha256").update(projectId).digest("hex").slice(0, 24)}.trace.json`;
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

export async function saveStoredProject(project: ResearchProject) {
  const validated = researchProjectSchema.parse(project);
  const path = join(traceLibraryDirectory(), projectFileName(validated.id));
  await atomicWrite(path, `${JSON.stringify(validated, null, 2)}\n`);
  return path;
}

export async function deleteStoredProject(projectId: string) {
  const path = join(traceLibraryDirectory(), projectFileName(projectId));
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
