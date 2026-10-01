import { clozeMatches } from "./highlight-cards";
import { cardText, dueCards, recordReview, reviewCards, reviewForecast, type ReviewCard } from "./review-queue";
import { describeDue, isDue } from "./review-schedule";
import type { ResearchProject } from "./schema";
import { parseStudyFile, studyFileToJson, type StudyProgress } from "./study-path";

/**
 * Sohbette tekrar: ajan vadesi gelen kartları sohbette soruyor ve sonucu
 * stüdyonun kaydına yazıyor (`trace-agent.mjs review`).
 *
 * Kartın yanıtı listede yok: ajan önce soruyor, okuyucunun yanıtını köprüye
 * veriyor; köprü stüdyonun kuralıyla denetleyip yazıyor. Soru seçenekle
 * yanıtlanıyor ve tek denemede doğruysa hatırlanmış sayılıyor (stüdyoda da
 * yalnızca ilk deneme sayılıyor). Kavramı okuyucu kendi kelimeleriyle
 * anlatıyor, ajan yanıtı gösteriyor ve okuyucu kendisi işaretliyor. Vurgu
 * kartında kelime yazılıyor; tutmazsa yanıt gösteriliyor ve karar okuyucunun.
 * Yalnızca vadesi gelmiş kart yazılıyor: sohbet kartları öne çekemez.
 */

export const CHAT_REVIEW_LIMIT = 10;
const LETTERS = "ABCDEFGH";

export type ChatCard = {
  id: string;
  card: string;
  kind: ReviewCard["kind"];
  paper: string;
  language: string;
  /** Okuyucuya sorulacak olan; yanıt yok. */
  ask: string;
  options?: Array<{ letter: string; text: string }>;
  /** Ajanın yanıtı nasıl vereceği: `choice`, `typed` ya da `remembered`. */
  answerWith: "choice" | "typed" | "remembered";
  chooseAll?: boolean;
};

function chatCard(card: ReviewCard): ChatCard {
  const base = { id: card.projectId, card: card.review.id, kind: card.kind, paper: card.paperTitle, language: card.language };
  if (card.kind === "question") {
    return {
      ...base,
      ask: card.question.prompt,
      options: card.question.options.map((option, index) => ({ letter: LETTERS[index], text: option.label })),
      answerWith: "choice",
      ...(card.question.kind === "multi" ? { chooseAll: true } : {}),
    };
  }
  if (card.kind === "concept") return { ...base, ask: `${card.concept.term}: what does it mean, and why does this paper need it?`, answerWith: "remembered" };
  return { ...base, ask: `Fill in the blank${card.cloze.where ? ` (from “${card.cloze.where}”)` : ""}: ${cardText(card)}`, answerWith: "typed" };
}

export function chatReviewQueue(projects: readonly ResearchProject[], study: ReadonlyMap<string, StudyProgress>, now: string, limit = CHAT_REVIEW_LIMIT) {
  const cards = reviewCards(projects, study);
  const forecast = reviewForecast(cards, now);
  return { due: forecast.due, cards: dueCards(cards, now, limit).map(chatCard), ...(forecast.nextDue ? { nextDue: forecast.nextDue, nextDueIn: describeDue(forecast.nextDue, now) } : {}) };
}

/** Kartın yanıtı: okuyucu yanıtladıktan (ya da kavramda denedikten) sonra gösterilecek. */
export function chatCardAnswer(card: ReviewCard) {
  if (card.kind === "question") {
    const correct = card.question.options.flatMap((option, index) => (option.correct ? [{ letter: LETTERS[index], text: option.label, why: option.explanation }] : []));
    return { correct, ...(card.question.page ? { page: card.question.page } : {}) };
  }
  if (card.kind === "concept") {
    return { term: card.concept.term, meaning: card.concept.intuition, whyItMatters: card.concept.whyItMatters, ...(card.concept.formal ? { formal: card.concept.formal } : {}) };
  }
  return { missingWord: card.cloze.answer, highlight: card.cloze.text };
}

export type ChatAnswer = { choice?: string; typed?: string; remembered?: boolean };

/** Seçim "A", "a, c", "AC" gibi gelebilir; harfler kümesi. */
function letters(choice: string, count: number) {
  const picked = new Set(choice.toUpperCase().replace(/[^A-Z]/g, "").split("").filter(Boolean));
  const valid = [...picked].every((letter) => LETTERS.indexOf(letter) >= 0 && LETTERS.indexOf(letter) < count);
  return valid && picked.size ? picked : undefined;
}

