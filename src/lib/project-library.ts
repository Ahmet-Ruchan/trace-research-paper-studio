import { researchProjectSchema, type ResearchProject } from "./schema";

const DATABASE_NAME = "trace-research-studio";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";

function openLibrary() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Kütüphane açılamadı."));
  });
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openLibrary();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_STORE, mode);
    const request = operation(transaction.objectStore(PROJECT_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Kütüphane işlemi başarısız."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("Kütüphane işlemi başarısız."));
  });
}

export async function listLibraryProjects() {
  const values = await runTransaction<unknown[]>("readonly", (store) => store.getAll());
  return values
    .map((value) => researchProjectSchema.safeParse(value))
    .filter((result) => result.success)
    .map((result) => result.data)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveLibraryProject(project: ResearchProject) {
  const validated = researchProjectSchema.parse(project);
  await runTransaction<IDBValidKey>("readwrite", (store) => store.put(validated));
}

export async function deleteLibraryProject(projectId: string) {
  await runTransaction<undefined>("readwrite", (store) => store.delete(projectId));
}
