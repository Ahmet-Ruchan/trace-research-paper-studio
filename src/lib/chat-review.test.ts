import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { answerChatCard, chatReviewQueue, showChatCard } from "./chat-review";
import { loadExampleProject } from "./example-fixture";
import { addHighlightCard, clozeCandidates } from "./highlight-cards";
import { addDays } from "./review-schedule";
import type { ResearchProject } from "./schema";
import { completeStep, parseStudyFile, recordAnswer, studyFileToJson, type StudyProgress } from "./study-path";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const project: ResearchProject = { ...example, id: "attention" };
const question = example.quiz!.questions[0];
const concept = example.primer!.concepts[0];
const T0 = "2026-09-20T09:00:00.000Z";
const NOW = addDays(T0, 2);
const quote = "The Transformer relies entirely on self-attention to draw global dependencies.";

/** Bir soru (yanlış yanıtlanmış), bir kavram ve bir vurgu kartı; hepsi yarın vadeli. */
function studied(): Map<string, StudyProgress> {
  let progress = recordAnswer(undefined, question, { correct: false, attempts: 1, revealed: true }, T0);
  progress = completeStep(progress, `concept:${concept.id}`, "next", T0);
  progress = addHighlightCard(progress, { id: "note-1", quote }, clozeCandidates(quote, project)[0], "Why attention", T0);
  return new Map([[project.id, progress]]);
}
const letterOf = (index: number) => "ABCDEFGH"[index];
const right = question.options.map((option, index) => (option.correct ? letterOf(index) : "")).join("");
const wrong = letterOf(question.options.findIndex((option) => !option.correct));

