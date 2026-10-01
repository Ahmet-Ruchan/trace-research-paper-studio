import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { libraryVault, noteName } from "./obsidian-vault";
import { notesFileToJson, readerNoteSchema, type ReaderNote } from "./reader-notes";
import type { ResearchProject } from "./schema";
import { crc32, zipFiles } from "./zip";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const at = "2026-09-30T10:00:00.000Z";
const attention: ResearchProject = { ...example, id: "attention" };
// Transformer'ın tanımladığı "Multi-head attention"ı varsayan sonraki bir makale.
const later: ResearchProject = {
  ...example,
  id: "later",
  evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "A Later Paper: with/odd*chars", year: "2019", doi: undefined }, glossary: [] },
  primer: { ...example.primer!, concepts: example.primer!.concepts.slice(0, 3).map((item, index) => ({ ...item, id: `later-c${index}`, term: index ? item.term : "Multi-head attention", prerequisiteIds: [] })) },
};
const notes = new Map<string, ReaderNote[]>([["attention", [readerNoteSchema.parse({ id: "n1", target: { kind: "section", place: "report", sectionId: example.deepReport!.sections[0].id }, quote: "a highlighted line", text: "Ask in the seminar.", createdAt: at, updatedAt: at })]]]);

describe("the library as an Obsidian vault", () => {
  it("writes a note per paper with its place in the reading order and the reader's notes, and a note per shared concept", () => {
    const files = libraryVault({ projects: [later, attention], notes, study: new Map(), exportedAt: at });
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    const paper = byPath.get(`Trace/Papers/${example.evidence.paper.title}.md`)!;
    const laterName = noteName(later.evidence.paper.title);
    expect(laterName).toBe("A Later Paper with odd chars");
    expect(paper).toContain(`title: ${JSON.stringify(example.evidence.paper.title)}`);
    expect(paper).toContain("tags: [trace, paper]");
    expect(paper).toContain(`## In the reading order\n\nStep 1 of 2. Before [[${laterName}]].`);
    expect(paper).toContain("## Your notes and highlights");
    expect(paper).toContain("> [!quote] Highlight\n> a highlighted line\n\nAsk in the seminar.");
    expect(paper).not.toMatch(/\n---\n[\s\S]*\n---\n[\s\S]*\n---\n/);
    const second = byPath.get(`Trace/Papers/${laterName}.md`)!;
    expect(second).toContain(`Step 2 of 2. After [[${example.evidence.paper.title}]].`);
    expect(second).toMatch(/- Assumes .*Multi-head attention.*, defined in \[\[Attention Is All You Need\]\]\./);
    expect(second).not.toContain("## Your notes and highlights");
    const concepts = files.filter((file) => file.path.startsWith("Trace/Concepts/"));
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts[0].content).toContain("tags: [trace, concept]");
    expect(concepts[0].content).toMatch(/\[\[(Attention Is All You Need|A Later Paper with odd chars)\]\]/);
    const index = byPath.get("Trace/Trace library.md")!;
    expect(index).toContain("## Reading order\n\n1. [[Attention Is All You Need]] (not started)\n2. [[A Later Paper with odd chars]] (not started)");
    expect(index).toContain("## Shared concepts");
  });

  it("keeps two analyses of one title apart, and lists papers outside the reading order", () => {
    const files = libraryVault({ projects: [attention, { ...attention, id: "again" }], notes: new Map(), study: new Map(), exportedAt: at });
    expect(files.filter((file) => file.path.startsWith("Trace/Papers/")).map((file) => file.path).sort()).toEqual([`Trace/Papers/${example.evidence.paper.title} (2017).md`, `Trace/Papers/${example.evidence.paper.title}.md`].sort());
    expect(files.find((file) => file.path === "Trace/Trace library.md")!.content).toContain("## Papers");
  });

  it("packs the vault into a zip any unzip opens", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const workspace = mkdtempSync(join(tmpdir(), "trace-zip-"));
    try {
      const archive = join(workspace, "vault.zip");
      writeFileSync(archive, zipFiles([{ path: "Trace/Papers/Çalışma ü.md", content: "# Hello\n" }, { path: "Trace/Trace library.md", content: "index\n" }], new Date(2026, 8, 30, 10, 0, 0)));
      const test = spawnSync("unzip", ["-t", archive], { encoding: "utf8" });
      if (test.error) return; // unzip yoksa biçim testi atlanıyor
      expect(test.stdout).toContain("No errors detected");
      expect(spawnSync("unzip", ["-p", archive, "Trace/Papers/Çalışma ü.md"], { encoding: "utf8" }).stdout).toBe("# Hello\n");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("lets an agent write the vault into a folder", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const workspace = mkdtempSync(join(tmpdir(), "trace-vault-"));
    try {
      mkdirSync(join(workspace, "library"), { recursive: true });
      writeFileSync(join(workspace, "library", "attention.trace.json"), JSON.stringify(attention));
      writeFileSync(join(workspace, "library", "later.trace.json"), JSON.stringify(later));
      writeFileSync(join(workspace, "library", "notes.json"), JSON.stringify(notesFileToJson(notes)));
      const run = spawnSync(process.execPath, [join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs"), "obsidian", "--out", join(workspace, "Vault")], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: workspace } });
      expect(run.stderr).toBe("");
      expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, papers: 2 });
      expect(readFileSync(join(workspace, "Vault", "Trace", "Papers", `${example.evidence.paper.title}.md`), "utf8")).toContain("Ask in the seminar.");
      expect(readFileSync(join(workspace, "Vault", "Trace", "Trace library.md"), "utf8")).toContain("## Reading order");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
