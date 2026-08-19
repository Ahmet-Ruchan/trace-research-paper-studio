import { describe, expect, it } from "vitest";
import { buildStandaloneStory } from "./export-story";
import { sampleProject } from "./sample-project";

describe("standalone story export", () => {
  it("exports a self-contained scrollytelling document", () => {
    const html = buildStandaloneStory(sampleProject);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(sampleProject.story.title);
    expect(html).toContain("IntersectionObserver");
    expect(html).toContain("prefers-reduced-motion");
  });

  it("escapes untrusted story copy", () => {
    const project = structuredClone(sampleProject);
    project.story.title = '</title><script data-attack="true">alert(1)</script>';
    const html = buildStandaloneStory(project);
    expect(html).not.toContain('<script data-attack="true">');
    expect(html).toContain("&lt;script data-attack=&quot;true&quot;&gt;");
  });
});

