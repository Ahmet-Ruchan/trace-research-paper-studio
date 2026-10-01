import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { claimSearchTool, LIBRARY_MCP_TOOLS, libraryTool, notesTool, paperTool, TraceToolError, type TraceLibraryData } from "./mcp-tools";
import type { ReaderNote } from "./reader-notes";
import type { ResearchProject } from "./schema";
import { emptyStudyProgress } from "./study-path";

const attention = loadExampleProject("attention-is-all-you-need.en.trace.json");
const second: ResearchProject = {
  ...attention,
  id: "second",
  evidence: {
    ...attention.evidence,
    paper: { ...attention.evidence.paper, title: "Çayır Ölçümleri Üzerine", authors: ["Ayşe Yılmaz"], year: "2021", venue: "Field Notes" },
    claims: attention.evidence.claims.map((claim) => ({ ...claim, statement: `Field claim: ${claim.statement}` })),
  },
  excerptCheck: undefined,
};
const at = (minutes: number) => new Date(Date.UTC(2026, 8, 30, 10, minutes)).toISOString();
const notes: ReaderNote[] = [
  { id: "n1", target: { kind: "claim", claimId: attention.evidence.claims[0].id }, text: "Check against the ablation.", color: "yellow", createdAt: at(1), updatedAt: at(1) },
  { id: "n2", target: { kind: "section", place: "report", sectionId: attention.deepReport!.sections[0].id }, quote: "a highlighted line", text: "", color: "purple", createdAt: at(2), updatedAt: at(5) },
];
const data = (): TraceLibraryData => ({
  projects: [attention, second],
  study: new Map([[attention.id, { ...emptyStudyProgress(at(0)), finishedAt: at(9) }]]),
  notes: new Map([[attention.id, notes]]),
  tags: new Map([[second.id, ["Fieldwork", "NLP"]], [attention.id, ["NLP"]]]),
});

describe("MCP tools on the library", () => {
  it("describes every tool with an object schema that rejects unknown arguments", () => {
    expect(LIBRARY_MCP_TOOLS.map((tool) => tool.name)).toEqual(["library", "paper", "search_claims", "notes"]);
    for (const tool of LIBRARY_MCP_TOOLS) {
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.inputSchema).not.toHaveProperty("$schema");
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.description.length).toBeGreaterThan(40);
    }
    expect((LIBRARY_MCP_TOOLS[2].inputSchema as { required?: string[] }).required).toEqual(["query"]);
  });

  it("lists the papers with tags, study status and counts, filtered by words or a tag", () => {
    const all = libraryTool(data(), {});
    expect(all.papers).toBe(2);
    expect(all.tags).toEqual([{ tag: "NLP", papers: 2 }, { tag: "Fieldwork", papers: 1 }]);
    const first = all.results.find((paper) => paper.id === attention.id)!;
    expect(first).toMatchObject({ study: "finished", notes: 2, tags: ["NLP"], claims: attention.evidence.claims.length });
    expect(all.results.find((paper) => paper.id === second.id)!.study).toBe("not started");
    // Aksansız ve küçük harfle; yazar ve etiket de aranıyor.
    expect(libraryTool(data(), { query: "cayir" }).results.map((paper) => paper.id)).toEqual(["second"]);
    expect(libraryTool(data(), { query: "ayse" }).results.map((paper) => paper.id)).toEqual(["second"]);
    expect(libraryTool(data(), { tag: "fieldwork" }).results.map((paper) => paper.id)).toEqual(["second"]);
    expect(libraryTool(data(), { limit: 1 })).toMatchObject({ matching: 2, shown: 1 });
    expect(() => libraryTool(data(), { limit: 0 })).toThrow();
    expect(() => libraryTool(data(), { other: true })).toThrow();
  });

  it("gives one paper by id or title, and its claims with page, quote and check when asked", () => {
    const paper = paperTool(data(), { id: attention.id });
    expect(paper.thesis).toBe(attention.evidence.thesis);
    expect(paper.deepReport.length).toBe(attention.deepReport!.sections.length);
    expect(paper.primer[0]).toMatchObject({ id: attention.primer!.concepts[0].id, term: attention.primer!.concepts[0].term });
    expect(paper).not.toHaveProperty("claimList");
    const withClaims = paperTool(data(), { title: "attention is all", include_claims: true, claim_limit: 3 });
    expect(withClaims.claimList).toHaveLength(3);
    expect(withClaims.claimList![0]).toMatchObject({ id: attention.evidence.claims[0].id, page: attention.evidence.claims[0].sourceRefs[0].page, quoteCheck: expect.stringMatching(/on its page$/) });
    expect(paperTool(data(), { id: second.id, include_claims: true }).claimList![0].quoteCheck).toBe("not checked");
    expect(() => paperTool(data(), { id: "missing" })).toThrow(TraceToolError);
    expect(() => paperTool(data(), { title: "no such paper" })).toThrow(/No paper in the library/);
    expect(() => paperTool(data(), {})).toThrow(/id or part of its title/);
  });

  it("asks for the id when a title matches more than one paper", () => {
    const twin = { ...attention, id: "twin", evidence: { ...attention.evidence, paper: { ...attention.evidence.paper, title: "Attention Is All You Need, Revisited" } } };
    const library = { ...data(), projects: [attention, twin] };
    expect(paperTool(library, { title: "Attention Is All You Need" }).id).toBe(attention.id);
    expect(() => paperTool(library, { title: "attention" })).toThrow(/More than one paper.*id twin/);
  });

  it("searches the claims of every paper, of one paper or of a tag", () => {
    const everywhere = claimSearchTool(data(), { query: "BLEU" });
    expect(everywhere.papers).toBe(2);
    expect(everywhere.hits[0]).toMatchObject({ statement: expect.stringContaining("BLEU"), page: expect.any(Number), quote: expect.any(String) });
    const one = claimSearchTool(data(), { query: "BLEU", paper_id: second.id, limit: 2 });
    expect(one.hits.every((hit) => hit.paperId === second.id)).toBe(true);
    expect(one.shown).toBe(2);
    expect(claimSearchTool(data(), { query: "BLEU", tag: "fieldwork" }).papers).toBe(1);
    expect(claimSearchTool(data(), { query: "zzzz qqqq" })).toMatchObject({ total: 0, note: expect.stringContaining("No claim") });
    expect(() => claimSearchTool(data(), { query: "x" })).toThrow();
    expect(() => claimSearchTool(data(), { query: "BLEU", paper_id: "missing" })).toThrow(TraceToolError);
  });

  it("lists the newest notes with their place, or finds them by words", () => {
    const newest = notesTool(data(), {});
    expect(newest.total).toBe(2);
    expect(newest.notes[0]).toMatchObject({ paperId: attention.id, place: "Deep report", highlighted: "a highlighted line", color: "purple" });
    expect(newest.notes[0]).not.toHaveProperty("note");
    expect(newest.notes[1]).toMatchObject({ place: "Claim", note: "Check against the ablation." });
    expect(notesTool(data(), { query: "ablation" }).notes.map((note) => note.note)).toEqual(["Check against the ablation."]);
    expect(notesTool(data(), { paper_id: second.id })).toMatchObject({ total: 0, note: expect.stringContaining("No notes") });
  });
});
