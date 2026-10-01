import { z } from "zod";

/**
 * Aralıklı tekrar zamanlaması.
 *
 * Bir makaleyi çalışmak bir haftada unutuluyor; hatırlamayı kalıcı yapan,
 * unutmak üzereyken yeniden hatırlamak. Burada Leitner kutuları kullanılıyor:
 * hatırlanan kart bir sonraki kutuya geçiyor ve daha geç dönüyor, hatırlanmayan
 * ilk kutuya düşüyor ve ertesi gün dönüyor. Aralıklar gün cinsinden; saat
 * önemsiz, okuyucu kartları gün içinde ne zaman isterse görüyor.
 *
 * Kartlar çalışma modunda doğuyor: yanıtlanan her soru ve okunan her kavram.
 * Okuyucunun hiç görmediği bir şey "tekrar" edilemez.
 */

export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 16, 35, 90] as const;
export const MAX_REVIEW_BOX = REVIEW_INTERVALS_DAYS.length - 1;

/**
 * Vurgudan kart (`highlight-cards.ts`): okuyucunun vurguladığı metin ve
 * içinden gizlenen kelime. Kartın içeriği projede değil okuyucunun notunda;
 * not silinince kart da gidiyor, bu yüzden metin kartın yanında tutuluyor.
 */
export const clozeSchema = z
  .object({
    text: z.string().min(1).max(1200),
    answer: z.string().min(1).max(120),
    /** Gizlenen kelimenin metindeki yeri. */
    at: z.number().int().min(0).max(1200),
    /** Vurgunun bulunduğu bölüm. */
    where: z.string().max(300).default(""),
  })
  .refine((cloze) => cloze.text.slice(cloze.at, cloze.at + cloze.answer.length) === cloze.answer, "The hidden word is not where the card says.");
export type Cloze = z.infer<typeof clozeSchema>;

export const studyReviewSchema = z.object({
  /** `q:<soru kimliği>`, `c:<kavram kimliği>` ya da `h:<not kimliği>`. */
  id: z.string().min(3).max(300),
  box: z.number().int().min(0).max(MAX_REVIEW_BOX),
  due: z.string().max(40),
  lapses: z.number().int().min(0).max(9999),
  reviews: z.number().int().min(0).max(9999),
  last: z.string().max(40).optional(),
  /** Sorunun mührü: soru yeniden yazılırsa kart baştan başlıyor. */
  sig: z.string().max(40).optional(),
  /** Vurgu kartının metni. */
  cloze: clozeSchema.optional(),
});
export type StudyReview = z.infer<typeof studyReviewSchema>;

export const questionCardId = (questionId: string) => `q:${questionId}`;
export const conceptCardId = (conceptId: string) => `c:${conceptId}`;
export const highlightCardId = (noteId: string) => `h:${noteId}`;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(now: string, days: number) {
  return new Date(Date.parse(now) + days * DAY_MS).toISOString();
}

/** İlk kutu: çalışmada ilk denemede bilinen soru 1. kutudan, gerisi 0. kutudan başlıyor. */
export function scheduleFirst(id: string, box: number, now: string, sig?: string): StudyReview {
  const start = Math.min(MAX_REVIEW_BOX, Math.max(0, box));
  return { id, box: start, due: addDays(now, REVIEW_INTERVALS_DAYS[start]), lapses: 0, reviews: 0, ...(sig ? { sig } : {}) };
}

export function applyReview(review: StudyReview, remembered: boolean, now: string): StudyReview {
  const box = remembered ? Math.min(MAX_REVIEW_BOX, review.box + 1) : 0;
  return {
    ...review,
    box,
    due: addDays(now, REVIEW_INTERVALS_DAYS[box]),
    lapses: remembered ? review.lapses : review.lapses + 1,
    reviews: review.reviews + 1,
    last: now,
  };
}

export function isDue(review: Pick<StudyReview, "due">, now: string) {
  return Date.parse(review.due) <= Date.parse(now);
}

/**
 * "tomorrow", "in 3 days": bir sonraki tekrarın okuyucuya söylenişi. Gün
 * yuvarlanıyor: ekranın açılışıyla yanıt arasında geçen birkaç dakika "3 gün"ü
 * "4 gün" yapmamalı.
 */
export function describeDue(due: string, now: string) {
  const difference = Date.parse(due) - Date.parse(now);
  if (difference <= 0) return "now";
  const days = Math.max(1, Math.round(difference / DAY_MS));
  return days === 1 ? "tomorrow" : `in ${days} days`;
}
