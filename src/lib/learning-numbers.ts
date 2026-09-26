import type { PaperEvidence, ResearchProject } from "./schema";

/**
 * Öğrenme katmanındaki sayılar kanıttan mı geliyor?
 *
 * Anlatının karşılaştırma grafikleri zaten yalnızca kanıttaki metrik
 * değerlerini kullanabiliyordu. Öğrenme katmanında böyle bir denetim yoktu:
 * bir oyun alanının "makalenin değeri", bir tablonun hücreleri ya da bir
 * hiperparametrenin makaledeki değeri uydurulabiliyordu ve okuyucu bunu
 * makalenin sayısı sanıyordu. Burada her biri kanıtın metninde (iddialar,
 * alıntılar, metrikler, yöntem ve bulgular) aranıyor.
 *
 * Bir öğretim aracı makalede olmayan sayılara ihtiyaç duyabilir (bir dikkat
 * matrisinin hücreleri gibi). O zaman blok `illustrative` olarak işaretlenir
 * ve okuyucuya öyle gösterilir; işaretsiz bir blokta her sayı makaleden gelir.
 */

/** Her yerde geçen ve kaynak göstermeye değmeyen değerler. */
const TRIVIAL = new Set([0, 1]);

const MINUS = /[−–]/g;

/**
 * Metindeki sayılar, her olası okunuşuyla: "4,000" İngilizcede dört bin,
 * Türkçede dört; "0,1" Türkçede ondalık. İkisi de kümeye giriyor: amaç
 * uydurulmuş bir sayıyı yakalamak, yazım biçimini denetlemek değil.
 */
export function numbersIn(text: string): number[] {
  const values: number[] = [];
  // Kaynakça işaretleri ("[38]", "[9, 32]") makalenin söylediği bir değer değil.
  const normalized = text.replace(MINUS, "-").replace(/\[\d+(?:\s*[,–-]\s*\d+)*\]/g, " ");
  // Bilimsel yazım: 2.3 · 10^19, 3.3×10^{18}, 10^-9, 1e-9.
  for (const match of normalized.matchAll(/(\d+(?:[.,]\d+)?)\s*[·×x*]\s*10\s*\^?\s*\{?\s*(-?\d+)\s*\}?/g)) {
    values.push(Number(match[1].replace(",", ".")) * 10 ** Number(match[2]));
  }
  for (const match of normalized.matchAll(/(?<![\d.])10\s*\^\s*\{?\s*(-?\d+)\s*\}?/g)) {
    values.push(10 ** Number(match[1]));
  }
  for (const match of normalized.matchAll(/(?<![\w.,])-?\d+(?:[.,]\d+)*(?:e-?\d+)?%?/gi)) {
    let token = match[0];
    const percent = token.endsWith("%");
    if (percent) token = token.slice(0, -1);
    // Her okunuş yalnızca kendi biçimine uyan yazımda: binlik ayırıcı üçlü gruplar ister.
    const readings = new Set<number>();
    if (/^-?\d+(?:\.\d+)?(?:e-?\d+)?$/i.test(token)) readings.add(Number(token));
    if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token)) readings.add(Number(token.replace(/,/g, "")));
    if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(token)) readings.add(Number(token.replace(/\./g, "").replace(",", ".")));
    if (/^-?\d+,\d+$/.test(token)) readings.add(Number(token.replace(",", ".")));
    for (const value of readings) {
      if (!Number.isFinite(value)) continue;
      values.push(value);
      if (percent) values.push(value / 100);
    }
  }
  return values;
}

/** Kanıtın sayı dağarcığı: makalenin söylediği her sayı. */
export function evidenceNumbers(evidence: PaperEvidence) {
  const texts = [
    evidence.thesis,
    evidence.plainSummary,
    evidence.researchQuestion,
    ...evidence.methods,
    ...evidence.findings,
    ...evidence.limitations,
    ...evidence.glossary.map((item) => `${item.term} ${item.definition}`),
    ...evidence.claims.flatMap((claim) => [claim.statement, ...claim.sourceRefs.map((reference) => reference.excerpt)]),
    ...evidence.metrics.flatMap((metric) => [String(metric.value), metric.displayValue, metric.label, metric.context ?? ""]),
  ];
  return texts.flatMap(numbersIn);
}

function traced(value: number, known: readonly number[]) {
  if (TRIVIAL.has(Math.abs(value))) return true;
  return known.some((candidate) => Math.abs(candidate - value) <= Math.max(1e-9, Math.abs(candidate) * 1e-6));
}

export type NumberSources = Pick<ResearchProject, "evidence"> &
  Partial<Pick<ResearchProject, "derivations" | "interactives" | "applicationGuide">>;

/**
 * Kanıtta bulunmayan sayılar, nerede oldukları ile. Boş liste: her sayı
 * makaleden ya da blok açıkça temsili.
 */
export function untracedLearningNumbers(project: NumberSources): string[] {
  const known = evidenceNumbers(project.evidence);
  const issues: string[] = [];
  const check = (owner: string, values: readonly number[]) => {
    const missing = [...new Set(values.filter((value) => !traced(value, known)))];
    if (missing.length) issues.push(`${owner}: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not in the evidence`);
  };

  project.interactives?.forEach((interactive) => {
    const owner = `interactives.${interactive.id}`;
    if (interactive.kind === "formula-playground") {
      interactive.parameters.forEach((parameter) => check(`${owner}.${parameter.name}.paperValue`, [parameter.paperValue]));
    }
    if (interactive.kind === "dataset-explorer") {
      interactive.columns.forEach((column, index) => {
        if (column.type !== "number") return;
        check(`${owner}.${column.id}`, interactive.rows.flatMap((row) => (typeof row.cells[index] === "number" ? [row.cells[index] as number] : [])));
      });
    }
    if (interactive.kind === "mechanism-simulation" && !interactive.illustrative) {
      interactive.frames.forEach((frame, index) => {
        if (frame.grid) check(`${owner}.frames[${index}].grid`, frame.grid.values.flat());
      });
    }
  });
  project.derivations?.forEach((derivation) => {
    if (derivation.numericExample && !derivation.numericExample.illustrative) {
      check(`derivations.${derivation.id}.numericExample.setup`, numbersIn(derivation.numericExample.setup));
    }
  });
  project.applicationGuide?.hyperparameters.forEach((item) => check(`applicationGuide.${item.name}.paperValue`, numbersIn(item.paperValue)));
  return issues;
}
