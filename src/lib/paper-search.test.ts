import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { searchPaper } from "./paper-search";
import { readerNoteSchema, type ReaderNote } from "./reader-notes";

const project = loadExampleProject("attention-is-all-you-need.en.trace.json");
const at = "2026-09-30T10:00:00.000Z";
const concept = project.primer!.concepts.find((item) => item.term === "Softmax")!;
const notes: ReaderNote[] = [
  readerNoteSchema.parse({ id: "n1", target: { kind: "section", place: "concept", sectionId: concept.id }, quote: "turns scores into weights", text: "Softmax temperature question for Friday.", createdAt: at, updatedAt: at }),
  readerNoteSchema.parse({ id: "n2", target: { kind: "claim", claimId: project.evidence.claims[0].id }, createdAt: at, updatedAt: at }),
];

describe("searching one paper", () => {
  it("finds a word in claims, sections, concepts, terms and the reader's notes, titles first", () => {
    const result = searchPaper(project, notes, "softmax");
    expect(result.total).toBeGreaterThan(2);
    expect(result.hits[0]).toMatchObject({ kind: "concept", id: concept.id, title: "Softmax" });
    expect(result.counts.note).toBe(1);
    const note = result.hits.find((hit) => hit.kind === "note")!;
    expect(note).toMatchObject({ id: "n1", title: "Softmax", target: { kind: "section", place: "concept", sectionId: concept.id } });
    expect(note.text).toContain("“turns scores into weights”");
    // Yalnızca işaretlenmiş (metinsiz) iddia notu aranmıyor.
    expect(result.hits.some((hit) => hit.id === "n2")).toBe(false);
    expect(Object.values(result.counts).reduce((sum, value) => sum + value, 0)).toBe(result.total);
  });

  it("needs every word, finds glossary terms, and limits the list", () => {
    const glossary = project.evidence.glossary[0];
    expect(searchPaper(project, [], glossary.term).hits.some((hit) => hit.kind === "term" && hit.id === glossary.term)).toBe(true);
    expect(searchPaper(project, [], "softmax zebra").total).toBe(0);
    expect(searchPaper(project, [], "a")).toMatchObject({ terms: [], total: 0 });
    const many = searchPaper(project, [], "attention", 3);
    expect(many.hits).toHaveLength(3);
    expect(many.total).toBeGreaterThan(3);
  });
});
