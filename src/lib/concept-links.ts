import type { ResearchProject } from "./schema";
import { foldForSearch } from "./search-text";
import type { StudyProgress } from "./study-path";

/**
 * Makaleler arası kavram bağları.
 *
 * Kütüphanedeki her makale kendi ön bilgisini ve sözlüğünü taşıyor; aynı
 * kavram (softmax, katman normalizasyonu) birçoğunda yeniden anlatılıyor.
 * Okuyucu onu bir makalede çalıştıysa yeni makalede "bunu şurada çalıştın"
 * demek, tekrar okumayı kısaltıyor ve iki makaleyi birbirine bağlıyor.
 * Henüz çalışmadığı kavramlar için de makalenin kaynakları arasında o kavramı
 * adıyla anan çalışmalar öneriliyor.
 *
 * Model yok: kavramlar ADLA eşleşiyor (katlanmış yazım; "Ad (KISALTMA)" iki
 * yazım; -isation/-ization ve çoğul eki farkı yok sayılıyor). Bu yüzden eşleşme
 * tutucu: farklı adlarla anlatılan aynı kavramı kaçırabilir, ama olmayan bir
 * bağı uydurmaz. Kullanıcının çalışma ilerlemesi projede değil kütüphanede
 * duruyor; bu modül de onu yalnızca okuyor.
 */

export type ConceptSource = {
  projectId: string;
  /** `paperKey`: aynı makalenin analizleri aynı anahtarı taşıyor. */
  paper: string;
  paperTitle: string;
  year?: string;
  kind: "primer" | "glossary";
  conceptId?: string;
  term: string;
  definition: string;
};

export type ConceptKnowledge = {
  /** Çalışma yolunda bu kavramın adımı bitti ya da tekrar kartı var. */
  studied: boolean;
  /** Tekrar kutusu (0–5): büyüdükçe daha kalıcı hatırlanıyor. */
  box?: number;
};

export type LinkedSource = ConceptSource & { knowledge?: ConceptKnowledge };

export type ConceptLink = {
  conceptId: string;
  term: string;
  here?: ConceptKnowledge;
  /** Aynı kavram kütüphanedeki başka makalelerde; çalışılmış olanlar önce. */
  elsewhere: LinkedSource[];
  /** Okuyucunun onu çalıştığı başka bir makale, varsa en iyi hatırlanan. */
  studiedIn?: LinkedSource;
};

/** Karşılaştırma biçimi: katlanmış, tireler boşluk, İngiliz yazımı ve çoğul eki eşitlenmiş. */
export function normalizePhrase(text: string) {
  return foldForSearch(text)
    .replace(/[-‐‑‒–—_/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    // "images" → "image", "normalisation" → "normalization"; "loss" ve "class" olduğu gibi kalıyor.
    .map((word) => word.replace(/isations?$/, (ending) => ending.replace("is", "iz")).replace(/(?<=\p{L}{3})(?<!s)s$/u, ""))
    .join(" ");
}

const bareDoi = (value: string | undefined) => value?.trim().toLowerCase().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)/, "") || undefined;

/**
 * Bir makalenin kimliği: DOI'si, yoksa katlanmış başlığı. Aynı makalenin iki
 * analizi (başka bir dilde, başka bir modelle) iki makale değil; yoksa her
 * kavramı kendi kopyasıyla "paylaşılmış" görünürdü.
 */
export function paperKey(project: ResearchProject) {
  const doi = bareDoi(project.evidence.paper.doi);
  return doi ? `doi:${doi}` : `title:${normalizePhrase(project.evidence.paper.title)}`;
}

/** Baştaki artikel bir kavramın adı değil: "The sequential computation bottleneck". */
const withoutArticle = (phrase: string) => phrase.replace(/^(?:the|a|an)\s+/, "");

function spellingsOf(term: string) {
  const match = term.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  return match ? [match[1], match[2]] : [term];
}

/** Bir terimin yazımları: "Layer normalization (LayerNorm)" → iki anahtar. */
export function conceptKeys(term: string) {
  return [...new Set(spellingsOf(term).map((spelling) => withoutArticle(normalizePhrase(spelling))).filter((key) => key.replace(/\s/g, "").length >= 3))];
}