type Graded = { ok: true; remembered: boolean; feedback: Record<string, unknown> } | { ok: true; remembered: undefined; feedback: Record<string, unknown> } | { ok: false; issue: string };

function grade(card: ReviewCard, answer: ChatAnswer): Graded {
  if (card.kind === "question") {
    if (answer.choice === undefined) return { ok: false, issue: "A question is answered with --choice and the letter (or letters) the reader chose." };
    const picked = letters(answer.choice, card.question.options.length);
    if (!picked) return { ok: false, issue: `--choice takes letters from A to ${LETTERS[card.question.options.length - 1]}.` };
    const right = new Set(card.question.options.flatMap((option, index) => (option.correct ? [LETTERS[index]] : [])));
    const remembered = picked.size === right.size && [...picked].every((letter) => right.has(letter));
    const chosen = card.question.options.flatMap((option, index) => (picked.has(LETTERS[index]) ? [{ letter: LETTERS[index], text: option.label, correct: option.correct, why: option.explanation }] : []));
    return { ok: true, remembered, feedback: { chosen } };
  }
  if (card.kind === "highlight" && answer.typed !== undefined && answer.remembered === undefined) {
    if (!answer.typed.trim()) return { ok: false, issue: "--typed needs the word the reader wrote." };
    return clozeMatches(answer.typed, card.cloze.answer)
      ? { ok: true, remembered: true, feedback: { typed: answer.typed.trim() } }
      : { ok: true, remembered: undefined, feedback: { typed: answer.typed.trim() } };
  }
  if (answer.remembered === undefined) {
    return { ok: false, issue: card.kind === "concept" ? "Show the reader the answer (--show), let them say whether they remembered it, then record it with --remembered yes or no." : "A highlight card is answered with --typed and the word the reader wrote, or --remembered yes or no." };
  }
  return { ok: true, remembered: answer.remembered, feedback: {} };
}

/**
 * Bir kartın sonucunu stüdyonun kaydına yazar. `file` yeni `study.json`;
 * `needsReader` ise yazılan kelime tutmadı ve karar okuyucunun.
 */
export function answerChatCard(projects: readonly ResearchProject[], rawStudyFile: unknown, projectId: string, cardId: string, answer: ChatAnswer, now: string) {
  const study = parseStudyFile(rawStudyFile);
  const project = projects.find((item) => item.id === projectId);
  if (!project) return { ok: false as const, issue: `No paper with the id "${projectId}" in the library.` };
  const card = reviewCards([project], study).find((item) => item.review.id === cardId);
  if (!card) return { ok: false as const, issue: `No review card "${cardId}" for this paper. Run review to see the cards that are due.` };
  if (!isDue(card.review, now)) return { ok: false as const, issue: `This card is not due; it comes back ${describeDue(card.review.due, now)}.` };
  const graded = grade(card, answer);
  if (!graded.ok) return { ok: false as const, issue: graded.issue };
  if (graded.remembered === undefined) {
    return { ok: true as const, recorded: false as const, needsReader: true, ...graded.feedback, answer: chatCardAnswer(card) };
  }
  const progress = recordReview(study.get(projectId), card, graded.remembered, now);
  study.set(projectId, progress);
  const due = progress.reviews!.find((item) => item.id === cardId)!.due;
  const left = reviewCards(projects, study).filter((item) => isDue(item.review, now)).length;
  return {
    ok: true as const,
    recorded: true as const,
    remembered: graded.remembered,
    comesBack: describeDue(due, now),
    due,
    ...graded.feedback,
    answer: chatCardAnswer(card),
    stillDue: left,
    file: studyFileToJson(study),
  };
}

/** `--show`: kartın yanıtı, yazmadan. */
export function showChatCard(projects: readonly ResearchProject[], study: ReadonlyMap<string, StudyProgress>, projectId: string, cardId: string) {
  const project = projects.find((item) => item.id === projectId);
  const card = project ? reviewCards([project], study).find((item) => item.review.id === cardId) : undefined;
  if (!card) return { ok: false as const, issue: `No review card "${cardId}" for the paper "${projectId}".` };
  return { ok: true as const, card: chatCard(card), answer: chatCardAnswer(card) };
}
