import type { NarrativeTemplate, ResearchProject } from "./schema";

/**
 * Derinliğe göre bölüm bütçeleri. Prompt bunları hedef olarak veriyor,
 * bütünlük denetimi de aynı sayıyı üst sınır olarak uyguluyor; tek yerde
 * durmazsa üretim kendi doğrulamasına takılır.
 */
export const SECTION_BUDGETS = {
  story: { concise: 5, standard: 6, deep: 8 },
  deepReport: { concise: 6, standard: 7, deep: 9 },
} as const;

/**
 * Bir projede beklenen bölüm sayıları. Şablon varsa sayıyı şablon belirler;
 * yoksa derinlik bütçesi. Üretim rotası, plugin doğrulayıcısı ve bölüm takma
 * aynı fonksiyonu kullanıyor — üçü ayrı hesaplasaydı şablonlu bir proje birinde
 * geçip ötekinde reddedilirdi.
 */
export function expectedSectionCounts(project: { depth: ResearchProject["depth"]; template?: NarrativeTemplate }) {
  return {
    story: project.template?.story.length ?? SECTION_BUDGETS.story[project.depth],
    report: project.template?.report?.length ?? SECTION_BUDGETS.deepReport[project.depth],
  };
}
