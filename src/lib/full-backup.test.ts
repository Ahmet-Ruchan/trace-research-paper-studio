import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as exportData, POST as importData } from "@/app/api/profile/data/route";
import { decideAlias, emptyAliasFile } from "./concept-aliases";
import { loadExampleProject } from "./example-fixture";
import { describeBackupImport, emptyBackupSummary, mergeAliasFiles, mergeNotes, mergeTags } from "./full-backup";
import { readerNoteSchema, type ReaderNote } from "./reader-notes";
import { readingItemSchema } from "./reading-list";
import { completeStep } from "./study-path";
import {
  listStoredProjects,
  readAllStudyProgress,
  readConceptAliases,
  readLibraryTags,
  readReaderNotes,
  readReadingList,
  readWorkLog,
  saveReaderNotes,
  saveStoredProject,
  saveStoredProjectTags,
  saveStudyProgress,
  updateConceptAliases,
  updateProfile,
  updateReadingList,
  updateWorkLog,
} from "./trace-storage";
import { addSessions } from "./work-log";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 9, minute)).toISOString();
const note = (id: string, text: string, updatedAt = at(0)): ReaderNote =>
  readerNoteSchema.parse({ id, target: { kind: "claim", claimId: "c1" }, text, createdAt: at(0), updatedAt });

describe("merging a backup", () => {
  it("keeps the newer copy of a note, the order here, and adds the rest", () => {
    const merged = mergeNotes([note("a", "old"), note("b", "mine")], [note("a", "newer", at(5)), note("c", "theirs"), note("b", "stale", at(-5))]);
    expect(merged.map((item) => [item.id, item.text])).toEqual([["a", "newer"], ["b", "mine"], ["c", "theirs"]]);
  });

  it("joins tags without a second spelling, and adds a concept decision only where none was made here", () => {
    expect(mergeTags(["NLP", "to read"], ["nlp", "Transformers"])).toEqual(["NLP", "to read", "Transformers"]);
    const mine = decideAlias(emptyAliasFile(), "Dot product", "Scalar product", "different", "reader", at(0));
    const theirs = decideAlias(decideAlias(emptyAliasFile(), "Dot product", "Scalar product", "same", "reader", at(1)), "Softmax", "Normalised exponential", "same", "reader", at(2));
    const { file, added } = mergeAliasFiles(mine, theirs);
    expect(added).toBe(1);
    expect(file.decisions.map((item) => [item.terms.join(" / "), item.decision])).toEqual([["Dot product / Scalar product", "different"], ["Softmax / Normalised exponential", "same"]]);
  });

  it("tells the reader what came in, and that nothing was removed", () => {
    expect(describeBackupImport(0, false)).toBe("0 sessions added. Nothing was removed.");
    expect(describeBackupImport(1, true, { ...emptyBackupSummary(), papersAdded: 2, papersKept: 1, notesAdded: 3, withoutPaper: 1 })).toBe(
      "1 session added, the profile in the file taken over, 2 papers added to your library, 1 paper already here kept as they are, 3 notes added, 1 record left out because the paper is not in your library. Nothing was removed.",
    );
  });
});

