import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { researchProjectSchema, type ResearchProject } from "./schema";

/**
 * Köprünün `verify` komutu. Sayfa metni `--pages` ile veriliyor, böylece test
 * `pdftotext` kurulu olmayan makinede de çalışıyor; metin örnek projenin kendi
 * alıntılarından kuruluyor.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const BRIDGE = join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs");

let workspace: string;
let projectPath: string;
let pagesPath: string;

function bridge(...args: string[]) {
  const run = spawnSync(process.execPath, [BRIDGE, ...args], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: join(workspace, "data") } });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function pagesFor(project: ResearchProject) {
  const pages: string[] = Array.from({ length: 15 }, () => "Filler sentence so that the page is never empty. ".repeat(8));
  const put = (reference?: { sourceId: string; page?: number; excerpt: string }) => {
    if (reference?.sourceId === "paper" && reference.page) pages[reference.page - 1] += `\n${reference.excerpt}\n`;
  };
  project.evidence.claims.forEach((claim) => claim.sourceRefs.forEach(put));
  project.evidence.metrics.forEach((metric) => put(metric.sourceRef));
  project.evidence.glossary.forEach((item) => put(item.sourceRef));
  return pages.map((page, index) => `--- PAGE ${index + 1} ---\n${page}`).join("\n\n");
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-verify-"));
  projectPath = join(workspace, "paper.trace.json");
  pagesPath = join(workspace, "paper.pages.txt");
  const project = loadExampleProject("attention-is-all-you-need.en.trace.json");
  delete project.excerptCheck;
  writeFileSync(pagesPath, pagesFor(project));
  writeFileSync(projectPath, JSON.stringify(project, null, 2));
});

afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe("trace-agent verify", () => {
  it("her alıntı bulunduğunda denetimi projeye yazar ve hiçbir iddiaya dokunmaz", () => {
    const run = bridge("verify", "--project", projectPath, "--pages", pagesPath);
    expect(run.status).toBe(0);
    const summary = JSON.parse(run.stdout);
    expect(summary.notFound).toEqual([]);
    expect(summary.found).toBe(summary.checked);

    const written = researchProjectSchema.parse(JSON.parse(readFileSync(projectPath, "utf8")));
    expect(written.excerptCheck?.checked).toBe(summary.checked);
    expect(written.evidence.claims).toEqual(loadExampleProject("attention-is-all-you-need.en.trace.json").evidence.claims);
    expect(JSON.parse(bridge("validate", "--project", projectPath).stdout).excerptCheck.notFound).toBe(0);
  });

  it("uydurma alıntıyı bulur ve iddiayı needs-review yapar", () => {
    const project = JSON.parse(readFileSync(projectPath, "utf8")) as ResearchProject;
    const target = project.evidence.claims.find((claim) => claim.confidence === "verified" && claim.sourceRefs.length === 1)!;
    target.sourceRefs[0].excerpt = "a sentence that the authors never wrote anywhere in this paper";
    writeFileSync(projectPath, JSON.stringify(project, null, 2));

    const summary = JSON.parse(bridge("verify", "--project", projectPath, "--pages", pagesPath).stdout);
    expect(summary.notFound).toEqual([{ owner: "claim", id: target.id, page: target.sourceRefs[0].page }]);
    expect(summary.downgradedToNeedsReview).toEqual([target.id]);
    const written = JSON.parse(readFileSync(projectPath, "utf8")) as ResearchProject;
    expect(written.evidence.claims.find((claim) => claim.id === target.id)?.confidence).toBe("needs-review");
  });

  it("yanlış makalenin metniyle projeye dokunmaz", () => {
    writeFileSync(pagesPath, Array.from({ length: 6 }, (_, index) => `--- PAGE ${index + 1} ---\n${"An unrelated paper about marine biology and coral reefs. ".repeat(12)}`).join("\n\n"));
    const before = readFileSync(projectPath, "utf8");
    const run = bridge("verify", "--project", projectPath, "--pages", pagesPath);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/probably not the PDF/);
    expect(readFileSync(projectPath, "utf8")).toBe(before);
  });
});
