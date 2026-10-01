import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { MAX_CHUNK, readingQueue, reportSpeech, speakable, speechChunks, storySpeech } from "./read-aloud";

const project = loadExampleProject("attention-is-all-you-need.en.trace.json");

describe("reading aloud", () => {
  it("reads the title and then the text of each section, without math markup", () => {
    const story = storySpeech(project);
    expect(story).toHaveLength(project.story.sections.length);
    expect(story[0].text.startsWith(project.story.sections[0].title)).toBe(true);
    const report = reportSpeech(project);
    expect(report[0].text).toContain(project.deepReport!.sections[0].summary.slice(0, 30));
    expect(speakable("Scale by $\\sqrt{d_k}$ and **stop**.")).toBe("Scale by sqrt d k and stop.");
    expect(reportSpeech({ deepReport: undefined })).toEqual([]);
  });

  it("cuts the text into short pieces at sentence ends, and long sentences at commas", () => {
    const chunks = speechChunks("One. Two! Three? " + "word, ".repeat(80) + "end.");
    expect(chunks[0]).toBe("One. Two! Three?");
    expect(chunks.every((chunk) => chunk.length <= MAX_CHUNK)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(("One. Two! Three? " + "word, ".repeat(80) + "end.").trim());
    expect(speechChunks("No full stop at the end")).toEqual(["No full stop at the end"]);
    expect(speechChunks("")).toEqual([]);
    for (const section of storySpeech(project)) expect(speechChunks(section.text).every((chunk) => chunk.length <= MAX_CHUNK)).toBe(true);
  });

  it("queues from the chosen section to the end", () => {
    const sections = storySpeech(project);
    const queue = readingQueue(sections, sections[2].id);
    expect(queue[0].sectionId).toBe(sections[2].id);
    expect(new Set(queue.map((item) => item.sectionId))).toEqual(new Set(sections.slice(2).map((section) => section.id)));
    expect(readingQueue(sections, "gone")[0].sectionId).toBe(sections[0].id);
  });
});
