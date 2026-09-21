import type { EvidencePassId } from "./evidence-pipeline";
import type { Claim, ExcerptCheck, PaperEvidence, ResearchProject } from "./schema";

/**
 * Makalenin sayfa metni — PDF'i göremeyen modeller için.
 *
 * Yerel sunucuların dosya yükleme uçnoktası yok ve açık ağırlıklı modellerin
 * çoğu bir belgeyi hiç göremiyor. Onlara makale, sayfa sınırları korunmuş düz
 * metin olarak veriliyor: `--- PAGE n ---` işaretleri kanıt zincirinin
 * dayandığı "görünen PDF sayfası" numarasını taşıyor.
 *
 * İki şey bu yolu dürüst tutuyor:
 *   1. Bağlam penceresine sığmayan makalede hangi sayfaların verildiği ve
 *      hangilerinin dışarıda kaldığı modele AÇIKÇA söyleniyor; model görmediği
 *      sayfaya atıf yapamıyor.
 *   2. Metin elimizde olduğu için her alıntı mekanik olarak aranıyor. Sayfasında
 *      bulunamayan alıntıya dayanan iddia "verified" kalamıyor.
 */

/** ~15 bin belirteç. Çoğu 8B modelin 32K penceresinde istem ve cevaba yer kalıyor. */
export const DEFAULT_PAPER_TEXT_BUDGET = 60_000;
const MIN_PAPER_TEXT_BUDGET = 8_000;

export function paperTextBudget(raw = process.env.TRACE_LOCAL_PAPER_CHARS): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= MIN_PAPER_TEXT_BUDGET ? Math.floor(value) : DEFAULT_PAPER_TEXT_BUDGET;
}

/** `pdftotext` sayfaları form-feed ile ayırıyor; sondaki boş parça sayfa değildir. */
export function splitPages(raw: string): string[] {
  const pages = raw.split("\f").map((page) => page.replace(/[ \t]+$/gm, "").trimEnd());
  while (pages.length && !pages[pages.length - 1].trim()) pages.pop();
  return pages;
}

const passKeywords: Record<EvidencePassId, RegExp> = {
  overview: /\b(abstract|introduction|we propose|we present|contribution|conclusion|in this (?:paper|work))\b/gi,
  methods: /\b(method|approach|architecture|model|algorithm|training|dataset|implementation|hyperparameter|setup|procedure|optimi[sz]er)\b/gi,
  results: /\b(result|experiment|evaluation|table|figure|baseline|outperform|accuracy|score|benchmark|ablation|%)\b/gi,
  limitations: /\b(limitation|future work|discussion|conclusion|however|fail|assum|scope|cost|trade-?off|caveat|threat)\b/gi,
};

/** Kaynakça sayfası: çok sayıda "[12]" ya da "(2019)" ile başlayan/biten kısa satır. */
function looksLikeReferences(page: string) {
  const lines = page.split("\n").filter((line) => line.trim());
  if (lines.length < 8) return false;
  const marked = lines.filter((line) => /^\s*\[\d+\]|\b(19|20)\d{2}[a-z]?\.\s*$|arXiv preprint|In Proceedings of/i.test(line)).length;
  return marked / lines.length > 0.22;
}

/**
 * Bütçeye sığmayan makalede bu aşama için en değerli sayfaları seçer.
 *
 * Puan iki şeyden oluşuyor: aşamanın anahtar kelimeleri (İngilizce makalede
 * işe yarar) ve konum (her dilde işe yarar — giriş başta, sonuçlar ikinci
 * yarıda, sınırlılıklar sonda). Kaynakça sayfaları en sona kalır. İlk sayfa
 * her zaman verilir: başlık, yazarlar ve özet orada.
 */
export function selectPagesForPass(pages: string[], passId: EvidencePassId, budget = paperTextBudget()) {
  const total = pages.reduce((sum, page) => sum + page.length, 0);
  const all = pages.map((_, index) => index + 1);
  if (total <= budget) return { included: all, omitted: [] as number[] };

  const last = Math.max(pages.length - 1, 1);
  const scored = pages.map((page, index) => {
    const position = index / last;
    const prior = {
      overview: position < 0.2 ? 3 : position > 0.85 ? 1.5 : 0,
      methods: position >= 0.1 && position <= 0.6 ? 2 : 0,
      results: position >= 0.35 && position <= 0.9 ? 2 : 0,
      limitations: position >= 0.6 ? 2.5 : 0,
    }[passId];
    const hits = (page.match(passKeywords[passId]) ?? []).length;
    const density = hits / Math.max(page.length / 1_000, 1);
    return { number: index + 1, length: page.length, score: prior + Math.min(density, 6) - (looksLikeReferences(page) ? 8 : 0) };
  });

  const included = new Set<number>([1]);
  let used = pages[0]?.length ?? 0;
  for (const candidate of [...scored].sort((a, b) => b.score - a.score || a.number - b.number)) {
    if (included.has(candidate.number)) continue;
    if (used + candidate.length > budget) continue;
    included.add(candidate.number);
    used += candidate.length;
  }
  return {
    included: all.filter((number) => included.has(number)),
    omitted: all.filter((number) => !included.has(number)),
  };
}

/** Modele giden blok. Sayfa işaretleri kanıt referanslarındaki `page` değeridir. */
export function renderPaperText(pages: string[], passId: EvidencePassId, budget = paperTextBudget()) {
  const { included, omitted } = selectPagesForPass(pages, passId, budget);
  const body = included.map((number) => `--- PAGE ${number} ---\n${pages[number - 1].slice(0, budget)}`).join("\n\n");
  const omission = omitted.length
    ? `\nPages ${omitted.join(", ")} were left out to fit the context window. Never cite a page that is not shown below, and do not guess what it contains.`
    : "";
  return {
    included,
    omitted,
    text: `THE PAPER (${pages.length} pages) is supplied below as text extracted from the PDF, in place of an attachment. Each "--- PAGE n ---" marker is the visible PDF page index to use in source references. Copy excerpts character for character from this text. Layout, figures and some equations are lost in extraction; do not describe a figure you cannot see.${omission}\n\n${body}`,
  };
}