function sources(project: ResearchProject): ConceptSource[] {
  const base = { projectId: project.id, paper: paperKey(project), paperTitle: project.evidence.paper.title, year: project.evidence.paper.year };
  return [
    ...(project.primer?.concepts ?? []).map((concept) => ({ ...base, kind: "primer" as const, conceptId: concept.id, term: concept.term, definition: concept.intuition })),
    ...project.evidence.glossary.map((item) => ({ ...base, kind: "glossary" as const, term: item.term, definition: item.definition })),
  ];
}

/** Anahtar → o kavramı anlatan kaynaklar, bütün kütüphane boyunca. */
export function libraryConceptIndex(library: readonly ResearchProject[]) {
  const index = new Map<string, ConceptSource[]>();
  for (const project of library) {
    for (const source of sources(project)) {
      for (const key of conceptKeys(source.term)) index.set(key, [...(index.get(key) ?? []), source]);
    }
  }
  return index;
}

export function conceptKnowledge(progress: StudyProgress | undefined, conceptId: string | undefined): ConceptKnowledge | undefined {
  if (!progress || !conceptId) return undefined;
  const review = progress.reviews?.find((item) => item.id === `c:${conceptId}`);
  const studied = Boolean(review) || progress.done.includes(`concept:${conceptId}`);
  return studied ? { studied, ...(review ? { box: review.box } : {}) } : undefined;
}

/** Bir makale için tek kaynak: çalışılmış olan, sonra ön bilgi (çalışılabilen o), sonra sözlük. */
const rank = (source: LinkedSource) => (source.knowledge?.studied ? 4 : 0) + (source.knowledge?.box ?? 0) / 10 + (source.kind === "primer" ? 1 : 0);

/** Kaynakları makaleye göre tekilleştiriyor: aynı makalenin analizleri ve aynı makaledeki iki yazım bir kez. */
function onePerPaper(list: Iterable<ConceptSource>, study: ReadonlyMap<string, StudyProgress>) {
  const byPaper = new Map<string, LinkedSource>();
  for (const source of list) {
    const linked = { ...source, knowledge: conceptKnowledge(study.get(source.projectId), source.conceptId) };
    const existing = byPaper.get(source.paper);
    if (!existing || rank(linked) > rank(existing)) byPaper.set(source.paper, linked);
  }
  return byPaper;
}

/**
 * Projenin ön bilgi kavramlarının kütüphanedeki karşılıkları. Aynı makale
 * bir kavramı hem ön bilgide hem sözlükte taşıyabiliyor, ve aynı makale
 * kütüphanede birden çok analizle bulunabiliyor; her makale bir kez sayılıyor.
 * Bu makalenin başka analizleri "başka bir makale" değil.
 */
export function conceptLinks(
  project: ResearchProject,
  library: readonly ResearchProject[],
  study: ReadonlyMap<string, StudyProgress>,
): ConceptLink[] {
  const own = paperKey(project);
  const index = libraryConceptIndex(library.filter((item) => item.id !== project.id && paperKey(item) !== own));
  return (project.primer?.concepts ?? []).map((concept) => {
    const found = onePerPaper(conceptKeys(concept.term).flatMap((key) => index.get(key) ?? []), study);
    const elsewhere = [...found.values()].sort(
      (left, right) =>
        Number(Boolean(right.knowledge?.studied)) - Number(Boolean(left.knowledge?.studied)) ||
        (right.knowledge?.box ?? -1) - (left.knowledge?.box ?? -1) ||
        Number(right.kind === "primer") - Number(left.kind === "primer") ||
        left.paperTitle.localeCompare(right.paperTitle),
    );
    return {
      conceptId: concept.id,
      term: concept.term,
      here: conceptKnowledge(study.get(project.id), concept.id),
      elsewhere,
      studiedIn: elsewhere.find((source) => source.knowledge?.studied),
    };
  });
}

export type SharedConcept = { key: string; term: string; sources: LinkedSource[]; papers: number; studied: boolean };

/**
 * Kütüphanenin kavram haritası: en az iki makalede anlatılan kavramlar, en
 * çok makaleyi bağlayan önce. Her makale, kaç analizi olursa olsun, bir kez
 * sayılıyor.
 */