describe("review in the chat", () => {
  it("lists the due cards without their answers", () => {
    const queue = chatReviewQueue([project], studied(), NOW);
    expect(queue.due).toBe(3);
    const kinds = queue.cards.map((card) => card.kind).sort();
    expect(kinds).toEqual(["concept", "highlight", "question"]);
    const asked = queue.cards.find((card) => card.kind === "question")!;
    expect(asked).toMatchObject({ id: "attention", card: `q:${question.id}`, ask: question.prompt, answerWith: "choice" });
    expect(asked.options!.map((option) => option.letter)).toEqual(question.options.map((_, index) => letterOf(index)));
    expect(JSON.stringify(queue)).not.toMatch(/"correct"|explanation|intuition/);
    expect(queue.cards.find((card) => card.kind === "highlight")!.ask).toBe("Fill in the blank (from “Why attention”): The Transformer relies entirely on _____ to draw global dependencies.");
    expect(queue.cards.find((card) => card.kind === "concept")!).toMatchObject({ answerWith: "remembered", ask: `${concept.term}: what does it mean, and why does this paper need it?` });
    expect(chatReviewQueue([project], studied(), T0)).toMatchObject({ due: 0, cards: [], nextDueIn: "tomorrow" });
    expect(chatReviewQueue([project], studied(), NOW, 1).cards).toHaveLength(1);
  });

  it("checks a question by the letters chosen, and writes the result as Review would", () => {
    const file = studyFileToJson(studied());
    const missed = answerChatCard([project], file, "attention", `q:${question.id}`, { choice: wrong }, NOW);
    expect(missed).toMatchObject({ ok: true, recorded: true, remembered: false, comesBack: "tomorrow", stillDue: 2 });
    const remembered = answerChatCard([project], file, "attention", `q:${question.id}`, { choice: right.toLowerCase().split("").join(", ") }, NOW);
    expect(remembered).toMatchObject({ ok: true, recorded: true, remembered: true, comesBack: "in 3 days" });
    if (!remembered.ok || !remembered.recorded) throw new Error("not recorded");
    expect((remembered.answer as { correct: Array<{ letter: string }> }).correct.map((item) => item.letter).join("")).toBe(right);
    const progress = parseStudyFile(remembered.file).get("attention")!;
    expect(progress.reviews!.find((item) => item.id === `q:${question.id}`)).toMatchObject({ box: 1, reviews: 1 });
    expect(progress.reviewDays).toHaveLength(1);
    // Bir kart vadesi gelmeden yeniden yazılamıyor.
    expect(answerChatCard([project], remembered.file, "attention", `q:${question.id}`, { choice: right }, NOW)).toEqual({ ok: false, issue: "This card is not due; it comes back in 3 days." });
  });

  it("leaves a mistyped highlight word to the reader, and records a concept only with the reader's own word", () => {
    const file = studyFileToJson(studied());
    const typo = answerChatCard([project], file, "attention", "h:note-1", { typed: "self atention" }, NOW);
    expect(typo).toMatchObject({ ok: true, recorded: false, needsReader: true, answer: { missingWord: "self-attention" } });
    expect(answerChatCard([project], file, "attention", "h:note-1", { typed: "Self Attention" }, NOW)).toMatchObject({ recorded: true, remembered: true });
    expect(answerChatCard([project], file, "attention", "h:note-1", { remembered: true }, NOW)).toMatchObject({ recorded: true, remembered: true });

    expect(answerChatCard([project], file, "attention", `c:${concept.id}`, {}, NOW)).toMatchObject({ ok: false, issue: expect.stringContaining("--show") });
    expect(answerChatCard([project], file, "attention", `c:${concept.id}`, { remembered: false }, NOW)).toMatchObject({ recorded: true, remembered: false, answer: { term: concept.term, meaning: concept.intuition } });
    expect(showChatCard([project], studied(), "attention", `c:${concept.id}`)).toMatchObject({ ok: true, answer: { whyItMatters: concept.whyItMatters } });

    expect(answerChatCard([project], file, "attention", `q:${question.id}`, { remembered: true }, NOW)).toMatchObject({ ok: false, issue: expect.stringContaining("--choice") });
    expect(answerChatCard([project], file, "attention", `q:${question.id}`, { choice: "Z" }, NOW)).toMatchObject({ ok: false });
    expect(answerChatCard([project], file, "gone", `q:${question.id}`, { choice: "A" }, NOW)).toMatchObject({ ok: false });
    expect(answerChatCard([project], file, "attention", "q:nope", { choice: "A" }, NOW)).toMatchObject({ ok: false });
  });

  it("lets an agent ask the cards and write the reader's answers to the studio", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const workspace = mkdtempSync(join(tmpdir(), "trace-chat-review-"));
    const bridge = (...args: string[]) => spawnSync(process.execPath, [join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs"), "review", ...args], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: workspace } });
    try {
      mkdirSync(join(workspace, "library"), { recursive: true });
      writeFileSync(join(workspace, "library", "attention.trace.json"), JSON.stringify(project));
      // Kartlar iki gün önce çalışılmış: bugün vadeli.
      const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
      let progress = recordAnswer(undefined, question, { correct: false, attempts: 1, revealed: true }, past);
      progress = completeStep(progress, `concept:${concept.id}`, "next", past);
      writeFileSync(join(workspace, "library", "study.json"), JSON.stringify(studyFileToJson(new Map([["attention", progress]]))));

      const listed = bridge();
      expect(listed.stderr).toBe("");
      const queue = JSON.parse(listed.stdout) as { due: number; cards: Array<{ card: string; kind: string }>; note: string };
      expect(queue.due).toBe(2);
      expect(queue.note).toMatch(/Never answer for the reader/);

      const answered = JSON.parse(bridge("--answer", "--id", "attention", "--card", `q:${question.id}`, "--choice", right).stdout) as { recorded: boolean; remembered: boolean; comesBack: string; file?: unknown };
      expect(answered).toMatchObject({ recorded: true, remembered: true, comesBack: "in 3 days" });
      expect(answered.file).toBeUndefined();
      const shown = JSON.parse(bridge("--show", "--id", "attention", "--card", `c:${concept.id}`).stdout) as { answer: { term: string } };
      expect(shown.answer.term).toBe(concept.term);
      expect(JSON.parse(bridge("--answer", "--id", "attention", "--card", `c:${concept.id}`, "--remembered", "no").stdout)).toMatchObject({ recorded: true, remembered: false, stillDue: 0 });

      const saved = parseStudyFile(JSON.parse(readFileSync(join(workspace, "library", "study.json"), "utf8"))).get("attention")!;
      expect(saved.reviews!.map((item) => [item.id, item.box]).sort()).toEqual([[`c:${concept.id}`, 0], [`q:${question.id}`, 1]].sort());
      expect(saved.reviewDays![0]).toMatchObject({ reviewed: 2, remembered: 1 });
      expect(JSON.parse(bridge().stdout)).toMatchObject({ due: 0, cards: [] });

      const refused = bridge("--answer", "--id", "attention", "--card", `q:${question.id}`, "--choice", right);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toMatch(/not due/);
      expect(bridge("--answer", "--id", "attention", "--card", `c:${concept.id}`, "--remembered", "maybe").status).toBe(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
