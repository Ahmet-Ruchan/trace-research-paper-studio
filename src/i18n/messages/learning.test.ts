import { describe, expect, it } from "vitest";
import { ALIAS_WORDS, decideAlias, emptyAliasFile } from "@/lib/concept-aliases";
import { CROSS_QUESTION_WORDS, crossPaperQuestions } from "@/lib/cross-questions";
import { loadExampleProject } from "@/lib/example-fixture";
import { learningBlockIds, learningBlockList } from "@/lib/learning-generation";
import { describeMissingBlocks, MISSING_BLOCK_WORDS } from "@/lib/learning-health";
import { READING_DRILL_WORDS, readingDrillFor } from "@/lib/reading-drill";
import {
  addAllToReadingList,
  addToReadingList,
  MAX_READING_ITEMS,
  READING_LIST_LIMIT_WORDS,
  ReadingListFullError,
  readingItemSchema,
  SAVED_REASON_WORDS,
  savedFrom,
  savedReason,
  workKey,
  type ReadingItem,
} from "@/lib/reading-list";
import { POSITION_LABEL_WORDS, positionLabel } from "@/lib/reading-position";
import { REFERENCE_IMPORT_WORDS, parseReferenceFile } from "@/lib/reference-import";
import { DUE_WORDS, describeDue } from "@/lib/review-schedule";
import type { ResearchProject } from "@/lib/schema";
import { questionSignature } from "@/lib/study-path";
import learning from "./learning";

/**
 * `learning` sözlüğünün kütüphane kelimeleri (`t.learning.words`): İngilizcesi
 * modüllerin kendi varsayılanı (ajan çıktısı değişmiyor), Türkçesi aynı
 * işlevlerden doğru cümleleri çıkarıyor.
 */

const { en, tr } = learning;
const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const paper = (id: string, title: string, year = "2020"): ResearchProject => ({
  ...example,
  id,
  evidence: { ...example.evidence, paper: { ...example.evidence.paper, title, year, doi: undefined } },
});
const item = (title: string): ReadingItem => readingItemSchema.parse({ id: workKey({ title }), title, from: [], addedAt: "2026-09-30T10:00:00.000Z" });

