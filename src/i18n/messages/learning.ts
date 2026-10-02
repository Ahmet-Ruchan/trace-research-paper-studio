import concepts from "./learning/concepts";
import notes from "./learning/notes";
import reading from "./learning/reading";
import review from "./learning/review";
import shared from "./learning/shared";
import words from "./learning/words";

/**
 * `learning` bölümünün metinleri: tekrar, deneme sınavı, öğrenme sağlığı ve
 * istatistikleri, kavramlar, notlar, okuma listesi. Alanlara göre
 * `learning/` altındaki dosyalarda; hepsi tek düzlemde birleşiyor
 * (`t.learning.reviewView`, `t.learning.words.due`…).
 */
const en = { ...shared.en, ...review.en, ...concepts.en, ...reading.en, ...notes.en, ...words.en };

const tr: typeof en = { ...shared.tr, ...review.tr, ...concepts.tr, ...reading.tr, ...notes.tr, ...words.tr };

const learning = { en, tr };

export default learning;