describe("the whole backup, from one computer to another", () => {
  let workspace: string;
  let previous: string | undefined;
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-backup-"));
    previous = process.env.TRACE_DATA_DIR;
    process.env.TRACE_DATA_DIR = workspace;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TRACE_DATA_DIR;
    else process.env.TRACE_DATA_DIR = previous;
    rmSync(workspace, { recursive: true, force: true });
  });
  const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
  const paper = (id: string, title: string) => ({ ...example, id, evidence: { ...example.evidence, paper: { ...example.evidence.paper, title } } });
  const session = (id: string, minute: number) => ({ id, kind: "focus" as const, start: at(minute), end: at(minute + 25) });
  const item = (title: string) => readingItemSchema.parse({ id: `title:${title.toLowerCase()}`, title, from: [{ projectId: "attention", relation: "reference" }], addedAt: at(0) });
  const post = async (body: unknown) => (await importData(new Request("http://127.0.0.1/api/profile/data", { method: "POST", body: JSON.stringify(body) }))).json() as Promise<{ added: number; library?: Record<string, number> }>;

  it("carries the papers, the study progress, notes, reading list, tags and concept links, and merges them without removing anything", async () => {
    // Birinci bilgisayar.
    await updateProfile((profile) => ({ ...profile, firstName: "Ada" }));
    await updateWorkLog((log) => addSessions(log, [session("a", 0)]));
    await saveStoredProject(paper("attention", "Attention Is All You Need"));
    await saveStoredProject(paper("bert", "BERT"));
    await saveStudyProgress("attention", completeStep(undefined, "start", "concept:softmax", at(0)));
    await saveReaderNotes("attention", [note("n1", "Check the ablation.")]);
    await updateReadingList(() => [item("Layer Normalization")]);
    await saveStoredProjectTags("attention", ["Transformers"]);
    await updateConceptAliases((file) => decideAlias(file, "Softmax", "Normalised exponential", "same", "reader", at(0)));
    const file = await (await exportData()).json();
    expect(file.version).toBe(2);
    expect(file.library.papers.map((item: { id: string }) => item.id).sort()).toEqual(["attention", "bert"]);
    const light = await (await exportData(new Request("http://127.0.0.1/api/profile/data?papers=0"))).json();
    expect(light.library.papers).toBeUndefined();
    expect(light.library.notes.projects).toHaveLength(1);

    // İkinci bilgisayar: aynı makalenin kendi kopyası, kendi notu ve etiketi.
    rmSync(workspace, { recursive: true, force: true });
    await saveStoredProject(paper("attention", "Attention, my own copy"));
    await saveReaderNotes("attention", [note("n2", "Mine, from the laptop.")]);
    await saveStoredProjectTags("attention", ["Reading group"]);
    const imported = await post(file);
    expect(imported).toMatchObject({ added: 1, library: { papersAdded: 1, papersKept: 1, studyMerged: 1, notesAdded: 1, readingAdded: 1, tagsMerged: 1, aliasesAdded: 1, withoutPaper: 0 } });
    expect((await listStoredProjects()).map((project) => [project.id, project.evidence.paper.title]).sort()).toEqual([["attention", "Attention, my own copy"], ["bert", "BERT"]]);
    expect((await readReaderNotes("attention")).map((item) => item.id)).toEqual(["n2", "n1"]);
    expect((await readLibraryTags()).get("attention")).toEqual(["Reading group", "Transformers"]);
    expect((await readAllStudyProgress()).get("attention")).toMatchObject({ done: ["start"], current: "concept:softmax" });
    expect((await readReadingList()).map((entry) => entry.title)).toEqual(["Layer Normalization"]);
    expect((await readConceptAliases()).decisions).toHaveLength(1);
    expect((await readWorkLog()).sessions.map((entry) => entry.id)).toEqual(["a"]);

    // Aynı dosya ikinci kez: hiçbir şey çoğalmıyor.
    expect(await post(file)).toMatchObject({ added: 0, library: { papersAdded: 0, papersKept: 2, studyMerged: 0, notesAdded: 0, readingAdded: 0, tagsMerged: 0, aliasesAdded: 0 } });
  });

  it("leaves out the records of a paper that is not here, and still reads the first kind of file", async () => {
    await saveStoredProject(paper("attention", "Attention Is All You Need"));
    await saveReaderNotes("attention", [note("n1", "Only here.")]);
    const light = await (await exportData(new Request("http://127.0.0.1/api/profile/data?papers=0"))).json();
    rmSync(workspace, { recursive: true, force: true });
    expect((await post(light)).library).toMatchObject({ notesAdded: 0, withoutPaper: 1 });
    expect(await post({ kind: "trace-work-data", version: 1, log: { version: 1, sessions: [session("old", 0)], archive: {} } })).toMatchObject({ added: 1 });
    expect((await importData(new Request("http://127.0.0.1/api/profile/data", { method: "POST", body: JSON.stringify({ kind: "trace-work-data", version: 3, log: { version: 1, sessions: [], archive: {} } }) }))).status).toBe(400);
  });
});
