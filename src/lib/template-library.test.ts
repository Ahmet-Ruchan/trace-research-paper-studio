import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET, PUT } from "@/app/api/templates/route";
import { loadExampleProject } from "./example-fixture";
import { builtInTemplates, templateFromProject } from "./narrative-templates";
import { listStoredTemplates } from "./trace-storage";

/**
 * Şablonlar makineye ait: stüdyonun kaydettiğini ajan, ajanın kaydettiğini
 * stüdyo görmeli.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const BRIDGE = join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs");
let workspace: string;
let previousDataDirectory: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-templates-"));
  previousDataDirectory = process.env.TRACE_DATA_DIR;
  process.env.TRACE_DATA_DIR = workspace;
});

afterEach(() => {
  if (previousDataDirectory === undefined) delete process.env.TRACE_DATA_DIR;
  else process.env.TRACE_DATA_DIR = previousDataDirectory;
  rmSync(workspace, { recursive: true, force: true });
});

function bridge(...args: string[]) {
  const run = spawnSync(process.execPath, [BRIDGE, ...args], {
    encoding: "utf8",
    cwd: workspace,
    env: { ...process.env, TRACE_DATA_DIR: workspace },
  });
  const text = run.status === 0 ? run.stdout : run.stderr;
  try {
    return { status: run.status, json: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: run.status, json: { raw: text } as Record<string, unknown> };
  }
}

const url = "http://127.0.0.1/api/templates";

describe("template library", () => {
  it("lists built-ins, saves and deletes a template through the API", async () => {
    const template = templateFromProject(loadExampleProject(), { name: "Reading group" });
    expect((await PUT(new Request(url, { method: "PUT", body: JSON.stringify(template) }))).status).toBe(200);

    const listed = await (await GET()).json();
    expect(listed.templates.map((item: { id: string }) => item.id)).toEqual([
      ...builtInTemplates.map((item) => item.id),
      template.id,
    ]);

    expect((await DELETE(new Request(`${url}?id=${template.id}`, { method: "DELETE" }))).status).toBe(200);
    expect(await listStoredTemplates()).toEqual([]);
  });

  it("refuses unusable templates, built-in ids and unsafe ids", async () => {
    const template = templateFromProject(loadExampleProject(), { name: "Flat" });
    const flat = { ...template, story: template.story.map((slot) => ({ ...slot, visual: "concept" })) };
    const rejected = await PUT(new Request(url, { method: "PUT", body: JSON.stringify(flat) }));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toMatch(/three different visual types/);

    const shadow = { ...builtInTemplates[0], builtIn: false };
    expect((await (await PUT(new Request(url, { method: "PUT", body: JSON.stringify(shadow) }))).json()).error).toMatch(/built-in/);
    expect((await DELETE(new Request(`${url}?id=../x`, { method: "DELETE" }))).status).toBe(400);
  });

  it("shares templates between the agent bridge and the studio", () => {
    const projectPath = join(workspace, "paper.trace.json");
    writeFileSync(projectPath, JSON.stringify(loadExampleProject()));

    const saved = bridge("save-template", "--project", projectPath, "--name", "Agent template");
    expect(saved.status).toBe(0);
    const listed = bridge("templates");
    expect((listed.json.templates as Array<{ id: string }>).map((item) => item.id)).toContain(saved.json.id);
    return listStoredTemplates().then((templates) => {
      expect(templates.map((item) => item.name)).toEqual(["Agent template"]);
    });
  });

  it("puts the template into the job so the agent follows it", () => {
    const pdf = join(workspace, "tiny.pdf");
    writeFileSync(pdf, "%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
    mkdirSync(join(workspace, "job"));

    const prepared = bridge("prepare", "--paper", pdf, "--language", "en", "--depth", "deep", "--template", "results-briefing", "--out", join(workspace, "job"));
    expect(prepared.status).toBe(0);
    const job = JSON.parse(readFileSync(String(prepared.json.jobPath), "utf8"));
    expect(job.targets).toEqual({ storySections: 5, reportSections: 6 });
    expect(job.template.id).toBe("results-briefing");
    expect(job.template.storyInstructions).toContain("Produce exactly 5 sections");

    const unknown = bridge("prepare", "--paper", pdf, "--language", "en", "--template", "no-such-template", "--out", join(workspace, "job"));
    expect(unknown.status).toBe(1);
    expect(String(unknown.json.raw)).toMatch(/No narrative template "no-such-template"/);
  });
});
