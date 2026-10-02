import type { StudyStatus } from "@/lib/reading-order";
import { CARD_KIND_LABELS } from "@/lib/review-queue";
import type { ResearchProject } from "@/lib/schema";

/** Öğrenme ekranlarının ortak parçaları: başlık şeridi, derinlik, çalışma durumu ve kart türü adları. */
const en = {
  shell: {
    brandTagline: "research studio",
    backToLibrary: "Back to the library",
    library: "Library",
  },
  depthNames: { concise: "concise", standard: "standard", deep: "deep" } satisfies Record<ResearchProject["depth"], string>,
  studyStatus: { finished: "Studied", started: "Studying", new: "Not studied yet" } satisfies Record<StudyStatus, string>,
  /** Kartın türü; İngilizcesi ajan çıktısıyla aynı (`review-queue.ts`). */
  cardKinds: CARD_KIND_LABELS,
};

const tr: typeof en = {
  shell: {
    brandTagline: "araştırma stüdyosu",
    backToLibrary: "Kütüphaneye dön",
    library: "Kütüphane",
  },
  depthNames: { concise: "kısa", standard: "standart", deep: "derin" },
  studyStatus: { finished: "Çalışıldı", started: "Çalışılıyor", new: "Henüz çalışılmadı" },
  cardKinds: { question: "Soru", concept: "Kavram", highlight: "Vurgu" },
};

const shared = { en, tr };

export default shared;
