import type { Claim, ResearchProject } from "./schema";

/**
 * Kanıt sağlığı — projenin KENDİ verisinden hesaplanır, model çağrısı yok.
 *
 * Trace'in iddiası "her cümle bir sayfaya bağlı". Bu modül o iddiayı
 * denetlenebilir kılıyor: kaç iddia gerçekten doğrulanmış, analiz makalenin
 * neresine hiç dokunmamış, hangi bölüm tek bir iddianın üzerinde duruyor,
 * hangi iddia toplanıp hiç kullanılmamış.
 *
 * Hepsi saf: aynı `.trace.json` her yerde aynı sonucu verir, dolayısıyla
 * Next uygulaması, bağımsız görüntüleyici ve testler tek hesaba bakar.
 */

export type ClaimTally = {
  total: number;
  verified: number;
  needsReview: number;
  /** 0–1; toplam sıfırsa 0. */
  verifiedRatio: number;
};

export type SourceUsage = {
  id: string;
  title: string;
  type: "paper" | "web";
  url?: string;
  claimCount: number;
};

export type PageCoverage = {
  /** Herhangi bir iddia, metrik, sözlük girdisi veya şeklin işaret ettiği sayfalar. */
  cited: number[];
  first?: number;
  last?: number;
  /** İlk ve son atıf arasında kalıp hiç atıf almayan sayfalar. */
  gaps: number[];
};

export type SectionHealth = {
  id: string;
  title: string;
  area: "story" | "report";
  claimCount: number;
  verifiedCount: number;
  /**
   * Tek bir iddiaya dayanıyor ya da dayandığı iddiaların hiçbiri
   * doğrulanmamış. İkisi de "bu paragrafı okurken dikkatli ol" demek.
   */
  thin: boolean;
};

export type EvidenceHealth = {
  claims: ClaimTally;
  /** Makaleden gelen ve dış bağlamdan (arXiv, Semantic Scholar…) gelen iddialar. */
  grounding: { fromPaper: number; fromWeb: number };
  pages: PageCoverage;
  sources: SourceUsage[];
  sections: SectionHealth[];
  /** Kanıt defterinde duran ama hiçbir yerde kullanılmayan iddialar. */
  unusedClaims: Claim[];
  /** Anlatının herhangi bir yerinde geçen iddia sayısı. */
  usedClaimCount: number;
};

/**
 * Projeyi gezip her `claimIds` dizisini toplar.
 *
 * Şemayı tek tek dolaşmak yerine özyineli tarama tercih edildi: `claimIds`
 * bugün on bir ayrı blokta geçiyor ve şemaya yeni bir blok eklendiğinde bu
 * modülün sessizce eksik saymasını istemiyoruz — eklenen blok kendiliğinden
 * sayıma girsin.
 */
function collectReferencedClaimIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedClaimIds(item, into);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "claimIds" && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string") into.add(id);
      continue;
    }
    collectReferencedClaimIds(child, into);
  }
}

function tally(claims: readonly Claim[]): ClaimTally {
  const verified = claims.filter((claim) => claim.confidence === "verified").length;
  return {
    total: claims.length,
    verified,
    needsReview: claims.length - verified,
    verifiedRatio: claims.length ? verified / claims.length : 0,
  };
}

export function evidenceHealth(project: ResearchProject): EvidenceHealth {
  const { claims, sources, metrics, glossary } = project.evidence;
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  const referenced = new Set<string>();
  collectReferencedClaimIds(project, referenced);

  const claimCountBySource = new Map<string, number>();
  const citedPages = new Set<number>();
  let fromPaper = 0;
  let fromWeb = 0;

  for (const claim of claims) {
    // Bir iddia birden çok kaynağa dayanabilir; kaynak sayımı her atfı ayrı
    // sayar, ama "makaleden mi geldi" sorusu iddia başına bir kez cevaplanır.
    let touchesPaper = false;
    for (const ref of claim.sourceRefs) {
      claimCountBySource.set(ref.sourceId, (claimCountBySource.get(ref.sourceId) ?? 0) + 1);
      if (ref.page) citedPages.add(ref.page);
      if (sourceById.get(ref.sourceId)?.type !== "web") touchesPaper = true;
    }
    if (touchesPaper) fromPaper += 1;
    else fromWeb += 1;
  }

  // Sayfa kapsamı yalnızca iddialardan değil: bir metriğin ya da şeklin
  // dokunduğu sayfa da o sayfanın okunduğunun kanıtı.
  for (const metric of metrics) if (metric.sourceRef.page) citedPages.add(metric.sourceRef.page);
  for (const item of glossary) if (item.sourceRef?.page) citedPages.add(item.sourceRef.page);
  for (const figure of project.figures ?? []) citedPages.add(figure.page);

  const cited = [...citedPages].sort((a, b) => a - b);
  const first = cited[0];
  const last = cited[cited.length - 1];
  const gaps: number[] = [];
  // PDF'in toplam sayfa sayısı `.trace.json` içinde yok, o yüzden "kaç sayfa
  // atlandı" diyemeyiz. Dürüst olan tek ifade, ilk ve son atıf ARASINDA
  // kalan boşluk: o aralığın okunduğu kesin, atlanan sayfa gerçekten atlanmış.
  if (first !== undefined && last !== undefined) {
    for (let page = first; page <= last; page += 1) {
      if (!citedPages.has(page)) gaps.push(page);
    }
  }

  const sourceUsage: SourceUsage[] = sources
    .map((source) => ({
      id: source.id,
      title: source.title,
      type: source.type,
      url: source.url,
      claimCount: claimCountBySource.get(source.id) ?? 0,
    }))
    .sort((a, b) => b.claimCount - a.claimCount);

  const sections: SectionHealth[] = [
    ...project.story.sections.map((section) => ({
      id: section.id,
      title: section.title,
      area: "story" as const,
      claimIds: section.claimIds,
    })),
    ...(project.deepReport?.sections ?? []).map((section) => ({
      id: section.id,
      title: section.title,
      area: "report" as const,
      claimIds: section.claimIds,
    })),
  ].map(({ claimIds, ...section }) => {
    const linked = claimIds.map((id) => claimById.get(id)).filter((claim): claim is Claim => Boolean(claim));
    const verifiedCount = linked.filter((claim) => claim.confidence === "verified").length;
    return {
      ...section,
      claimCount: linked.length,
      verifiedCount,
      thin: linked.length <= 1 || verifiedCount === 0,
    };
  });

  return {
    claims: tally(claims),
    grounding: { fromPaper, fromWeb },
    pages: { cited, first, last, gaps },
    sources: sourceUsage,
    sections,
    unusedClaims: claims.filter((claim) => !referenced.has(claim.id)),
    usedClaimCount: claims.filter((claim) => referenced.has(claim.id)).length,
  };
}
