import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import {
  TRACE_ACCENT_PALETTE,
  allocatePaperAccent,
  deleteStoredProject,
  listStoredProjects,
  saveStoredProject,
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
