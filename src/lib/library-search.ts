import type { Claim, ClaimReview, ResearchProject, SourceReference } from "./schema";
import { foldForSearch } from "./search-text";

/**
 * Kütüphane genelinde iddia araması.
 *
 * "LayerNorm hakkında hangi makalem ne diyor?" sorusunun cevabı zaten
 * kütüphanede duruyor: her iddia sayfası ve alıntısıyla kayıtlı. Arama yalnızca
 * o kaydı okuyor. Model çağrılmıyor ve sonuç bir özet değil, iddianın kendisi.
 *
 * Her sonuç iddianın üç güven işaretini ayrı ayrı taşıyor: modelin beyanı
 * (`confidence`), alıntının sayfasında bulunup bulunmadığı (`excerptCheck`) ve
 * bir kişinin kararı (`claimReviews`). Reddedilmiş iddialar gizlenmiyor, çünkü
 * gizlemek neyin reddedildiğini de saklardı; ama listenin sonuna konuyor.
 */

export const MIN_TERM_LENGTH = 2;
export const DEFAULT_CLAIM_LIMIT = 60;

type IndexedClaim = {
  project: ResearchProject;
  claim: Claim;
  statement: string;
  excerpts: string[];
  quoteMissing: boolean;
  review?: ClaimReview;
};

export type ClaimIndex = readonly IndexedClaim[];

export type ClaimHit = {
  project: ResearchProject;
  claim: Claim;
  /** Gösterilecek alıntı: sorgunun en çok kelimesini içeren kaynak. */
  reference: SourceReference;
  quoteMissing: boolean;
  review?: ClaimReview;
};

export type ClaimSearch = {
  terms: string[];
  hits: ClaimHit[];
  /** Sınırlamadan önceki eşleşme sayısı ve bu eşleşmelerin dağıldığı makale sayısı. */
  total: number;
  papers: number;
};

/** Katlama bir kez yapılıyor; her tuş vuruşunda bütün kütüphaneyi yeniden katlamak gereksiz. */
export function buildClaimIndex(projects: readonly ResearchProject[]): ClaimIndex {
  return projects.flatMap((project) => {
    const unlocated = new Set(
      (project.excerptCheck?.unlocated ?? []).filter((item) => item.owner === "claim").map((item) => item.id),
    );
    const reviews = project.claimReviews ?? {};
    return project.evidence.claims.map((claim) => ({
      project,
      claim,
      statement: foldForSearch(claim.statement),
      excerpts: claim.sourceRefs.map((reference) => foldForSearch(reference.excerpt)),
      quoteMissing: unlocated.has(claim.id),
      review: Object.hasOwn(reviews, claim.id) ? reviews[claim.id] : undefined,
    }));
  });
}

/**
 * Sorgunun kelimeleri. Baştaki ve sondaki noktalama atılıyor: "(BLEU)" yazan
 * kullanıcı "BLEU score" geçen iddiayı bulmalı. İçteki noktalama kalıyor, yani
 * "d_k", "28.4" ve "self-attention" tek kelime. Tek harfli kelimeler yok
 * sayılıyor; "a" ya da "k" neredeyse her iddiada geçer ve vurguyu anlamsız kılar.
 */
export function searchTerms(query: string): string[] {
  const terms = foldForSearch(query)
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => token.length >= MIN_TERM_LENGTH);
  return [...new Set(terms)];
}

/**
 * Her kelime iddianın cümlesinde ya da alıntılarından birinde geçmeli.
 * Cümlede geçen kelime alıntıda geçenden ağır basıyor: iddia o konuyu
 * söylüyor, alıntı ise yalnızca yanında anıyor olabilir. Eşit puanlı
 * sonuçlar kütüphane ve kanıt defteri sırasını koruyor.
 */
