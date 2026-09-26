import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";

/**
 * Köprünün `record` komutu: stüdyodaki "Model record" ekranının ajan tarafı.
 * Kütüphane geçici bir veri dizininde kuruluyor; köprü yalnızca okuyor.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const BRIDGE = join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs");

let workspace: string;

function bridge(...args: string[]) {
  const run = spawnSync(process.execPath, [BRIDGE, ...args], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: workspace, TRACE_LIBRARY_DIR: "" } });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-record-"));
});

afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe("trace-agent record", () => {
  it("reports each model's quotes from the library, and counts what it could not read", () => {
    const library = join(workspace, "library");
    mkdirSync(join(library, "revisions"), { recursive: true });
    const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
    const gemini = { ...example, id: "gemini-copy", generation: { provider: "gemini", model: "gemini-3.7-flash" } };
    gemini.excerptCheck = { ...example.excerptCheck!, unlocated: [{ owner: "claim", id: example.evidence.claims[0].id, page: 2 }] };
    const unchecked = { ...example, id: "unchecked", excerptCheck: undefined };
    writeFileSync(join(library, "project-a.trace.json"), JSON.stringify(example));
    writeFileSync(join(library, "project-b.trace.json"), JSON.stringify(gemini));
    writeFileSync(join(library, "project-c.trace.json"), JSON.stringify(unchecked));
    writeFileSync(join(library, "project-d.trace.json"), "{ damaged");
    // Kütüphanenin yanındaki diğer dosyalar proje değil.
    writeFileSync(join(library, "tags.json"), JSON.stringify({ version: 1, projects: [] }));

    const run = bridge("record");
    expect(run.status).toBe(0);
    const record = JSON.parse(run.stdout);
    expect(record).toMatchObject({ ok: true, library, projects: 4, unreadable: 1, counted: 2 });
    expect(record.models.map((row: { model: string; quotesFound: number; quotesChecked: number }) => [row.model, row.quotesFound, row.quotesChecked])).toEqual([
      ["Agent · claude-code/claude-opus-5[1m]", 67, 67],
      ["Google Gemini · gemini-3.7-flash", 66, 67],
    ]);
    expect(record.samePaper).toHaveLength(1);
    expect(record.notCounted).toEqual([
      {
        projectId: "unchecked",
        title: example.evidence.paper.title,
        reason: "not-checked",
        detail: "Its quotes were never checked against the PDF.",
        file: join(library, "project-c.trace.json"),
      },
    ]);
    expect(record.note).toContain("not always invented");
  });

  it("says an empty library has nothing to report", () => {
    const run = bridge("record");
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, projects: 0, counted: 0, models: [], notCounted: [] });
  });
});