describe("learning words", () => {
  it("uses the modules' own English defaults, so English output does not change", () => {
    expect(en.words.due).toBe(DUE_WORDS);
    expect(en.words.missingBlocks).toBe(MISSING_BLOCK_WORDS);
    expect(en.words.savedReason).toBe(SAVED_REASON_WORDS);
    expect(en.words.readingListLimits).toBe(READING_LIST_LIMIT_WORDS);
    expect(en.words.referenceImport).toBe(REFERENCE_IMPORT_WORDS);
    expect(en.words.positionLabel).toBe(POSITION_LABEL_WORDS);
    expect(en.words.crossQuestions).toBe(CROSS_QUESTION_WORDS);
    expect(en.words.alias).toBe(ALIAS_WORDS);
    expect(en.words.readingDrill).toBe(READING_DRILL_WORDS);
  });

  it("says when a card comes back in Turkish", () => {
    const now = "2026-10-01T10:00:00.000Z";
    expect(describeDue("2026-10-01T09:00:00.000Z", now, tr.words.due)).toBe("şimdi");
    expect(describeDue("2026-10-02T10:00:00.000Z", now, tr.words.due)).toBe("yarın");
    expect(describeDue("2026-10-04T10:05:00.000Z", now, tr.words.due)).toBe("3 gün sonra");
    expect(describeDue("2026-10-04T10:05:00.000Z", now)).toBe("in 3 days");
  });

  it("lists missing learning blocks the way generation does in English, and in Turkish with “ve”", () => {
    for (const count of [0, 1, 2, learningBlockIds.length]) {
      const blocks = learningBlockIds.slice(0, count);
      expect(describeMissingBlocks(blocks)).toBe(learningBlockList(blocks));
    }
    expect(describeMissingBlocks(["primer", "quiz", "derivations"], tr.words.missingBlocks)).toBe("ön bilgi, test ve türetimler");
    expect(describeMissingBlocks(["applicationGuide"], tr.words.missingBlocks)).toBe("uygulama rehberi");
  });

  it("gives a saved work's reason in Turkish, with or without the concept's name", () => {
    const project = paper("p", "Attention Is All You Need");
    expect(savedReason({ relation: "concept", project, concept: "softmax" }, tr.words.savedReason)).toBe(
      "Attention Is All You Need makalesinden önce: o makalenin varsaydığı softmax kavramını anlatıyor.",
    );
    expect(savedReason({ relation: "concept", project }, tr.words.savedReason)).toBe("Attention Is All You Need makalesinden önce: o makalenin varsaydığı bir kavramı anlatıyor.");
    expect(savedReason({ relation: "reference", project }, tr.words.savedReason)).toBe("Attention Is All You Need makalesinden önce: o makale bunun üzerine kurulu.");
    expect(savedReason({ relation: "cited-by", project }, tr.words.savedReason)).toBe("Attention Is All You Need makalesinden sonra: o makaleye atıf yapıyor.");
    expect(savedFrom({ relation: "cited-by", project }, tr.words.savedReason)).toBe("Attention Is All You Need makalesine atıf yapıyor.");
    expect(savedReason({ relation: "reference", project })).toBe("Before Attention Is All You Need: that paper builds on it.");
  });

  it("refuses a full reading list in Turkish, with an error the route can recognise by its type", () => {
    const full = Array.from({ length: MAX_READING_ITEMS }, (_, index) => item(`Paper ${index}`));
    expect(() => addToReadingList(full, item("One more"), tr.words.readingListLimits)).toThrow("Okuma listesi en çok 500 makale alır.");
    expect(() => addToReadingList(full, item("One more"))).toThrow(ReadingListFullError);
    expect(() => addAllToReadingList(full.slice(2), [item("A"), item("B"), item("C")], tr.words.readingListLimits)).toThrow("Okuma listesi en çok 500 makale alır; 2 tane daha sığar.");
  });

  it("explains an unreadable reference file in Turkish", () => {
    expect(() => parseReferenceFile("notes.txt", "just some notes", tr.words.referenceImport)).toThrow(/BibTeX, RIS ya da CSL JSON dosyası değil/);
    expect(() => parseReferenceFile("broken.json", "[{", tr.words.referenceImport)).toThrow("CSL JSON dosyası okunamadı.");
  });

  it("names where the reader stopped in Turkish", () => {
    const position = { place: "story" as const, sectionId: "s4", title: "Why attention", index: 3, total: 8, at: "2026-10-01T10:00:00.000Z" };
    expect(positionLabel(position)).toBe("4 of 8: Why attention");
    expect(positionLabel(position, tr.words.positionLabel)).toBe("bölüm 4/8, “Why attention”");
  });

  it("asks the questions across two papers in Turkish, with the same answers", () => {
    const later: ResearchProject = {
      ...paper("later", "A Later Paper", "2019"),
      evidence: {
        ...example.evidence,
        paper: { ...example.evidence.paper, title: "A Later Paper", year: "2019" },
        claims: example.evidence.claims.map((claim, index) => ({ ...claim, statement: `Later paper claim ${index}: ${claim.statement}` })),
        glossary: [...example.evidence.glossary.slice(1), { term: "Pre-training", definition: "Training on unlabeled text first." }],
      },
    };
    const english = crossPaperQuestions(example, later);
    const turkish = crossPaperQuestions(example, later, tr.words.crossQuestions);
    expect(turkish.map((question) => [question.id, question.options.map((option) => option.correct)])).toEqual(
      english.map((question) => [question.id, question.options.map((option) => option.correct)]),
    );
    expect(turkish.find((question) => question.id === "cross-year")?.prompt).toBe("İki makaleden hangisi önce yayımlandı?");
    expect(turkish.find((question) => question.id.startsWith("cross-claim-a-"))?.options[0].explanation).toMatch(/^Evet, bu makalede \(s\. \d+\): “/);
    expect(turkish.find((question) => question.id.startsWith("cross-term-1-"))?.prompt).toBe("Hangi makale sözlüğünde “Pre-training” terimini tanımlıyor?");
  });

  it("refuses to link two spellings of one name in Turkish", () => {
    expect(() => decideAlias(emptyAliasFile(), "Attention", "attention", "same", "reader", "2026-10-01T10:00:00.000Z", undefined, tr.words.alias)).toThrow(
      "Bunlar aynı adın iki yazımı; bağlanacak bir şey yok.",
    );
  });

  it("asks the reading drill in Turkish, and its questions keep the English seal so saved answers stay", () => {
    const english = readingDrillFor(example)!;
    const turkish = readingDrillFor(example, tr.words.readingDrill)!;
    expect(english.title).toBe("Read it like a reviewer");
    expect(turkish.title).toBe("Hakem gibi oku");
    expect(turkish.intro).not.toBe(english.intro);
    // Aynı sorular aynı sırada, aynı doğru yanıtla; metin Türkçe.
    expect(turkish.questions.map((question) => question.id)).toEqual(english.questions.map((question) => question.id));
    expect(turkish.questions.map((question) => question.options.map((option) => option.correct))).toEqual(english.questions.map((question) => question.options.map((option) => option.correct)));
    const kind = turkish.questions.find((question) => question.id.startsWith("drill-kind-"))!;
    expect(kind.prompt).toMatch(/^Bu ne tür bir ifade\? “/);
    expect(turkish.questions.find((question) => question.id.startsWith("drill-quote-"))!.prompt).toMatch(/^Makaledeki hangi cümle bu iddiayı destekliyor\?/);
    // Ekrana çıkan metin (mühür için saklanan İngilizce hariç).
    expect(JSON.stringify(turkish.questions.map(({ prompt, options }) => ({ prompt, options })))).not.toMatch(/That is|What kind|The paper:|\(p\. \d/);
    expect(turkish.questions.map(questionSignature)).toEqual(english.questions.map(questionSignature));
    // İngilizcesi değişmedi: mührü de eskisi gibi kendi metninden.
    expect(english.questions.every((question) => !("signatureBasis" in question))).toBe(true);
  });
});
