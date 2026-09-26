import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { paperYear, parseLibraryLayout, parseLibrarySort, sortLibrary } from "./library-order";
import type { ResearchProject } from "./schema";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");

function paper(id: string, title: string, year: string, updatedAt: string): ResearchProject {
  const project = structuredClone(example);
  return { ...project, id, updatedAt, evidence: { ...project.evidence, paper: { ...project.evidence.paper, title, year } } };
}

const library = [
  paper("vit", "An Image Is Worth 16x16 Words", "2020", "2026-09-01T00:00:00.000Z"),
  paper("attention", "Attention Is All You Need", "2017", "2026-09-03T00:00:00.000Z"),
  paper("undated", "A note without a year", "n.d.", "2026-09-04T00:00:00.000Z"),
  paper("ddpm", "denoising diffusion probabilistic models", "NeurIPS 2020", "2026-09-02T00:00:00.000Z"),
  paper("resnet", "Deep Residual Learning", "2015", "2026-08-01T00:00:00.000Z"),
];
const ids = (projects: ResearchProject[]) => projects.map((project) => project.id);

describe("library order", () => {
  it("keeps the most recently updated first by default", () => {
    expect(ids(sortLibrary(library, "updated"))).toEqual(["undated", "attention", "ddpm", "vit", "resnet"]);
  });

  it("sorts titles alphabetically whatever their case", () => {
    expect(ids(sortLibrary(library, "title"))).toEqual(["vit", "undated", "attention", "resnet", "ddpm"]);
  });

  it("sorts by the paper's year both ways, papers without a year last, ties by most recent update", () => {
    expect(ids(sortLibrary(library, "newest"))).toEqual(["ddpm", "vit", "attention", "resnet", "undated"]);
    expect(ids(sortLibrary(library, "oldest"))).toEqual(["resnet", "attention", "ddpm", "vit", "undated"]);
  });

  it("reads the year out of how it is written", () => {
    expect(paperYear(paper("a", "t", "NeurIPS 2020", ""))).toBe(2020);
    expect(paperYear(paper("b", "t", "2017a", ""))).toBe(2017);
    expect(paperYear(paper("c", "t", "12345", ""))).toBeUndefined();
    expect(paperYear(paper("d", "t", "", ""))).toBeUndefined();
  });

  it("does not reorder the library it was given", () => {
    const before = ids(library);
    sortLibrary(library, "title");
    expect(ids(library)).toEqual(before);
  });

  it("falls back to the defaults for anything it does not know", () => {
    expect(parseLibrarySort("title")).toBe("title");
    expect(parseLibrarySort("random")).toBe("updated");
    expect(parseLibraryLayout("list")).toBe("list");
    expect(parseLibraryLayout(null)).toBe("grid");
  });
});
