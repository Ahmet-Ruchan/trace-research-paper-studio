import { parseLibraryTags } from "./library-tags";
import type { RevisionReason, RevisionSummary } from "./project-revisions";
import { researchProjectSchema, type ResearchProject } from "./schema";

const DATABASE_NAME = "trace-research-studio";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const LIBRARY_ENDPOINT = "/api/library";

function openLegacyLibrary() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The legacy library could not be opened."));
  });
}

async function runLegacyTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openLegacyLibrary();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_STORE, mode);
    const request = operation(transaction.objectStore(PROJECT_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The legacy library operation failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("The legacy library operation failed."));
  });
}

async function readLegacyProjects() {
  const values = await runLegacyTransaction<unknown[]>("readonly", (store) => store.getAll());
  return values
    .map((value) => researchProjectSchema.safeParse(value))
    .filter((result) => result.success)
    .map((result) => result.data);
}

async function removeLegacyProject(projectId: string) {
  await runLegacyTransaction<undefined>("readwrite", (store) => store.delete(projectId));
}

async function clearLegacyProjects() {
  await runLegacyTransaction<undefined>("readwrite", (store) => store.clear());
}

async function libraryRequest<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init });
  const body = await response.json().catch(() => undefined) as ({ error?: string } & T) | undefined;
  if (!response.ok) throw new Error(body?.error ?? `The Trace library request failed (HTTP ${response.status}).`);
  if (!body) throw new Error("The Trace library returned an empty response.");
  return body;
}

type SaveOptions = { reason?: RevisionReason; label?: string };

async function saveToDisk(project: ResearchProject, options: SaveOptions = {}) {
  const query = new URLSearchParams({ reason: options.reason ?? "edit" });
  if (options.label) query.set("label", options.label);
  await libraryRequest<{ ok: boolean }>(`${LIBRARY_ENDPOINT}?${query}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
}

export async function listLibraryProjects() {
  const body = await libraryRequest<{ projects: unknown }>(LIBRARY_ENDPOINT);
  const stored = researchProjectSchema.array().parse(body.projects);

  // Before file-backed storage, Trace lived only in this browser's IndexedDB.
  // Migrate those projects once so existing users keep their complete archive.
  const legacy = await readLegacyProjects().catch(() => []);
  const projects = new Map(stored.map((project) => [project.id, project]));
  for (const project of legacy) {
    const existing = projects.get(project.id);
    if (!existing || existing.updatedAt < project.updatedAt) {
      await saveToDisk(project, { reason: "import" });
      projects.set(project.id, project);
    }
  }
  if (legacy.length) await clearLegacyProjects().catch(() => undefined);

  return [...projects.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveLibraryProject(project: ResearchProject, options: SaveOptions = {}) {
  const validated = researchProjectSchema.parse(project);
  await saveToDisk(validated, options);
  await removeLegacyProject(validated.id).catch(() => undefined);
}

export async function deleteLibraryProject(projectId: string) {
  await libraryRequest<{ ok: boolean }>(`${LIBRARY_ENDPOINT}?id=${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
  await removeLegacyProject(projectId).catch(() => undefined);
}

const TAGS_ENDPOINT = "/api/library/tags";

export async function listLibraryTags() {
  return parseLibraryTags(await libraryRequest<unknown>(TAGS_ENDPOINT));
}

/** Etiketlerin tamamını yazar; sunucunun temizlediği hâli döner. */
export async function saveProjectTags(projectId: string, tags: readonly string[]) {
  const body = await libraryRequest<{ tags: string[] }>(`${TAGS_ENDPOINT}?id=${encodeURIComponent(projectId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  });
  return body.tags;
}

const REVISIONS_ENDPOINT = "/api/library/revisions";

export async function listLibraryRevisions(projectId: string) {
  const body = await libraryRequest<{ revisions: RevisionSummary[] }>(
    `${REVISIONS_ENDPOINT}?id=${encodeURIComponent(projectId)}`,
  );
  return body.revisions;
}

export async function loadLibraryRevision(projectId: string, revisionId: string) {
  const body = await libraryRequest<{ revision: RevisionSummary; project: unknown }>(
    `${REVISIONS_ENDPOINT}?id=${encodeURIComponent(projectId)}&revision=${encodeURIComponent(revisionId)}`,
  );
  return { revision: body.revision, project: researchProjectSchema.parse(body.project) };
}

export async function markLibraryRevision(projectId: string, label?: string) {
  const body = await libraryRequest<{ revision: RevisionSummary }>(
    `${REVISIONS_ENDPOINT}?id=${encodeURIComponent(projectId)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) },
  );
  return body.revision;
}