export function searchClaims(index: ClaimIndex, query: string, limit = DEFAULT_CLAIM_LIMIT): ClaimSearch {
  const terms = searchTerms(query);
  if (!terms.length) return { terms, hits: [], total: 0, papers: 0 };
  const phrase = terms.join(" ");

  const scored = index.flatMap((entry, order) => {
    let score = 0;
    for (const term of terms) {
      if (entry.statement.includes(term)) score += 2;
      else if (entry.excerpts.some((excerpt) => excerpt.includes(term))) score += 1;
      else return [];
    }
    if (terms.length > 1 && entry.statement.includes(phrase)) score += 3;
    return [{ entry, order, score }];
  });

  const rejected = (entry: IndexedClaim) => Number(entry.review?.status === "rejected");
  scored.sort((left, right) => rejected(left.entry) - rejected(right.entry) || right.score - left.score || left.order - right.order);

  return {
    terms,
    total: scored.length,
    papers: new Set(scored.map(({ entry }) => entry.project.id)).size,
    hits: scored.slice(0, limit).map(({ entry }) => ({
      project: entry.project,
      claim: entry.claim,
      reference: bestReference(entry, terms),
      quoteMissing: entry.quoteMissing,
      review: entry.review,
    })),
  };
}

function bestReference(entry: IndexedClaim, terms: readonly string[]) {
  let best = 0;
  let bestCount = -1;
  entry.excerpts.forEach((excerpt, index) => {
    const count = terms.filter((term) => excerpt.includes(term)).length;
    if (count > bestCount) {
      best = index;
      bestCount = count;
    }
  });
  return entry.claim.sourceRefs[best];
}

/**
 * Katlanmış metin ve her katlanmış karakterin özgün metindeki konumu.
 *
 * Eşleşme katlanmış metinde aranıyor ama vurgu özgün metne uygulanıyor.
 * Bugünkü katlama her harfi tek harfe indiriyor; ama uzunluğu değiştiren bir
 * katlama (ör. aksanları ayırmak) eklenirse vurgu kaymasın diye her katlanmış
 * karakterin özgün konumu ayrıca tutuluyor.
 */
function foldWithOrigin(text: string) {
  let folded = "";
  const origin: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const piece = foldForSearch(text[index]);
    folded += piece;
    for (let offset = 0; offset < piece.length; offset += 1) origin.push(index);
  }
  return { folded, origin };
}

export type TextSegment = { text: string; match: boolean };

/** Metni sorgu kelimelerinin geçtiği yerlerden böler; vurgulamak arayüzün işi. */
export function highlightSegments(text: string, terms: readonly string[]): TextSegment[] {
  const { folded, origin } = foldWithOrigin(text);
  const marked = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    if (!term) continue;
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      for (let index = origin[at]; index <= origin[at + term.length - 1]; index += 1) marked[index] = true;
    }
  }

  const segments: TextSegment[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const last = segments.at(-1);
    if (last && last.match === marked[index]) last.text += text[index];
    else segments.push({ text: text[index], match: marked[index] });
  }
  return segments;
}

/**
 * Uzun bir alıntının, sorgunun ilk geçtiği yerin çevresi. Alıntılar çoğunlukla
 * bir iki cümle ama bir paragrafın tamamı da olabiliyor; eşleşme sonda kalınca
 * sonuç kartında hiç görünmüyordu. Kesim kelime sınırında yapılıyor ve kesilen
 * taraf "…" ile belirtiliyor.
 */
export function excerptAround(text: string, terms: readonly string[], maxLength = 280) {
  if (text.length <= maxLength) return text;
  const { folded, origin } = foldWithOrigin(text);
  const positions = terms.map((term) => folded.indexOf(term)).filter((at) => at !== -1);
  const first = positions.length ? origin[Math.min(...positions)] : 0;

  let start = Math.max(0, Math.min(first - 80, text.length - maxLength));
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < first) start = space + 1;
  }
  let end = Math.min(text.length, start + maxLength);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > first) end = space;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}
