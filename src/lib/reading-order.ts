import { canonicalKeys, paperKey, type ConceptAliases } from "./concept-links";
import { paperYear } from "./library-order";
import type { ResearchProject } from "./schema";
import type { StudyProgress } from "./study-path";

/**
 * Kütüphane için bir okuma sırası.
 *
 * Bir makalenin ön bilgisi (primer) onun VARSAYDIĞI kavramlar; sözlüğü ise
 * kullandığı ve tanımladığı terimler. A'nın sözlüğünde tanımladığı (ve kendisi
 * varsaymadığı) bir kavramı B varsayıyorsa, A'yı B'den önce okumak B'yi
 * kolaylaştırıyor: "B, A'nın tanımladığı çok başlı dikkati varsayıyor". İki
 * makale aynı kavramı varsayıyorsa ikisi de onu açıklıyor, yön yok.
 *
 * Model yok: kavramlar `concept-links.ts` gibi ADLA eşleşiyor. Okuma sırası bu
 * bağlardan bir topolojik sıra; bağ yönü belirlemediğinde yıl, sonra başlık.
 * İki makale birbirinin tanımladığını varsayıyorsa döngü var: ikisi "birlikte
 * okunacak" diye gösteriliyor, uydurma bir öncelik verilmiyor.
 */

export type StudyStatus = "finished" | "started" | "new";

export function studyStatus(progress: StudyProgress | undefined): StudyStatus {
  if (progress?.finishedAt) return "finished";
  if (progress && (progress.done.length || progress.answers.length)) return "started";
  return "new";
}

const statusWeight: Record<StudyStatus, number> = { finished: 2, started: 1, new: 0 };

/** Aynı makalenin analizlerinden biri temsilci: en çok çalışılmış, sonra en yeni. */
function representatives(library: readonly ResearchProject[], study: ReadonlyMap<string, StudyProgress>) {
  const byPaper = new Map<string, ResearchProject>();
  const weight = (project: ResearchProject) => statusWeight[studyStatus(study.get(project.id))];
  for (const project of library) {
    const key = paperKey(project);
    const current = byPaper.get(key);
    if (!current || weight(project) > weight(current) || (weight(project) === weight(current) && project.updatedAt > current.updatedAt)) {
      byPaper.set(key, project);
    }
  }
  return [...byPaper.values()];
}

/** Makalenin varsaydığı kavramlar: anahtar → ön bilgideki adı. */
function assumed(project: ResearchProject, aliases?: ConceptAliases) {
  const keys = new Map<string, string>();
  for (const concept of project.primer?.concepts ?? []) for (const key of canonicalKeys(concept.term, aliases)) keys.set(key, concept.term);
  return keys;
}

/** Makalenin tanımladığı ama kendisi varsaymadığı kavramlar: anahtar → sözlükteki adı. */
function defined(project: ResearchProject, aliases?: ConceptAliases) {
  const own = assumed(project, aliases);
  const keys = new Map<string, string>();
  for (const item of project.evidence.glossary) {
    const itemKeys = canonicalKeys(item.term, aliases);
    if (itemKeys.some((key) => own.has(key))) continue;
    for (const key of itemKeys) keys.set(key, item.term);
  }
  return keys;
}

export type DefinedConcept = {
  /** Okunacak makalenin (varsayan) adlandırışı. */
  term: string;
  /** Önce okunacak makalenin sözlüğündeki adı. */
  definedAs: string;
};

/** `to`'nun varsaydığı ve `from`'un tanımladığı kavramlar; aynı kavramın iki yazımı bir kez. */
function conceptsBetween(from: ResearchProject, to: ResearchProject, aliases?: ConceptAliases): DefinedConcept[] {
  const definitions = defined(from, aliases);
  const found = new Map<string, DefinedConcept>();
  for (const [key, term] of assumed(to, aliases)) {
    const definedAs = definitions.get(key);
    if (definedAs && !found.has(term)) found.set(term, { term, definedAs });
  }
  return [...found.values()];
}

const byYearThenTitle = (left: ResearchProject, right: ResearchProject) => {
  const [a, b] = [paperYear(left), paperYear(right)];
  return (a ?? Infinity) - (b ?? Infinity) || left.evidence.paper.title.localeCompare(right.evidence.paper.title);
};

export type ReadFirst = { project: ResearchProject; concepts: DefinedConcept[]; status: StudyStatus };

/**
 * Bu makaleden önce okunabilecek makaleler: varsaydığı kavramları sözlüğünde
 * tanımlayanlar, en çok kavramı karşılayan önce. Aynı makalenin başka
 * analizleri sayılmıyor.
 */
export function readFirst(
  project: ResearchProject,
  library: readonly ResearchProject[],
  study: ReadonlyMap<string, StudyProgress>,
  aliases?: ConceptAliases,
): ReadFirst[] {
  const own = paperKey(project);
  return representatives(library.filter((item) => paperKey(item) !== own), study)
    .map((from) => ({ project: from, concepts: conceptsBetween(from, project, aliases), status: studyStatus(study.get(from.id)) }))
    .filter((item) => item.concepts.length)
    .sort((left, right) => right.concepts.length - left.concepts.length || byYearThenTitle(left.project, right.project));
}

export type ReadingStep = {
  project: ResearchProject;
  status: StudyStatus;
  /** Önce gelen ve bu makalenin varsaydığını tanımlayan makaleler. */
  after: Array<{ project: ResearchProject; concepts: DefinedConcept[] }>;
  /** Döngü: birbirinin tanımladığını varsayan, birlikte okunacak makaleler. */
  together: ResearchProject[];
};

export type ReadingOrder = {
  steps: ReadingStep[];
  /** Sırada bitirilmemiş ilk makale. */
  next?: ResearchProject;
  /** Hiçbir bağı olmayan, sıraya girmeyen makale sayısı. */
  unconnected: number;
};

export function readingOrder(library: readonly ResearchProject[], study: ReadonlyMap<string, StudyProgress>, aliases?: ConceptAliases): ReadingOrder {
  const papers = representatives(library, study);
  const links = papers.flatMap((to) =>
    papers.filter((from) => from !== to).flatMap((from) => {
      const concepts = conceptsBetween(from, to, aliases);
      return concepts.length ? [{ from, to, concepts }] : [];
    }),
  );
  const connected = papers.filter((paper) => links.some((link) => link.from === paper || link.to === paper));
  const remaining = new Set(connected);
  const placed = new Set<ResearchProject>();
  const steps: ReadingStep[] = [];
  while (remaining.size) {
    const pending = [...remaining];
    const ready = pending.filter((paper) => !links.some((link) => link.to === paper && remaining.has(link.from))).sort(byYearThenTitle);
    // Hazır makale yoksa döngü var: en eskisi seçiliyor, döngüdeki eşleri "birlikte" diye işaretleniyor.
    const project = ready[0] ?? pending.sort(byYearThenTitle)[0];
    const together = ready.length
      ? []
      : links.filter((link) => link.to === project && remaining.has(link.from) && link.from !== project).map((link) => link.from);
    steps.push({
      project,
      status: studyStatus(study.get(project.id)),
      after: links.filter((link) => link.to === project && placed.has(link.from)).map((link) => ({ project: link.from, concepts: link.concepts })),
      together,
    });
    remaining.delete(project);
    placed.add(project);
  }
  return { steps, next: steps.find((step) => step.status !== "finished")?.project, unconnected: papers.length - connected.length };
}
