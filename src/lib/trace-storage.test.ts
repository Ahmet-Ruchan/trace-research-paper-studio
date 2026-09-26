import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import {
  TRACE_ACCENT_PALETTE,
  allocatePaperAccent,
  deleteStoredProject,
  listProjectRevisions,
  listStoredProjects,
  readLibraryTags,
  saveStoredProject,
  saveStoredProjectTags,
} from "./trace-storage";

let workspace: string;
let previousDataDirectory: string | undefined;
let previousLibraryDirectory: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-storage-"));
  previousDataDirectory = process.env.TRACE_DATA_DIR;
  previousLibraryDirectory = process.env.TRACE_LIBRARY_DIR;
  process.env.TRACE_DATA_DIR = workspace;
  delete process.env.TRACE_LIBRARY_DIR;
});

afterEach(() => {
  if (previousDataDirectory === undefined) delete process.env.TRACE_DATA_DIR;
  else process.env.TRACE_DATA_DIR = previousDataDirectory;
  if (previousLibraryDirectory === undefined) delete process.env.TRACE_LIBRARY_DIR;
  else process.env.TRACE_LIBRARY_DIR = previousLibraryDirectory;
  rmSync(workspace, { recursive: true, force: true });
});

describe("paper accent cycle", () => {
  it("uses every shuffled color once before wrapping", async () => {
    const firstCycle: Awaited<ReturnType<typeof allocatePaperAccent>>[] = [];
    for (let index = 0; index < 20; index += 1) {
      firstCycle.push(await allocatePaperAccent(`paper-${index}`));
    }
    const colors = firstCycle.map((assignment) => assignment.accent);
    expect(new Set(colors)).toEqual(new Set(TRACE_ACCENT_PALETTE));
    expect(new Set(colors).size).toBe(20);

    const wrapped = await allocatePaperAccent("paper-20");
    expect(wrapped.accent).toBe(colors[0]);
    expect(wrapped.cycle).toBe(2);
  });

  it("keeps the same paper on its original color without consuming a slot", async () => {
    const first = await allocatePaperAccent("same-paper");
    const repeated = await allocatePaperAccent("same-paper");
    const next = await allocatePaperAccent("next-paper");

    expect(repeated).toMatchObject({ accent: first.accent, paletteIndex: first.paletteIndex, reused: true });
    expect(next.paletteIndex).toBe(1);
  });
});

describe("file-backed Trace library", () => {
  it("persists, updates, lists and completely deletes a project file", async () => {
    const project = { ...loadExampleProject(), id: "persistent-library-test" };
    const path = await saveStoredProject(project);
    expect(path.startsWith(join(workspace, "library"))).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect((await listStoredProjects()).map((item) => item.id)).toContain(project.id);

    expect(await deleteStoredProject(project.id)).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect((await listStoredProjects()).map((item) => item.id)).not.toContain(project.id);
  });
});

describe("library tags", () => {
  const tagsFile = () => join(workspace, "library", "tags.json");

  it("keeps tags beside the library, never inside the project or its history", async () => {
    const project = { ...loadExampleProject(), id: "tagged-paper" };
    const path = await saveStoredProject(project);
    const before = readFileSync(path, "utf8");

    expect(await saveStoredProjectTags(project.id, [" #NLP ", "nlp", "to read"])).toEqual(["NLP", "to read"]);
    expect(await readLibraryTags()).toEqual(new Map([["tagged-paper", ["NLP", "to read"]]]));

    // Proje dosyası, sırası ve geçmişi etiketten habersiz.
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(await listProjectRevisions(project.id)).toEqual([]);
    expect((await listStoredProjects()).map((item) => item.id)).toEqual(["tagged-paper"]);
    expect(readdirSync(join(workspace, "library")).filter((name) => name.endsWith(".lock"))).toEqual([]);
  });

  it("does not create a file for a paper without tags, and forgets a deleted paper's tags", async () => {
    const kept = { ...loadExampleProject(), id: "kept" };
    const removed = { ...loadExampleProject(), id: "removed" };
    await saveStoredProject(kept);
    await saveStoredProject(removed);

    await saveStoredProjectTags(kept.id, []);
    expect(existsSync(tagsFile())).toBe(false);

    await saveStoredProjectTags(kept.id, ["Vision"]);
    await saveStoredProjectTags(removed.id, ["Vision", "Old"]);
    await deleteStoredProject(removed.id);
    expect(await readLibraryTags()).toEqual(new Map([["kept", ["Vision"]]]));

    await saveStoredProjectTags(kept.id, []);
    expect(JSON.parse(readFileSync(tagsFile(), "utf8"))).toEqual({ version: 1, projects: [] });
  });

  it("keeps concurrent writes for different papers", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => saveStoredProjectTags(`paper-${index}`, [`tag ${index}`])),
    );
    expect((await readLibraryTags()).size).toBe(8);
  });

  it("moves a damaged tags file aside instead of writing over it", async () => {
    mkdirSync(join(workspace, "library"), { recursive: true });
    writeFileSync(tagsFile(), "{ this is not json");

    expect((await readLibraryTags()).size).toBe(0);
    await saveStoredProjectTags("paper", ["NLP"]);

    const names = readdirSync(join(workspace, "library"));
    const damaged = names.find((name) => /^tags\.damaged-\d{8}T\d{9}Z\.json$/.test(name));
    expect(damaged).toBeDefined();
    expect(readFileSync(join(workspace, "library", damaged!), "utf8")).toBe("{ this is not json");
    expect(await readLibraryTags()).toEqual(new Map([["paper", ["NLP"]]]));
  });

  it("refuses a tag list the studio would refuse", async () => {
    await expect(saveStoredProjectTags("paper", ["x".repeat(41)])).rejects.toThrow();
    expect(existsSync(tagsFile())).toBe(false);
  });
});
