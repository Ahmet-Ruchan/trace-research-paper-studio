import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, PUT } from "@/app/api/library/notes/route";
import { loadExampleProject } from "./example-fixture";
import { cleanQuote, groupNotes, isNotesFile, notesFileName, notesFileToJson, notesMarkdown, PAPER_BLOCK_WORDS, parseNotesFile, readerNoteSchema, type ReaderNote } from "./reader-notes";
import { deleteStoredProject, readReaderNotes, saveReaderNotes, saveStoredProject } from "./trace-storage";

const project = loadExampleProject("attention-is-all-you-need.en.trace.json");
const at = "2026-09-30T10:00:00.000Z";
const story = project.story.sections[1];
const report = project.deepReport!.sections[0];
const claim = project.evidence.claims[0];
const note = (patch: Partial<ReaderNote> & Pick<ReaderNote, "id" | "target">): ReaderNote => readerNoteSchema.parse({ createdAt: at, updatedAt: at, ...patch });

const notes = [
  note({ id: "n1", target: { kind: "claim", claimId: claim.id }, text: "Check this against the ablation." }),
  note({ id: "n2", target: { kind: "section", place: "report", sectionId: report.id }, quote: "a highlighted line", color: "green", createdAt: "2026-09-30T09:00:00.000Z" }),
  note({ id: "n3", target: { kind: "section", place: "story", sectionId: story.id }, quote: "the story's line", text: "Why does this hold?" }),
  note({ id: "n4", target: { kind: "claim", claimId: claim.id } }),
  note({ id: "n5", target: { kind: "section", place: "story", sectionId: "gone" }, text: "From an older version." }),
];

describe("reader notes", () => {
  it("needs a highlight or some text on a section, and allows a bare mark on a claim", () => {
    expect(readerNoteSchema.safeParse({ id: "x", target: { kind: "section", place: "story", sectionId: "s" }, createdAt: at, updatedAt: at }).success).toBe(false);
    expect(readerNoteSchema.safeParse({ id: "x", target: { kind: "claim", claimId: "c" }, createdAt: at, updatedAt: at }).success).toBe(true);
    expect(cleanQuote("  one\n  two\tthree ")).toBe("one two three");
  });

  it("keeps the good notes of a damaged file and drops the rest", () => {
    const raw = { version: 1, projects: [{ id: "a", notes: [notes[0], { id: "bad" }] }, { id: "b", notes: "no" }, { id: "c", notes: [] }] };
    const parsed = parseNotesFile(raw);
    expect([...parsed.keys()]).toEqual(["a"]);
    expect(parsed.get("a")!.map((item) => item.id)).toEqual(["n1"]);
    expect(isNotesFile({ version: 2, projects: [] })).toBe(false);
    expect(notesFileToJson(new Map([["a", notes.slice(0, 1)], ["empty", []]])).projects.map((item) => item.id)).toEqual(["a"]);
  });

  it("orders notes as the paper reads, story then report then claims, and keeps notes whose target is gone", () => {
    const groups = groupNotes(project, notes);
    expect(groups.map((group) => [group.place, group.heading])).toEqual([
      ["Story", story.title],
      ["Deep report", report.title],
      ["Claim", claim.statement],
      ["Story", "No longer in the paper"],
    ]);
    expect(groups[2].notes.map((item) => item.id)).toEqual(["n1", "n4"]);
  });

  it("keeps highlights on a Primer concept, after the report and before the claims", () => {
    const concept = project.primer!.concepts[1];
    const onConcept = note({ id: "n6", target: { kind: "section", place: "concept", sectionId: concept.id }, quote: "a line of the concept", text: "Revisit before the exam." });
    const groups = groupNotes(project, [...notes, onConcept]);
    expect(groups.map((group) => group.place)).toEqual(["Story", "Deep report", "Primer", "Claim", "Story"]);
    expect(groups[2]).toMatchObject({ heading: concept.term, notes: [onConcept] });
    expect(notesMarkdown(project, [onConcept], { exportedAt: at })).toContain(`## Primer: ${concept.term}\n\n> a line of the concept\n\nRevisit before the exam.`);
    expect(readerNoteSchema.safeParse({ ...onConcept, target: { kind: "section", place: "glossary", sectionId: "x" } }).success).toBe(false);
  });

  it("keeps highlights on the analysis text in the Lab first, named in the reader's language", () => {
    const onThesis = note({ id: "n7", target: { kind: "section", place: "paper", sectionId: "thesis" }, quote: "a line of the thesis" });
    const onLimits = note({ id: "n8", target: { kind: "section", place: "paper", sectionId: "limitations" }, text: "Check this in the next paper." });
    const onUnknown = note({ id: "n9", target: { kind: "section", place: "paper", sectionId: "nowhere" }, text: "Lost block." });
    const groups = groupNotes(project, [...notes, onLimits, onThesis, onUnknown]);
    expect(groups.slice(0, 2).map((group) => [group.place, group.heading])).toEqual([
      ["Lab", "Core thesis"],
      ["Lab", "Limitations"],
    ]);
    // Bilinmeyen bir blok kaybolmuyor, "artık makalede yok" altında kalıyor.
    expect(groups.at(-1)!.notes.map((item) => item.id)).toContain("n9");
    const turkish = { ...PAPER_BLOCK_WORDS, thesis: "Ana tez", limitations: "Sınırlılıklar" };
    expect(groupNotes(project, [onThesis, onLimits], turkish).map((group) => group.heading)).toEqual(["Ana tez", "Sınırlılıklar"]);
    expect(notesMarkdown(project, [onThesis], { exportedAt: at })).toContain("## Lab: Core thesis\n\n> a line of the thesis");
    // Teknik eki olmayan projede teknik ek bloğu yok: notu yetim sayılıyor.
    const bare = { ...project, technicalAppendix: undefined };
    const onTechnical = note({ id: "n10", target: { kind: "section", place: "paper", sectionId: "technical" }, text: "x" });
    expect(groupNotes(bare, [onTechnical])[0].heading).toBe("No longer in the paper");
  });

  it("exports Markdown, and Obsidian with front matter and callouts", () => {
    const plain = notesMarkdown(project, notes, { exportedAt: at });
    expect(plain).toContain(`# ${project.evidence.paper.title}: notes`);
    expect(plain).toContain(`## Story: ${story.title}\n\n> the story's line\n\nWhy does this hold?`);
    expect(plain).toContain(`## Claim: ${claim.statement} (p. ${claim.sourceRefs[0].page})`);
    expect(plain).toContain("*Marked as important.*");
    expect(plain).toContain("Exported from Trace on 2026-09-30.");
    const obsidian = notesMarkdown(project, notes, { obsidian: true, exportedAt: at });
    expect(obsidian.startsWith(`---\ntitle: ${JSON.stringify(project.evidence.paper.title)}\nauthors: [`)).toBe(true);
    expect(obsidian).toContain("tags: [trace, paper-notes]");
    expect(obsidian).toContain("> [!quote] Highlight\n> a highlighted line");
    expect(obsidian).toContain(`> [!cite] The paper, p. ${claim.sourceRefs[0].page}`);
    expect(obsidian).not.toContain("Exported from Trace");
    expect(notesFileName(project)).toBe("attention-is-all-you-need-notes.md");
  });
});

