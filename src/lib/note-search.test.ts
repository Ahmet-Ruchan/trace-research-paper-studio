import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/library/notes/route";
import { loadExampleProject } from "./example-fixture";
import { buildNoteIndex, searchNotes } from "./note-search";
import { parseNotesFile, readerNoteSchema, type ReaderNote } from "./reader-notes";
import type { ResearchProject } from "./schema";
import { saveReaderNotes, saveStoredProject } from "./trace-storage";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const first: ResearchProject = { ...example, id: "first" };
const second: ResearchProject = { ...example, id: "second", evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "A second paper" } } };
const report = example.deepReport!.sections[0];
const concept = example.primer!.concepts[0];
const claim = example.evidence.claims[0];
const note = (patch: Partial<ReaderNote> & Pick<ReaderNote, "id" | "target">): ReaderNote => readerNoteSchema.parse({ createdAt: "2026-09-30T10:00:00.000Z", updatedAt: "2026-09-30T10:00:00.000Z", ...patch });

const notes = new Map<string, ReaderNote[]>([
  ["first", [
    note({ id: "a", target: { kind: "section", place: "report", sectionId: report.id }, quote: "the scaling keeps the softmax gradients alive", text: "Ask about the √d_k scaling in the seminar." }),
    note({ id: "b", target: { kind: "claim", claimId: claim.id }, text: "Seminar: is this BLEU gain significant?", updatedAt: "2026-09-30T12:00:00.000Z" }),
    note({ id: "c", target: { kind: "claim", claimId: claim.id } }),
  ]],
  ["second", [note({ id: "d", target: { kind: "section", place: "concept", sectionId: concept.id }, quote: "the seminar example of a dot product" })]],
  ["gone", [note({ id: "e", target: { kind: "claim", claimId: claim.id }, text: "seminar notes on a removed paper" })]],
]);

describe("searching your notes", () => {
  it("finds notes and highlights across the library, with their place, newest first on a tie", () => {
    const index = buildNoteIndex([first, second], notes);
    // Yalnızca işaret olan kayıt aranmıyor; kütüphanede olmayan makalenin notu da yok.
    expect(index).toHaveLength(3);
    const result = searchNotes(index, "seminar");
    expect(result).toMatchObject({ total: 3, papers: 2 });
    expect(result.hits.map((hit) => [hit.note.id, hit.place])).toEqual([["b", "Claim"], ["a", "Deep report"], ["d", "Primer"]]);
    expect(result.hits[2].heading).toBe(concept.term);
    // Her kelime geçmeli; vurgu ve metin aynı ağırlıkta, başlık daha hafif.
    expect(searchNotes(index, "softmax seminar").hits.map((hit) => hit.note.id)).toEqual(["a"]);
    expect(searchNotes(index, `${concept.term.split(" ")[0]} seminar`).hits[0].note.id).toBe("d");
    expect(searchNotes(index, "x")).toMatchObject({ terms: [], hits: [] });
    expect(searchNotes(index, "seminar", 1)).toMatchObject({ total: 3, hits: [{ note: { id: "b" } }] });
  });
});

describe("all the notes at once", () => {
  let workspace: string;
  let previous: string | undefined;
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-note-search-"));
    previous = process.env.TRACE_DATA_DIR;
    process.env.TRACE_DATA_DIR = workspace;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TRACE_DATA_DIR;
    else process.env.TRACE_DATA_DIR = previous;
    rmSync(workspace, { recursive: true, force: true });
  });

  it("answers the library with every paper's notes", async () => {
    await saveStoredProject(first);
    await saveStoredProject(second);
    await saveReaderNotes("first", notes.get("first")!);
    await saveReaderNotes("second", notes.get("second")!);
    const response = await GET(new Request("http://127.0.0.1/api/library/notes"));
    expect(response.ok).toBe(true);
    const all = parseNotesFile(await response.json());
    expect([...all.keys()].sort()).toEqual(["first", "second"]);
    expect(all.get("first")!.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});