/** Karşılaştırma için: ligatürler, tırnaklar, satır sonu tirelemesi ve boşluklar eşitlenir. */
export function normalizeForMatch(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Alıntı belirtilen sayfada (ya da sayfa kırılımına denk geldiyse komşusunda)
 * geçiyor mu? Model alıntıyı "…" ile kısaltmış olabilir; o zaman her parça aranır.
 */
export function excerptIsOnPage(pages: string[], page: number | undefined, excerpt: string) {
  if (!page || page < 1 || page > pages.length) return false;
  const window = normalizeForMatch([pages[page - 2], pages[page - 1], pages[page]].filter(Boolean).join("\n"));
  const fragments = normalizeForMatch(excerpt)
    .split(/\s*(?:\.{3}|…|\[\.{3}\])\s*/)
    .filter((fragment) => lettersOnly(fragment).length >= MIN_FRAGMENT_LETTERS);
  if (!fragments.length) return false;
  /**
   * İkinci deneme yalnızca harf ve rakamlara bakıyor. PDF'i GÖREN bir model
   * alıntıyı sayfadaki görüntüden yazıyor; `pdftotext` ise aynı satırı farklı
   * boşluk, tire ve noktalama ile çıkarabiliyor (sütunlar, satır sonu tiresi,
   * üst simgeler). Kelimeler ve sıraları aynıysa alıntı oradadır.
   */
  const compactWindow = lettersOnly(window);
  return fragments.every((fragment) => window.includes(fragment) || compactWindow.includes(lettersOnly(fragment)));
}

const MIN_FRAGMENT_LETTERS = 10;
const lettersOnly = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Alıntısı sayfasında bulunamayan iddia "verified" kalamaz.
 *
 * İddia SİLİNMİYOR: çıkarma hatası da olabilir (tablo, formül, taranmış sayfa)
 * ve kullanıcı PDF'e bakıp kendisi karar verebilmeli. Yalnızca güven düşüyor.
 */
export function downgradeUnlocatedClaims<Output extends { claims: Claim[] }>(
  output: Output,
  pages: string[],
  paperSourceIds: ReadonlySet<string> = new Set(["paper"]),
) {
  let downgraded = 0;
  const claims = output.claims.map((claim) => {
    if (claim.confidence !== "verified") return claim;
    const paperRefs = claim.sourceRefs.filter((reference) => paperSourceIds.has(reference.sourceId));
    if (!paperRefs.length) return claim;
    if (paperRefs.some((reference) => excerptIsOnPage(pages, reference.page, reference.excerpt))) return claim;
    downgraded += 1;
    return { ...claim, confidence: "needs-review" as const };
  });
  return { output: { ...output, claims }, downgraded };
}

/**
 * Bütün projenin alıntı denetimi: iddialar, metrikler ve sözlük.
 *
 * Yalnızca makaleye yapılan atıflar aranır; web kaynaklarının metni elimizde
 * değil. Sonuç projeye yazılır, böylece paylaşılan bir `.trace.json` denetimin
 * yapıldığını ve neyin bulunamadığını PDF olmadan da gösterebilir.
 */
export function checkExcerpts(evidence: PaperEvidence, pages: string[], checkedAt = new Date().toISOString()): ExcerptCheck {
  const paperSources = new Set(evidence.sources.filter((source) => source.type === "paper").map((source) => source.id));
  const unlocated: ExcerptCheck["unlocated"] = [];
  let checked = 0;
  const look = (owner: ExcerptCheck["unlocated"][number]["owner"], id: string, reference?: { sourceId: string; page?: number; excerpt: string }) => {
    if (!reference || !paperSources.has(reference.sourceId)) return;
    checked += 1;
    if (!excerptIsOnPage(pages, reference.page, reference.excerpt)) unlocated.push({ owner, id, page: reference.page });
  };
  for (const claim of evidence.claims) for (const reference of claim.sourceRefs) look("claim", claim.id, reference);
  for (const metric of evidence.metrics) look("metric", metric.id, metric.sourceRef);
  for (const item of evidence.glossary) look("glossary", item.term, item.sourceRef);
  return { checkedAt, method: "pdftotext", pageCount: Math.max(pages.length, 1), checked, unlocated: unlocated.slice(0, 400) };
}

/**
 * Denetimi projeye işler: kayıt yazılır ve makaledeki alıntılarının HİÇBİRİ
 * bulunamayan "verified" iddialar "needs-review" olur. Hiçbir şey yükseltilmez —
 * bir program alıntının orada olduğunu söyleyebilir, iddiayı desteklediğini değil.
 */
export function applyExcerptCheck<Project extends Pick<ResearchProject, "evidence">>(project: Project, pages: string[]) {
  const paperSourceIds = new Set(project.evidence.sources.filter((source) => source.type === "paper").map((source) => source.id));
  const { output, downgraded } = downgradeUnlocatedClaims(project.evidence, pages, paperSourceIds);
  const before = new Map(project.evidence.claims.map((claim) => [claim.id, claim.confidence]));
  return {
    project: { ...project, evidence: output, excerptCheck: checkExcerpts(output, pages) },
    downgraded,
    downgradedIds: output.claims.filter((claim) => claim.confidence !== before.get(claim.id)).map((claim) => claim.id),
  };
}