export function sharedConcepts(library: readonly ResearchProject[], study: ReadonlyMap<string, StudyProgress>): SharedConcept[] {
  const index = libraryConceptIndex(library);
  const seen = new Set<string>();
  const shared: SharedConcept[] = [];
  for (const [key, list] of index) {
    const byPaper = onePerPaper(list, study);
    if (byPaper.size < 2) continue;
    // "Ad (KISALTMA)" iki anahtar üretiyor; aynı makale kümesi bir kez listeleniyor.
    const signature = [...byPaper.values()].map((source) => `${source.projectId}:${source.term}`).sort().join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    const sources = [...byPaper.values()].sort((left, right) => left.paperTitle.localeCompare(right.paperTitle));
    const term = sources.find((source) => source.kind === "primer")?.term ?? sources[0].term;
    shared.push({ key, term, sources, papers: sources.length, studied: sources.some((source) => source.knowledge?.studied) });
  }
  return shared.sort((left, right) => right.papers - left.papers || left.term.localeCompare(right.term));
}

export type ReferenceWork = { title: string; year?: number; identifier?: string; pdfAvailable?: boolean; url?: string; citationCount?: number };
export type ReferenceSuggestion = { conceptId: string; term: string; phrase: string; reference: ReferenceWork };

/**
 * Önerilen çalışma kütüphanede zaten var mı: DOI ya da katlanmış başlık aynı.
 * Varsa okuyucuya "analiz et" değil "aç" deniyor; aynı makale iki kez
 * analiz edilmiyor.
 */
export function libraryPaperFor(reference: ReferenceWork, library: readonly ResearchProject[]) {
  const title = normalizePhrase(reference.title);
  const doi = bareDoi(reference.identifier);
  return library.find((project) => {
    const own = bareDoi(project.evidence.paper.doi);
    return (own !== undefined && own === doi) || normalizePhrase(project.evidence.paper.title) === title;
  });
}

/**
 * Bir kavramın başlıkta aranacak parçaları. "Residual connections and layer
 * normalisation" iki parça; tek kelimelik bir parça en az beş harf olmalı,
 * yoksa "the", "RNN" gibi her başlıkta geçen sözcükler eşleşirdi.
 */
export function conceptPhrases(term: string) {
  return [
    ...new Set(
      spellingsOf(term).flatMap((spelling) => {
        const parts = spelling.split(/\s*(?:,|&|\band\b|\bve\b|\bund\b|\bet\b)\s*/i).map((part) => withoutArticle(normalizePhrase(part))).filter(Boolean);
        // Tek kelimelik bir kavram ("Softmax") kendisi aranıyor; birleşik bir terimin
        // tek kelimelik parçası ("scale") her başlıkta geçebileceği için aranmıyor.
        if (parts.length === 1) return parts[0].includes(" ") || parts[0].length >= 5 ? parts : [];
        return parts.filter((part) => part.includes(" "));
      }),
    ),
  ];
}

/**
 * Henüz çalışılmamış kavramlar için makalenin kaynaklarından öneri: başlığı
 * kavramın bir parçasını bütün kelimelerle anan çalışma. Kavram başına en çok
 * atıf alan iki çalışma.
 */
export function suggestReferences(links: readonly ConceptLink[], references: readonly ReferenceWork[]): ReferenceSuggestion[] {
  const titles = references.map((reference) => ({ reference, title: ` ${normalizePhrase(reference.title)} ` }));
  const suggestions: ReferenceSuggestion[] = [];
  for (const link of links) {
    if (link.here?.studied || link.studiedIn) continue;
    const matches: ReferenceSuggestion[] = [];
    for (const phrase of conceptPhrases(link.term)) {
      for (const { reference, title } of titles) {
        if (title.includes(` ${phrase} `) && !matches.some((item) => item.reference.title === reference.title)) {
          matches.push({ conceptId: link.conceptId, term: link.term, phrase, reference });
        }
      }
    }
    suggestions.push(...matches.sort((left, right) => (right.reference.citationCount ?? 0) - (left.reference.citationCount ?? 0)).slice(0, 2));
  }
  return suggestions;
}
