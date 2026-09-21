import { evidenceHealth, type EvidenceHealth } from "./evidence-health";
import { foldForSearch } from "./search-text";
import type { Claim, ResearchProject } from "./schema";

/**
 * İki makaleyi yan yana koymak.
 *
 * Burada YAPILMAYAN şey önemli: Trace iki makalenin çeliştiğine karar
 * vermiyor. Böyle bir yargı kanıta değil yoruma dayanır ve ürünün tek kuralı
 * her cümlenin bir sayfaya bağlı olması. Yapılan şey hizalamak — aynı ölçütü
 * ölçen iki sayı, aynı terimi farklı tanımlayan iki sözlük girdisi — ve kararı
 * okuyucuya, iki kaynağı da göstererek bırakmak.
 *
 * Hesap tamamen iki `.trace.json` dosyasından çıkıyor: model çağrısı yok,
 * ağ yok, yeni alan yok. Daha önce üretilmiş her proje karşılaştırılabilir.
 */

export type MetricSide = {
  projectId: string;
  label: string;
  displayValue: string;
  value: number;
  unit: string;
  context: string;
  page?: number;
};

export type SharedMetric = {
  key: string;
  label: string;
  unit: string;
  left: MetricSide;
  right: MetricSide;
  /** `right.value - left.value`; birimler aynı değilse tanımsız. */
  difference?: number;
};

export type SharedTerm = {
  term: string;
  left: string;
  right: string;
  /** Tanımlar kelimesi kelimesine aynı mı — değilse okumaya değer. */
  identical: boolean;
};

export type ClaimMix = Record<Claim["kind"], number>;

export type ProjectSummary = {
  id: string;
  title: string;
  authors: string[];
  year: string;
  venue: string;
  language: string;
  depth: ResearchProject["depth"];
  thesis: string;
  health: EvidenceHealth;
  claimMix: ClaimMix;
  findings: string[];
  limitations: string[];
};

export type ProjectComparison = {
  left: ProjectSummary;
  right: ProjectSummary;
  sharedMetrics: SharedMetric[];
  sharedTerms: SharedTerm[];
  /** Yalnızca bir tarafta tanımlanan terimler; kapsam farkını gösterir. */
  onlyLeftTerms: string[];
  onlyRightTerms: string[];
};

const CLAIM_KINDS: Claim["kind"][] = [
  "reported-result",
  "author-interpretation",
  "method",
  "background",
  "limitation",
];

/**
 * Eşleştirme anahtarı. Etiketler ("BLEU", "BLEU score", "bleu") elle
 * yazılmış metin; noktalama ve boşluk atılıyor, harf dönüşümü ise dile
 * duyarsız `foldForSearch` ile yapılıyor — Türkçe yerelinde "I" harfi
 * "ı"ya düşüyor ve İngilizce etiketler birbirini bulamıyordu.
 */
export function metricKey(label: string, unit: string) {
  const normalize = (value: string) => foldForSearch(value).replace(/[^a-z0-9]+/g, "");
  return `${normalize(label)}|${normalize(unit)}`;
}

export function summarize(project: ResearchProject): ProjectSummary {
  const claimMix = Object.fromEntries(CLAIM_KINDS.map((kind) => [kind, 0])) as ClaimMix;
  for (const claim of project.evidence.claims) claimMix[claim.kind] += 1;

  return {
    id: project.id,
    title: project.evidence.paper.title,
    authors: project.evidence.paper.authors,
    year: project.evidence.paper.year,
    venue: project.evidence.paper.venue,
    language: project.language,
    depth: project.depth,
    thesis: project.evidence.thesis,
    health: evidenceHealth(project),
    claimMix,
    findings: project.evidence.findings,
    limitations: project.evidence.limitations,
  };
}

export function compareProjects(left: ResearchProject, right: ResearchProject): ProjectComparison {
  const sharedMetrics: SharedMetric[] = [];
  const rightMetrics = new Map(
    right.evidence.metrics.map((metric) => [metricKey(metric.label, metric.unit), metric]),
  );

  for (const metric of left.evidence.metrics) {
    const key = metricKey(metric.label, metric.unit);
    const match = rightMetrics.get(key);
    if (!match) continue;
    // Aynı ölçüt iki kez listelenmişse ilk eşleşme kullanılıyor ve tüketiliyor;
    // aksi hâlde tek bir sağ metrik birden çok sol metriğe eşlenirdi.
    rightMetrics.delete(key);
    sharedMetrics.push({
      key,
      label: metric.label,
      unit: metric.unit,
      left: {
        projectId: left.id,
        label: metric.label,
        displayValue: metric.displayValue,
        value: metric.value,
        unit: metric.unit,
        context: metric.context,
        page: metric.sourceRef.page,
      },
      right: {
        projectId: right.id,
        label: match.label,
        displayValue: match.displayValue,
        value: match.value,
        unit: match.unit,
        context: match.context,
        page: match.sourceRef.page,
      },
      difference: match.value - metric.value,
    });
  }

  const leftTerms = new Map(left.evidence.glossary.map((item) => [foldForSearch(item.term), item]));
  const rightTerms = new Map(right.evidence.glossary.map((item) => [foldForSearch(item.term), item]));
  const sharedTerms: SharedTerm[] = [];
  for (const [key, item] of leftTerms) {
    const match = rightTerms.get(key);
    if (!match) continue;
    sharedTerms.push({
      term: item.term,
      left: item.definition,
      right: match.definition,
      identical: item.definition.trim() === match.definition.trim(),
    });
  }

  return {
    left: summarize(left),
    right: summarize(right),
    sharedMetrics,
    sharedTerms,
    onlyLeftTerms: [...leftTerms].filter(([key]) => !rightTerms.has(key)).map(([, item]) => item.term),
    onlyRightTerms: [...rightTerms].filter(([key]) => !leftTerms.has(key)).map(([, item]) => item.term),
  };
}

/**
 * Farkı okunabilir kıl.
 *
 * Ölçütler BLEU'da 0.9, FLOP'ta 10^18 mertebesinde geliyor. Ham fark
 * yazıldığında "-231000000000000000" karta sığmıyor ve zaten kimseye bir şey
 * anlatmıyor; büyük sayılar kısaltılıyor, küçükler tam kalıyor — çünkü
 * BLEU'da 0.9 ile 1.9 arasındaki fark tam olarak okunması gereken şey.
 */
export function formatDifference(difference: number): string {
  if (!Number.isFinite(difference) || difference === 0) return "equal";
  const sign = difference > 0 ? "+" : "";
  if (Math.abs(difference) >= 10_000) {
    return sign + new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(difference);
  }
  return sign + String(Number(difference.toFixed(4)));
}
