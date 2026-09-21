import type { Claim, ClaimReview, ResearchProject } from "./schema";

/**
 * İddia inceleme kuyruğu — bir insanın bakması gereken iddialar, önem sırasıyla.
 *
 * Trace'te üç ayrı güven işareti var ve hiçbiri diğerinin yerine geçmiyor:
 * modelin beyanı (`confidence`), programın bulgusu (`excerptCheck`) ve kişinin
 * kararı (`claimReviews`). Kuyruk ilk ikisini kullanarak üçüncüsü için sıra
 * öneriyor: önce alıntısı sayfada bulunamayanlar, sonra modelin kendisinin emin
 * olmadıkları, sonra anlatıda kullanılanlar. Hepsi projenin kendi verisinden
 * hesaplanıyor.
 */

export type ReviewReason = "quote-not-found" | "needs-review" | "in-use" | "unused";

export type ReviewItem = {
  claim: Claim;
  review?: ClaimReview;
  reason: ReviewReason;
  /** İddiayı kullanan bölümler; reddedilen bir iddia için yeniden yazılacak yerler. */
  usedIn: Array<{ area: "story" | "report"; id: string; title: string }>;
};

export type ReviewSummary = {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  /** Bekleyenler önce ve önem sırasıyla; karar verilmişler sonda. */
  items: ReviewItem[];
  /** Reddedilmiş bir iddiaya hâlâ dayanan bölümler. */
  sectionsOnRejected: Array<{ area: "story" | "report"; id: string; title: string; claimIds: string[] }>;
};

const reasonRank: Record<ReviewReason, number> = { "quote-not-found": 0, "needs-review": 1, "in-use": 2, unused: 3 };

export function reviewSummary(project: ResearchProject): ReviewSummary {
  const reviews = project.claimReviews ?? {};
  const unlocated = new Set(
    (project.excerptCheck?.unlocated ?? []).filter((item) => item.owner === "claim").map((item) => item.id),
  );
  const sections = [
    ...project.story.sections.map((section) => ({ area: "story" as const, id: section.id, title: section.title, claimIds: section.claimIds })),
    ...(project.deepReport?.sections ?? []).map((section) => ({ area: "report" as const, id: section.id, title: section.title, claimIds: section.claimIds })),
  ];

  const items: ReviewItem[] = project.evidence.claims.map((claim) => {
    const usedIn = sections.filter((section) => section.claimIds.includes(claim.id)).map(({ area, id, title }) => ({ area, id, title }));
    const reason: ReviewReason = unlocated.has(claim.id)
      ? "quote-not-found"
      : claim.confidence === "needs-review"
        ? "needs-review"
        : usedIn.length
          ? "in-use"
          : "unused";
    return { claim, review: reviews[claim.id], reason, usedIn };
  });

  const approved = items.filter((item) => item.review?.status === "approved").length;
  const rejected = items.filter((item) => item.review?.status === "rejected").length;
  const rejectedIds = new Set(items.filter((item) => item.review?.status === "rejected").map((item) => item.claim.id));

  return {
    total: items.length,
    approved,
    rejected,
    pending: items.length - approved - rejected,
    // Sıralama kararlı: aynı önemdeki iddialar kanıt defterindeki sırasını korur.
    items: items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => Number(Boolean(a.item.review)) - Number(Boolean(b.item.review)) || reasonRank[a.item.reason] - reasonRank[b.item.reason] || a.index - b.index)
      .map(({ item }) => item),
    sectionsOnRejected: sections
      .map((section) => ({ ...section, claimIds: section.claimIds.filter((id) => rejectedIds.has(id)) }))
      .filter((section) => section.claimIds.length),
  };
}

/** Bir kararı yazar ya da (`review` yoksa) geri alır. Artık var olmayan iddiaların kararları temizlenir. */
export function setClaimReview(project: ResearchProject, claimId: string, review?: ClaimReview): ResearchProject {
  const known = new Set(project.evidence.claims.map((claim) => claim.id));
  if (!known.has(claimId)) return project;
  const next = Object.fromEntries(Object.entries(project.claimReviews ?? {}).filter(([id]) => known.has(id) && id !== claimId));
  if (review) next[claimId] = review;
  return { ...project, claimReviews: Object.keys(next).length ? next : undefined };
}
