import { metricKey, summarize, type MetricSide, type ProjectSummary } from "./compare-projects";
import { foldForSearch } from "./search-text";
import type { ResearchProject } from "./schema";

/**
 * İkiden fazla makaleyi bir zaman çizgisine dizmek.
 *
 * İkili karşılaştırmanın kuralı burada da geçerli: Trace hangi makalenin
 * haklı ya da daha iyi olduğunu SÖYLEMİYOR. Aynı ölçütü bildiren makaleleri
 * yıl sırasına koyuyor, aynı terimin farklı tanımlarını yan yana gösteriyor
 * ve her sayının geldiği sayfayı yazıyor. Bir ölçütün yıllar içinde "artmış"
 * görünmesi ilerleme demek değildir — veri kümesi, ölçüm koşulu ya da
 * ölçütün yönü farklı olabilir; o hüküm okuyucunun.
 *
 * Hesap yalnızca `.trace.json` dosyalarından çıkıyor: model yok, ağ yok.
 */

export const MAX_MAP_PAPERS = 6;

export type MapPaper = ProjectSummary & {
  /** Yıl sırasına göre verilen harf; ekranın her yerinde makaleyi bu temsil eder. */
  letter: string;
  /** Sayıya çevrilebilen yıl; çevrilemiyorsa tanımsız ve makale sona gider. */
  yearNumber?: number;
};

export type TrackedMetricPoint = MetricSide & { letter: string; yearNumber?: number };

export type TrackedMetric = {
  key: string;
  label: string;
  unit: string;
  /** Makalelerin yıl sırasıyla; makale başına en çok bir nokta. */
  points: TrackedMetricPoint[];
};

export type TrackedTerm = {
  term: string;
  definitions: Array<{ letter: string; projectId: string; definition: string }>;
  /** Bütün tanımlar kelimesi kelimesine aynı mı — değilse okumaya değer. */
  identical: boolean;
};

export type LiteratureMap = {
  papers: MapPaper[];
  metrics: TrackedMetric[];
  terms: TrackedTerm[];
  /** Birden çok dil varsa etiketler eşleşmez; ekran bunu söylemeli. */
  languages: string[];
};

function parseYear(value: string): number | undefined {
  const match = /\b(1[89]\d{2}|20\d{2})\b/.exec(value);
  return match ? Number(match[1]) : undefined;
}

export function buildLiteratureMap(projects: ResearchProject[]): LiteratureMap {
  const unique = projects.filter((project, index) => projects.findIndex((item) => item.id === project.id) === index);
  const ordered = unique
    .slice(0, MAX_MAP_PAPERS)
    .map((project, index) => ({ project, index, yearNumber: parseYear(project.evidence.paper.year) }))
    // Yılı okunamayan makale sona; eşit yıllarda seçim sırası korunur.
    .sort((a, b) => (a.yearNumber ?? Infinity) - (b.yearNumber ?? Infinity) || a.index - b.index);

  const papers: MapPaper[] = ordered.map(({ project, yearNumber }, position) => ({
    ...summarize(project),
    letter: String.fromCharCode(65 + position),
    yearNumber,
  }));

  const metrics = new Map<string, TrackedMetric>();
  const terms = new Map<string, TrackedTerm>();
  ordered.forEach(({ project }, position) => {
    const paper = papers[position];
    const seenMetrics = new Set<string>();
    for (const metric of project.evidence.metrics) {
      const key = metricKey(metric.label, metric.unit);
      // Aynı ölçüt bir makalede iki kez geçiyorsa ilki alınır; ikili karşılaştırmayla aynı kural.
      if (seenMetrics.has(key)) continue;
      seenMetrics.add(key);
      const tracked = metrics.get(key) ?? { key, label: metric.label, unit: metric.unit, points: [] };
      tracked.points.push({
        projectId: project.id,
        letter: paper.letter,
        yearNumber: paper.yearNumber,
        label: metric.label,
        displayValue: metric.displayValue,
        value: metric.value,
        unit: metric.unit,
        context: metric.context,
        page: metric.sourceRef.page,
      });
      metrics.set(key, tracked);
    }

    const seenTerms = new Set<string>();
    for (const item of project.evidence.glossary) {
      const key = foldForSearch(item.term);
      if (seenTerms.has(key)) continue;
      seenTerms.add(key);
      const tracked = terms.get(key) ?? { term: item.term, definitions: [], identical: true };
      tracked.definitions.push({ letter: paper.letter, projectId: project.id, definition: item.definition });
      terms.set(key, tracked);
    }
  });

  return {
    papers,
    metrics: [...metrics.values()]
      .filter((metric) => metric.points.length >= 2)
      .sort((a, b) => b.points.length - a.points.length || a.label.localeCompare(b.label, "en")),
    terms: [...terms.values()]
      .filter((term) => term.definitions.length >= 2)
      .map((term) => ({
        ...term,
        identical: new Set(term.definitions.map((item) => item.definition.trim())).size === 1,
      }))
      .sort((a, b) => b.definitions.length - a.definitions.length || a.term.localeCompare(b.term, "en")),
    languages: [...new Set(papers.map((paper) => paper.language))],
  };
}
