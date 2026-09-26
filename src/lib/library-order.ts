import type { ResearchProject } from "./schema";

/**
 * Kütüphanenin sırası ve yerleşimi.
 *
 * Kartlar yüksek: geniş bir ekrana bile iki makale sığıyordu ve sıra yalnızca
 * "en son güncellenen" olabiliyordu. Liste görünümü aynı kartları tek satıra
 * indiriyor; sıralama başlığa ya da makalenin yılına göre de yapılabiliyor.
 * İkisi de bu tarayıcıya ait birer kolaylık.
 */
export const librarySorts = [
  { id: "updated", label: "Recently updated" },
  { id: "title", label: "Title A–Z" },
  { id: "newest", label: "Newest paper first" },
  { id: "oldest", label: "Oldest paper first" },
] as const;

export type LibrarySort = (typeof librarySorts)[number]["id"];
export type LibraryLayout = "grid" | "list";

export const LIBRARY_SORT_KEY = "trace-library-sort";
export const LIBRARY_LAYOUT_KEY = "trace-library-layout";

export function parseLibrarySort(value: unknown): LibrarySort {
  return librarySorts.some((sort) => sort.id === value) ? (value as LibrarySort) : "updated";
}

export function parseLibraryLayout(value: unknown): LibraryLayout {
  return value === "list" ? "list" : "grid";
}

/** Makalenin yılı; "2017", "NeurIPS 2017" ya da "2017a" gibi yazılışlardan. Yoksa undefined. */
export function paperYear(project: ResearchProject) {
  const match = project.evidence.paper.year.match(/(?<!\d)(1[5-9]\d\d|20\d\d)(?!\d)/);
  return match ? Number(match[1]) : undefined;
}

const titles = new Intl.Collator("en", { sensitivity: "base", numeric: true, ignorePunctuation: true });
const recent = (left: ResearchProject, right: ResearchProject) => right.updatedAt.localeCompare(left.updatedAt);

/** Yılı olmayan makaleler iki yıl sıralamasında da sona gidiyor; eşitlikte en son güncellenen önde. */
export function sortLibrary(projects: readonly ResearchProject[], sort: LibrarySort): ResearchProject[] {
  const byYear = (direction: 1 | -1) => (left: ResearchProject, right: ResearchProject) => {
    const [a, b] = [paperYear(left), paperYear(right)];
    if (a === undefined || b === undefined) return (a === undefined ? 1 : 0) - (b === undefined ? 1 : 0) || recent(left, right);
    return direction * (a - b) || recent(left, right);
  };
  const compare = {
    updated: recent,
    title: (left: ResearchProject, right: ResearchProject) =>
      titles.compare(left.evidence.paper.title, right.evidence.paper.title) || recent(left, right),
    newest: byYear(-1),
    oldest: byYear(1),
  }[sort];
  return [...projects].sort(compare);
}

export function readStored<Value>(key: string, parse: (value: unknown) => Value): Value {
  try {
    return parse(window.localStorage.getItem(key));
  } catch {
    return parse(undefined);
  }
}

export function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Depolama kapalı: seçim bu sayfada kalır.
  }
}
