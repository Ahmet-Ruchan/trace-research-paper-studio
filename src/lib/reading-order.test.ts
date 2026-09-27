import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { readFirst, readingOrder, studyStatus } from "./reading-order";
import type { ResearchProject } from "./schema";
import { completeStep, visitStep, type StudyProgress } from "./study-path";

const english = loadExampleProject("attention-is-all-you-need.en.trace.json");
const T0 = "2026-09-01T00:00:00.000Z";

/** Örnekten türetilmiş bir makale: kendi başlığı, yılı, varsaydıkları ve tanımladıkları. */
function paper(id: string, title: string, year: string, assumes: string[], defines: string[]): ResearchProject {
  const base = english.primer!.concepts[0];
  return {
    ...english,
    id,
    evidence: {
      ...english.evidence,
      paper: { ...english.evidence.paper, title, year },
      glossary: defines.map((term) => ({ term, definition: `${term}, as this paper defines it.` })),
    },
    primer: {
      ...english.primer!,
      concepts: [...assumes, "Filler one", "Filler two", "Filler three"].slice(0, Math.max(3, assumes.length)).map((term, index) => ({
        ...base,
        id: `${id}-c${index}`,
        term,
        prerequisiteIds: [],
      })),
    },
  };
}

// Eski bir makale Transformer'ın varsaydığını tanımlıyor; yenisi Transformer'ın tanımladığını varsayıyor.
const older = paper("older", "An older paper", "2014", ["Softmax", "Dot product", "Variance and scale"], ["Encoder-decoder and auto-regression", "Beam search"]);
const newer = paper("newer", "A newer paper", "2018", ["Multi-head attention", "Positional encodings", "Label smoothing"], ["Masked language modelling"]);
const noStudy = new Map<string, StudyProgress>();

describe("a reading order for the library", () => {
  it("puts a paper before the ones that assume what it defines", () => {
    const order = readingOrder([newer, english, older], noStudy);
    expect(order.steps.map((step) => step.project.id)).toEqual(["older", english.id, "newer"]);
    expect(order.steps[1].after).toEqual([{ project: older, concepts: [{ term: "Encoder-decoder and auto-regression", definedAs: "Encoder-decoder and auto-regression" }] }]);
    // Adı yazımından bağımsız eşleşiyor: "Positional encodings" ↔ sözlükteki "Positional encoding".
    expect(order.steps[2].after[0].concepts.map((item) => [item.term, item.definedAs])).toEqual([
      ["Multi-head attention", "Multi-head attention"],
      ["Positional encodings", "Positional encoding"],
      ["Label smoothing", "Label smoothing"],
    ]);
    expect(order.next?.id).toBe("older");
    expect(order.unconnected).toBe(0);
  });

  it("says which paper to read next, and counts a re-analysis of a paper as the same paper", () => {
    const finished = { ...completeStep(undefined, "start", "finish", T0), finishedAt: T0 };
    const again = { ...english, id: "english-again" };
    const study = new Map<string, StudyProgress>([["older", finished], ["english-again", visitStep(completeStep(undefined, "start", "x", T0), "x", T0)]]);
    const order = readingOrder([newer, english, again, older], study);
    expect(order.steps.map((step) => [step.project.id, step.status])).toEqual([["older", "finished"], ["english-again", "started"], ["newer", "new"]]);
    expect(order.next?.id).toBe("english-again");
    expect(studyStatus(undefined)).toBe("new");
  });

  it("leaves out papers nothing connects, and does not invent an order for papers that need each other", () => {
    const loner = paper("loner", "A paper on something else", "2010", ["Graph theory"], ["Treewidth"]);
    const graphs = paper("graphs", "Graph pooling, defined", "2018", ["Kernel trick"], ["Graph pooling"]);
    const kernels = paper("kernels", "Kernels, defined", "2019", ["Graph pooling"], ["Kernel trick"]);
    const order = readingOrder([kernels, graphs, loner], noStudy);
    expect(order.unconnected).toBe(1);
    expect(order.steps.map((step) => step.project.id)).toEqual(["graphs", "kernels"]);
    expect(order.steps[0].together.map((item) => item.id)).toEqual(["kernels"]);
    expect(order.steps[1].after[0].project.id).toBe("graphs");
    expect(readingOrder([english], noStudy)).toEqual({ steps: [], next: undefined, unconnected: 1 });
  });

  it("does not count a term a paper both assumes and lists in its glossary as defined by it", () => {
    const both = paper("both", "A paper that assumes it too", "2012", ["Multi-head attention", "Softmax", "Dot product"], ["Multi-head attention"]);
    expect(readFirst(newer, [both], noStudy)).toEqual([]);
  });

  it("tells a paper which papers of the library to read first, the most helpful first", () => {
    const small = paper("small", "Defines one of them", "2016", ["Softmax", "Dot product", "Embedding vector"], ["Label smoothing"]);
    const first = readFirst(newer, [english, small, newer], noStudy);
    expect(first.map((item) => [item.project.id, item.concepts.length, item.status])).toEqual([[english.id, 3, "new"], ["small", 1, "new"]]);
  });
});

describe("the reading order for agents", () => {
  it("prints the library's reading order and what to read before a paper", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const workspace = mkdtempSync(join(tmpdir(), "trace-reading-order-"));
    try {
      mkdirSync(join(workspace, "data", "library"), { recursive: true });
      for (const item of [older, english, newer]) writeFileSync(join(workspace, "data", "library", `${item.id}.trace.json`), JSON.stringify(item));
      writeFileSync(join(workspace, "newer.trace.json"), JSON.stringify(newer));
      const bridge = (...args: string[]) => {
        const run = spawnSync(process.execPath, [join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs"), ...args], {
          encoding: "utf8",
          env: { ...process.env, TRACE_DATA_DIR: join(workspace, "data") },
        });
        expect(run.status).toBe(0);
        return JSON.parse(run.stdout) as unknown;
      };
      const map = bridge("concepts") as { readingOrder: { steps: Array<{ projectId: string; after: Array<{ projectId: string }> }>; next: { projectId: string } } };
      expect(map.readingOrder.steps.map((step) => step.projectId)).toEqual(["older", english.id, "newer"]);
      expect(map.readingOrder.steps[2].after.map((item) => item.projectId)).toEqual([english.id]);
      expect(map.readingOrder.next.projectId).toBe("older");
      const one = bridge("concepts", "--project", join(workspace, "newer.trace.json")) as { readFirst: Array<{ projectId: string; status: string; defines: Array<{ term: string }> }> };
      expect(one.readFirst).toMatchObject([{ projectId: english.id, status: "new" }]);
      expect(one.readFirst[0].defines.map((item) => item.term)).toEqual(["Multi-head attention", "Positional encodings", "Label smoothing"]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
