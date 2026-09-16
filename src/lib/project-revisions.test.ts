import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import {
  EDIT_COALESCE_MS,
  describeProjectChanges,
  isRevisionFileName,
  revisionFileName,
  revisionId,
  revisionsToPrune,
  sameProjectContent,
  shouldSnapshot,
} from "./project-revisions";
import type { ResearchProject } from "./schema";

const fresh = (): ResearchProject => structuredClone(loadExampleProject());
const at = (ms: number) => new Date(Date.UTC(2026, 8, 16, 8, 0, 0) + ms).toISOString();

describe("revision ids", () => {
  it("sort by time and cannot carry a path", () => {
    const early = revisionId("2026-09-16T08:15:30.123Z", "edit", "1A2B3C4D99");
    const late = revisionId("2026-09-16T09:00:00.000Z", "manual", "ffffffff");
    expect(early).toBe("20260916T081530123Z-edit-1a2b3c4d");
    expect([late, early].sort()).toEqual([early, late]);
    expect(isRevisionFileName(revisionFileName(early))).toBe(true);
    expect(isRevisionFileName("../x.revision.json")).toBe(false);
    expect(() => revisionFileName("../../etc/passwd")).toThrow();
    expect(() => revisionId("2026-09-16T08:15:30.123Z", "edit", "not/hex!")).toThrow();
  });

  it("prunes the oldest beyond the limit", () => {
    const ids = Array.from({ length: 5 }, (_, index) => revisionId(at(index * 1000), "edit", "aaaaaaaa"));
    expect(revisionsToPrune(ids, 3)).toEqual([ids[1], ids[0]]);
    expect(revisionsToPrune(ids.slice(0, 2), 3)).toEqual([]);
  });
});

describe("when to keep the replaced version", () => {
  it("ignores a save that only refreshed the timestamp", () => {
    const project = fresh();
    const reopened = { ...project, updatedAt: at(99) };
    expect(sameProjectContent(project, reopened)).toBe(true);
    expect(shouldSnapshot({ previous: project, next: reopened, reason: "regenerate", now: at(0) })).toBe(false);
  });

  it("coalesces edits into one snapshot every ten minutes", () => {
    const project = fresh();
    const edited = { ...project, story: { ...project.story, title: "Edited" } };
    const base = { previous: project, next: edited, reason: "edit" as const };
    expect(shouldSnapshot({ ...base, now: at(0) })).toBe(true);
    expect(shouldSnapshot({ ...base, newestRevisionAt: at(0), now: at(EDIT_COALESCE_MS - 1) })).toBe(false);
    expect(shouldSnapshot({ ...base, newestRevisionAt: at(0), now: at(EDIT_COALESCE_MS) })).toBe(true);
  });

  it("always keeps the version before a large change, and never invents one", () => {
    const project = fresh();
    const changed = { ...project, story: { ...project.story, title: "Changed" } };
    for (const reason of ["regenerate", "restore", "import", "agent"] as const) {
      expect(shouldSnapshot({ previous: project, next: changed, reason, newestRevisionAt: at(0), now: at(1) })).toBe(true);
    }
    expect(shouldSnapshot({ previous: undefined, next: changed, reason: "regenerate", now: at(1) })).toBe(false);
    // Elle kayıt içerik aynı olsa da bir işaret bırakır.
    expect(shouldSnapshot({ previous: project, next: project, reason: "manual", newestRevisionAt: at(0), now: at(1) })).toBe(true);
  });
});

describe("what changed between two versions", () => {
  it("says nothing for identical projects", () => {
    expect(describeProjectChanges(fresh(), { ...fresh(), updatedAt: at(5) })).toEqual([]);
  });

  it("names the story and report sections that changed, and how", () => {
    const from = fresh();
    const to = fresh();
    to.story.sections[3] = { ...to.story.sections[3], body: "New text", claimIds: ["claim-result-04"] };
    to.deepReport!.sections[5] = { ...to.deepReport!.sections[5], analysis: ["One.", "Two."] };

    const changes = describeProjectChanges(from, to);
    expect(changes).toContainEqual({ area: "story", summary: "Story section text and claims changed", subject: from.story.sections[3].title });
    expect(changes).toContainEqual({ area: "report", summary: "Report section analysis changed", subject: from.deepReport!.sections[5].title });
    expect(changes.some((change) => change.area === "evidence")).toBe(false);
  });

  it("counts claims added, removed and edited", () => {
    const from = fresh();
    const to = fresh();
    const removed = to.evidence.claims.pop()!;
    to.evidence.claims[0] = { ...to.evidence.claims[0], statement: "Edited statement" };
    to.evidence.claims.push({ ...removed, id: "claim-new-01" }, { ...removed, id: "claim-new-02" });
    expect(describeProjectChanges(from, to)).toContainEqual({ area: "evidence", summary: "Evidence: 2 claims added, 1 removed, 1 edited" });
  });

  it("notices added, removed and reordered blocks", () => {
    const from = fresh();
    const to = fresh();
    delete to.quiz;
    to.story.sections = [to.story.sections[1], to.story.sections[0], ...to.story.sections.slice(2)];
    to.story.sections.pop();
    to.depth = "standard";

    const summaries = describeProjectChanges(from, to).map((change) => change.summary);
    expect(summaries).toContain("Quiz removed");
    expect(summaries).toContain("Story sections reordered");
    expect(summaries).toContain("Story section removed");
    expect(summaries).toContain("depth changed");
    expect(describeProjectChanges(to, from).map((change) => change.summary)).toContain("Quiz added");
  });
});
