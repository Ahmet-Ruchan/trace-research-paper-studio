import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import {
  builtInTemplates,
  reportTemplateIssues,
  storyTemplateIssues,
  templateFromProject,
  templateIssues,
  templateSlotInstruction,
} from "./narrative-templates";
import { validateProjectObject } from "./plugin-validator-entry";
import { buildDeepReportPrompt, buildStoryPrompt } from "./prompts";
import type { NarrativeTemplate, ResearchProject } from "./schema";
import { expectedSectionCounts } from "./section-budgets";
import { buildSectionRegenerationPrompt, spliceSection } from "./section-regeneration";

const fresh = (): ResearchProject => structuredClone(loadExampleProject());
const fromExample = (project = fresh()) =>
  templateFromProject(project, { name: "Reading group", now: "2026-09-16T08:00:00.000Z" });

describe("templates themselves", () => {
  it("ships built-in templates that the integrity rules can satisfy", () => {
    for (const template of builtInTemplates) expect(templateIssues(template)).toEqual([]);
  });

  it("refuses a structure every story generated from it would fail", () => {
    const template: NarrativeTemplate = {
      ...builtInTemplates[0],
      id: "flat",
      story: builtInTemplates[0].story.map((slot) => ({ ...slot, visual: "concept", claimKinds: ["background"] })),
      report: ["contribution", "mechanism", "experiment", "critique", "reproduction", "contribution"],
    };
    const issues = templateIssues(template).join(" ");
    expect(issues).toMatch(/three different visual types/);
    expect(issues).toMatch(/method claims/);
    expect(issues).toMatch(/limitation claims/);
    expect(issues).toMatch(/missing implication/);
  });
});

describe("a template taken from a project", () => {
  it("keeps structure, not content", () => {
    const project = fresh();
    const template = fromExample(project);
    expect(template.id).toBe("reading-group-20260916080000");
    expect(template.story.map((slot) => slot.visual)).toEqual(project.story.sections.map((section) => section.visual.type));
    expect(template.report).toEqual(project.deepReport!.sections.map((section) => section.kind));
    expect(template.story[1]).toEqual({ purpose: "Explain how the method works", visual: "architecture", claimKinds: ["method"] });
    // Bir yöntem ve bir yorum iddiası: beraberlikte bölümün ilk andığı tür kazanır.
    expect(project.story.sections[2].claimIds).toEqual(["claim-method-05", "claim-interpretation-01"]);
    expect(template.story[2]).toMatchObject({ purpose: "Explain how the method works", claimKinds: ["method", "author-interpretation"] });
    // Makalenin kendi başlıkları şablona sızmıyor.
    const text = JSON.stringify(template.story);
    for (const section of project.story.sections) expect(text).not.toContain(section.title);
    expect(templateIssues(template)).toEqual([]);
  });

  it("matches the project it came from", () => {
    const project = fresh();
    const template = fromExample(project);
    expect(storyTemplateIssues(project.story, project.evidence, template)).toEqual([]);
    expect(reportTemplateIssues(project.deepReport!, template)).toEqual([]);
  });
});

describe("holding a story to its template", () => {
  it("flags a wrong visual, a wrong claim kind and a wrong report order", () => {
    const project = fresh();
    const template = fromExample(project);
    project.story.sections[1] = { ...project.story.sections[1], visual: project.story.sections[0].visual, claimIds: ["claim-result-01"] };
    [project.deepReport!.sections[0], project.deepReport!.sections[1]] = [project.deepReport!.sections[1], project.deepReport!.sections[0]];

    const story = storyTemplateIssues(project.story, project.evidence, template).join(" ");
    expect(story).toMatch(/story-architecture: the template asks for an architecture visual here, not concept/);
    expect(story).toMatch(/story-architecture: the template asks this section to cite a method claim/);
    expect(reportTemplateIssues(project.deepReport!, template).join(" ")).toMatch(/asks for a contribution section here, not mechanism/);
  });

  it("lets a numeric slot use another visual when the paper has no metrics", () => {
    const project = fresh();
    const template = fromExample(project);
    const results = project.story.sections.findIndex((section) => section.visual.type === "comparison");
    project.story.sections[results] = { ...project.story.sections[results], visual: project.story.sections[0].visual };
    expect(storyTemplateIssues(project.story, project.evidence, template).join(" ")).toMatch(/comparison visual/);
    expect(storyTemplateIssues(project.story, { ...project.evidence, metrics: [] }, template)).toEqual([]);
  });

  it("sets the section counts instead of the depth", () => {
    const template = builtInTemplates.find((item) => item.id === "results-briefing")!;
    expect(expectedSectionCounts({ depth: "deep" })).toEqual({ story: 8, report: 9 });
    expect(expectedSectionCounts({ depth: "deep", template })).toEqual({ story: 5, report: 6 });
  });

  it("makes the plugin validator enforce the project's own template", () => {
    const project = { ...fresh(), template: fromExample() };
    expect(validateProjectObject(project).ok).toBe(true);
    project.story.sections[1] = { ...project.story.sections[1], visual: project.story.sections[0].visual };
    const outcome = validateProjectObject(project);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.issues.join(" ")).toMatch(/asks for an architecture visual/);
  });
});

describe("templates in prompts", () => {
  const options = { language: "en", audience: "student", depth: "deep" } as const;

  it("leaves the default prompt unchanged without a template", () => {
    const prompt = buildStoryPrompt(fresh().evidence, options);
    expect(prompt).toContain("- Produce exactly 8 sequential sections.\n");
    expect(prompt).toContain("- Build an arc: problem → mechanism/method → important findings → limitations → meaning.");
    expect(buildDeepReportPrompt(fresh().evidence, options)).toContain("Produce exactly 9 sections");
  });

  it("spells out every slot when a template is chosen", () => {
    const template = builtInTemplates.find((item) => item.id === "results-briefing")!;
    const story = buildStoryPrompt(fresh().evidence, { ...options, template });
    expect(story).toContain('Follow the narrative template "Results briefing". Produce exactly 5 sections, in this order:');
    expect(story).toContain("02 — Compare against the baselines. Visual: comparison. Draw mainly on claims of kind reported-result.");
    expect(story).not.toContain("Build an arc");
    const report = buildDeepReportPrompt(fresh().evidence, { ...options, template });
    expect(report).toContain("Produce exactly 6 sections");
    expect(report).toContain("contribution, experiment, mechanism, critique, reproduction, implication");
  });

  it("keeps a regenerated section in its template slot", () => {
    const project = { ...fresh(), template: fromExample() };
    const target = { kind: "story", sectionId: "story-architecture" } as const;
    expect(templateSlotInstruction(project.template, 1)).toContain("Its visual type must be architecture");
    expect(buildSectionRegenerationPrompt(project, target, { claimPolicy: "open" })).toContain("Its visual type must be architecture");

    const current = project.story.sections[1];
    const swapped = { ...current, visual: project.story.sections[0].visual };
    expect(() => spliceSection(project, target, swapped, { claimPolicy: "locked" })).toThrow(/an architecture visual/);
    expect(() => spliceSection(project, target, { ...current, body: "Rewritten." }, { claimPolicy: "locked" })).not.toThrow();
  });
});
