import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { EDIT_COALESCE_MS, REVISION_LIMIT } from "./project-revisions";
import type { ResearchProject } from "./schema";
import {
  createProjectRevision,
  deleteStoredProject,
  listProjectRevisions,
  listStoredProjects,
  projectRevisionDirectory,
  readProjectRevision,
  saveStoredProject,
} from "./trace-storage";

/**
 * Geçmişin diskteki davranışı: hangi kayıt iz bırakıyor, sürümler kütüphane
 * listesine sızmıyor mu, limit tutuyor mu, proje silinince geçmiş de gidiyor mu.
 */
let workspace: string;
let previousDataDirectory: string | undefined;
let clock = Date.UTC(2026, 8, 16, 8, 0, 0);

const project = (title = "Original"): ResearchProject => {
  const base = structuredClone(loadExampleProject());
  return { ...base, id: "revision-test", story: { ...base.story, title } };
};

function advance(ms: number) {
  clock += ms;
  vi.setSystemTime(clock);
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-revisions-"));
  previousDataDirectory = process.env.TRACE_DATA_DIR;
  process.env.TRACE_DATA_DIR = workspace;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  if (previousDataDirectory === undefined) delete process.env.TRACE_DATA_DIR;
  else process.env.TRACE_DATA_DIR = previousDataDirectory;
  rmSync(workspace, { recursive: true, force: true });
});

describe("project history on disk", () => {
  it("keeps the replaced version for edits at most every ten minutes", async () => {
    await saveStoredProject(project("v1"));
    expect(await listProjectRevisions("revision-test")).toEqual([]);

    advance(1_000);
    await saveStoredProject(project("v2"));
    advance(1_000);
    await saveStoredProject(project("v3"));
    let revisions = await listProjectRevisions("revision-test");
    expect(revisions.map((revision) => revision.title)).toEqual(["v1"]);

    advance(EDIT_COALESCE_MS);
    await saveStoredProject(project("v4"));
    revisions = await listProjectRevisions("revision-test");
    expect(revisions.map((revision) => revision.title)).toEqual(["v3", "v1"]);
  });

  it("always keeps the version before a regeneration, and restores it intact", async () => {
    await saveStoredProject(project("before"));
    advance(1_000);
    await saveStoredProject(project("after"), { reason: "regenerate" });

    const [revision] = await listProjectRevisions("revision-test");
    expect(revision).toMatchObject({ reason: "regenerate", title: "before", claims: loadExampleProject().evidence.claims.length });
    const loaded = await readProjectRevision("revision-test", revision.id);
    expect(loaded?.project.story.title).toBe("before");
    expect(JSON.stringify(loaded?.project.evidence)).toBe(JSON.stringify(loadExampleProject().evidence));
  });

  it("does not record a save that changed nothing but the timestamp", async () => {
    const saved = project("same");
    await saveStoredProject(saved);
    advance(EDIT_COALESCE_MS * 2);
    await saveStoredProject({ ...saved, updatedAt: new Date().toISOString() }, { reason: "import" });
    expect(await listProjectRevisions("revision-test")).toEqual([]);
  });

  it("marks a named version on request", async () => {
    await saveStoredProject(project("named"));
    const revision = await createProjectRevision("revision-test", "Sent to reviewers");
    expect(revision).toMatchObject({ reason: "manual", label: "Sent to reviewers", title: "named" });
    expect(await createProjectRevision("no-such-project")).toBeUndefined();
  });

  it("keeps old versions out of the library list", async () => {
    await saveStoredProject(project("v1"));
    advance(1_000);
    await saveStoredProject(project("v2"), { reason: "regenerate" });
    const listed = await listStoredProjects();
    expect(listed.filter((item) => item.id === "revision-test").map((item) => item.story.title)).toEqual(["v2"]);
  });

  it("caps the history and prunes the oldest", async () => {
    await saveStoredProject(project("v0"));
    for (let index = 1; index <= REVISION_LIMIT + 3; index += 1) {
      advance(1_000);
      await saveStoredProject(project(`v${index}`), { reason: "regenerate" });
    }
    const revisions = await listProjectRevisions("revision-test");
    expect(revisions).toHaveLength(REVISION_LIMIT);
    expect(revisions[0].title).toBe(`v${REVISION_LIMIT + 2}`);
    expect(revisions.at(-1)!.title).toBe("v3");
  });

  it("refuses revision ids that could leave the history directory", async () => {
    await saveStoredProject(project("v1"));
    expect(await readProjectRevision("revision-test", "../../library/x")).toBeUndefined();
    expect(await readProjectRevision("revision-test", "20260916T081530123Z-edit-zzzzzzzz")).toBeUndefined();
  });

  it("reads the versions the agent bridge leaves behind", async () => {
    // Köprü bağımlılıksız bir .mjs; stüdyo onun yazdığı revizyonları AYNI
    // kurallarla okuyabilmeli, yoksa ajanla yapılan değişiklik geri alınamaz.
    const bridgeModule = "../../plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs";
    const bridge = (await import(/* @vite-ignore */ bridgeModule)) as {
      persistLibraryProject: (project: ResearchProject, reason?: string) => string;
    };
    bridge.persistLibraryProject(project("agent v1"));
    advance(1_000);
    bridge.persistLibraryProject(project("agent v2"), "regenerate");
    advance(1_000);
    bridge.persistLibraryProject(project("agent v3"));

    const revisions = await listProjectRevisions("revision-test");
    expect(revisions.map((revision) => [revision.reason, revision.title])).toEqual([
      ["agent", "agent v2"],
      ["regenerate", "agent v1"],
    ]);
    expect((await listStoredProjects()).find((item) => item.id === "revision-test")?.story.title).toBe("agent v3");
  });

  it("removes the history with the project", async () => {
    await saveStoredProject(project("v1"));
    advance(1_000);
    await saveStoredProject(project("v2"), { reason: "regenerate" });
    const directory = projectRevisionDirectory("revision-test");
    expect(readdirSync(directory)).toHaveLength(1);

    await deleteStoredProject("revision-test");
    expect(existsSync(directory)).toBe(false);
  });
});