describe("the notes file and its API", () => {
  let workspace: string;
  let previous: string | undefined;
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-notes-"));
    previous = process.env.TRACE_DATA_DIR;
    process.env.TRACE_DATA_DIR = workspace;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TRACE_DATA_DIR;
    else process.env.TRACE_DATA_DIR = previous;
    rmSync(workspace, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1/api/library/notes";
  const put = (query: string, body: unknown) => PUT(new Request(`${base}${query}`, { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("saves a paper's notes next to the library, never in the project, and removes them with the paper", async () => {
    await saveStoredProject({ ...project, id: "noted" });
    const saved = await put("?id=noted", { notes: notes.slice(0, 3) });
    expect(saved.status).toBe(200);
    expect(((await (await GET(new Request(`${base}?id=noted`))).json()) as { notes: ReaderNote[] }).notes.map((item) => item.id)).toEqual(["n1", "n2", "n3"]);
    const file = join(workspace, "library", "notes.json");
    expect(JSON.parse(readFileSync(file, "utf8")).projects[0].id).toBe("noted");
    expect(readdirSync(join(workspace, "library")).find((name) => name.endsWith(".trace.json") && readFileSync(join(workspace, "library", name), "utf8").includes("Check this against"))).toBeUndefined();

    // Günün ilk yazımından önce bir yedek; silinen makalenin notları yedekte kalıyor.
    await saveReaderNotes("noted", notes.slice(0, 2));
    expect(readdirSync(join(workspace, "backups")).some((name) => /^notes-\d{4}-\d{2}-\d{2}\.json$/.test(name))).toBe(true);
    await deleteStoredProject("noted");
    expect(await readReaderNotes("noted")).toEqual([]);
  });

  it("refuses a paper not in the library and a bad request, and sets a damaged file aside", async () => {
    expect((await put("?id=nowhere", { notes: [] })).status).toBe(404);
    await saveStoredProject({ ...project, id: "noted" });
    expect((await put("", { notes: [] })).status).toBe(400);
    expect((await put("?id=noted", "{")).status).toBe(400);
    expect((await put("?id=noted", { notes: [{ id: "x", target: { kind: "section", place: "story", sectionId: "s" }, createdAt: at, updatedAt: at }] })).status).toBe(400);
    // Kimliksiz istek bütün kütüphanenin notları (kütüphane araması için).
    expect(await (await GET(new Request(base))).json()).toEqual({ version: 1, projects: [] });

    writeFileSync(join(workspace, "library", "notes.json"), "{ not json");
    expect(await readReaderNotes("noted")).toEqual([]);
    await saveReaderNotes("noted", notes.slice(0, 1));
    expect(readdirSync(join(workspace, "library")).some((name) => name.startsWith("notes.damaged-"))).toBe(true);
    expect(existsSync(join(workspace, "library", "notes.json"))).toBe(true);
  });
});
