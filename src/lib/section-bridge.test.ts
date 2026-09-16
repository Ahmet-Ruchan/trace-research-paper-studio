import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";

/**
 * Plugin'de bölüm yeniden üretimi iki komut: `section` kilidi ve istemi
 * yazıyor, `splice` ajanın yazdığı bölümü takıyor. Korunan vaat şu: kontrol
 * başarısızsa proje dosyasının tek baytı değişmez.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const BRIDGE = join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs");

let workspace: string;
let projectPath: string;

function bridge(...args: string[]) {
  const run = spawnSync(process.execPath, [BRIDGE, ...args], {
    encoding: "utf8",
    env: { ...process.env, TRACE_DATA_DIR: join(workspace, "data") },
  });
  const text = run.status === 0 ? run.stdout : run.stderr;
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: run.status, json };
}

function writeSection(briefPath: string, patch: Record<string, unknown>) {
  const brief = JSON.parse(readFileSync(briefPath, "utf8"));
  const sectionPath = briefPath.replace(/\.brief\.json$/, ".section.json");
  writeFileSync(sectionPath, JSON.stringify({ ...brief.currentSection, ...patch }));
  return sectionPath;
}

const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-section-"));
  mkdirSync(join(workspace, "job"));
  projectPath = join(workspace, "job", "paper.trace.json");
  writeFileSync(projectPath, JSON.stringify(loadExampleProject(), null, 2));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("section bridge", () => {
  it("writes a brief and a prompt, then splices a valid section", () => {
    const prepared = bridge("section", "--project", projectPath, "--target", "report:report-critique", "--instruction", "Name the cost.");
    expect(prepared.status).toBe(0);
    const briefPath = String(prepared.json.briefPath);
    expect(readFileSync(String(prepared.json.promptPath), "utf8")).toContain("<<<REQUEST\nName the cost.\nREQUEST>>>");

    writeSection(briefPath, { analysis: ["A new first point.", "A new second point."] });
    const spliced = bridge("splice", "--brief", briefPath);
    expect(spliced.status).toBe(0);

    const project = JSON.parse(readFileSync(projectPath, "utf8"));
    expect(project.deepReport.sections.find((item: { id: string }) => item.id === "report-critique").analysis)
      .toEqual(["A new first point.", "A new second point."]);
    expect(JSON.stringify(project.evidence)).toBe(JSON.stringify(loadExampleProject().evidence));
    // Değiştirilen sürüm geri alınabilsin diye saklanıyor.
    const previous = JSON.parse(readFileSync(String(spliced.json.previousPath), "utf8"));
    expect(previous.analysis).toEqual(loadExampleProject().deepReport!.sections.find((item) => item.id === "report-critique")!.analysis);
    expect(bridge("validate", "--project", projectPath).status).toBe(0);
  });

  it("leaves the project byte-identical when the section breaks a lock", () => {
    const prepared = bridge("section", "--project", projectPath, "--target", "story:story-tradeoff");
    const briefPath = String(prepared.json.briefPath);
    writeSection(briefPath, { body: "Rewritten.", claimIds: ["claim-result-04"] });
    const before = hash(projectPath);

    const spliced = bridge("splice", "--brief", briefPath);
    expect(spliced.status).toBe(1);
    expect(JSON.stringify(spliced.json.issues)).toMatch(/claims are locked/);
    expect(hash(projectPath)).toBe(before);
  });

  it("refuses a section written before the evidence changed", () => {
    const prepared = bridge("section", "--project", projectPath, "--target", "story:story-tradeoff", "--claims", "open");
    const briefPath = String(prepared.json.briefPath);
    writeSection(briefPath, { body: "Rewritten." });

    const project = JSON.parse(readFileSync(projectPath, "utf8"));
    project.evidence.claims[0].sourceRefs[0].excerpt += " (edited)";
    writeFileSync(projectPath, JSON.stringify(project, null, 2));

    const spliced = bridge("splice", "--brief", briefPath);
    expect(spliced.status).toBe(1);
    expect(JSON.stringify(spliced.json.issues)).toMatch(/evidence changed/);
  });

  it("refreshes the studio's library copy when the project was delivered", () => {
    const project = loadExampleProject();
    const libraryFile = join(
      workspace,
      "data",
      "library",
      `project-${createHash("sha256").update(project.id).digest("hex").slice(0, 24)}.trace.json`,
    );
    mkdirSync(join(workspace, "data", "library"), { recursive: true });
    writeFileSync(libraryFile, JSON.stringify(project));

    const prepared = bridge("section", "--project", projectPath, "--target", "story:story-tradeoff");
    writeSection(String(prepared.json.briefPath), { title: "Library sees this." });
    const spliced = bridge("splice", "--brief", String(prepared.json.briefPath));

    expect(spliced.json.libraryUpdated).toBe(true);
    expect(existsSync(libraryFile)).toBe(true);
    const stored = JSON.parse(readFileSync(libraryFile, "utf8"));
    expect(stored.story.sections.find((item: { id: string }) => item.id === "story-tradeoff").title).toBe("Library sees this.");
  });

  it("explains a bad target instead of writing anything", () => {
    const prepared = bridge("section", "--project", projectPath, "--target", "story:no-such-section");
    expect(prepared.status).toBe(1);
    expect((prepared.json.issues as string[]).join(" ")).toMatch(/no story section with id "no-such-section"/);
    expect(existsSync(join(workspace, "job", "revisions"))).toBe(false);

    const policy = bridge("section", "--project", projectPath, "--target", "story:story-tradeoff", "--claims", "loose");
    expect(policy.status).toBe(1);
    expect(JSON.stringify(policy.json.issues)).toMatch(/--claims must be/);
  });
});
