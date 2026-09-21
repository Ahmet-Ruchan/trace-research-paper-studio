import { describe, expect, it } from "vitest";
import { reviewSummary, setClaimReview } from "./claim-review";
import { loadExampleProject } from "./example-fixture";
import { researchProjectSchema } from "./schema";

const base = () => loadExampleProject("attention-is-all-you-need.en.trace.json");
const review = (status: "approved" | "rejected") => ({ status, by: "Ada", at: "2026-09-22T10:00:00.000Z" });

describe("claim review", () => {
  it("bekleyenleri önem sırasıyla dizer: bulunamayan alıntı, emin olunmayan, kullanılan", () => {
    const project = base();
    const [first, second, third] = project.evidence.claims;
    second.confidence = "needs-review";
    project.excerptCheck = { checkedAt: "2026-01-01T00:00:00.000Z", method: "pdftotext", pageCount: 15, checked: 10, unlocated: [{ owner: "claim", id: third.id, page: 2 }] };

    const summary = reviewSummary(project);
    expect(summary.items[0]).toMatchObject({ claim: { id: third.id }, reason: "quote-not-found" });
    expect(summary.items.find((item) => item.claim.id === second.id)?.reason).toBe("needs-review");
    // Örnekte zaten emin olunmayan iddialar var; sıra her durumda önem sırasıdır.
    const rank = { "quote-not-found": 0, "needs-review": 1, "in-use": 2, unused: 3 };
    const ranks = summary.items.map((item) => rank[item.reason]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(summary).toMatchObject({ total: project.evidence.claims.length, approved: 0, rejected: 0, pending: project.evidence.claims.length });
    expect(summary.items.find((item) => item.claim.id === first.id)?.usedIn.length).toBeGreaterThan(0);
  });

  it("karar verilenleri sona alır ve reddedilen iddiaya dayanan bölümleri gösterir", () => {
    let project = base();
    const used = project.story.sections[0].claimIds[0];
    project = setClaimReview(project, used, { ...review("rejected"), note: "The paper says the opposite on p. 9." });
    project = setClaimReview(project, project.evidence.claims[1].id, review("approved"));

    const summary = reviewSummary(project);
    expect(summary).toMatchObject({ approved: 1, rejected: 1, pending: summary.total - 2 });
    expect(summary.items.slice(-2).every((item) => item.review)).toBe(true);
    expect(summary.sectionsOnRejected[0]).toMatchObject({ area: "story", id: project.story.sections[0].id, claimIds: [used] });
    // Kayıt şemadan geçer ve iddianın kendisine dokunmaz.
    expect(researchProjectSchema.safeParse(project).success).toBe(true);
    expect(project.evidence).toEqual(base().evidence);
  });

  it("kararı geri alır, bilinmeyen iddiayı yok sayar, eskimiş kararları temizler", () => {
    const project = base();
    const id = project.evidence.claims[0].id;
    const withStale = { ...project, claimReviews: { gone: review("approved"), [id]: review("approved") } };
    expect(setClaimReview(withStale, "not-a-claim", review("approved"))).toBe(withStale);
    expect(setClaimReview(withStale, id).claimReviews).toBeUndefined();
    expect(Object.keys(setClaimReview(withStale, id, review("rejected")).claimReviews ?? {})).toEqual([id]);
  });
});
