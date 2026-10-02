import { compareProjects } from "./compare-projects";
import type { Claim, QuizQuestion, ResearchProject } from "./schema";
import { foldForSearch } from "./search-text";

/**
 * İki makale arasında sorular: kim neyi söylüyor, hangisi önce, ortak bir
 * ölçütte hangisi yüksek, hangi terimi hangisi tanımlıyor.
 *
 * Model yok; sorular iki projenin kayıtlı kanıtından (iddialar, yıllar,
 * ölçütler, sözlük) kuruluyor ve her yanıtın açıklaması sayfasını ya da
 * değerini veriyor. İki makaleyi ayrı ayrı bilmek, onları birbirinden
 * ayırabilmek değil: bu sorular ikincisini sınıyor.
 *
 * İddia kimlikleri iki projede çakışabiliyor (aynı şablon, aynı numaralar);
 * soruların bağlandığı iddialar `a:` ve `b:` önekiyle ayrılıyor.
 */

export const MAX_CROSS_QUESTIONS = 8;

const sideId = (side: "a" | "b", id: string) => `${side}:${id}`;

/** Soruların kaynak iddiaları: iki projenin iddiaları, önekli kimliklerle. */
export function crossClaims(left: ResearchProject, right: ResearchProject): Claim[] {
  return [...left.evidence.claims.map((claim) => ({ ...claim, id: sideId("a", claim.id) })), ...right.evidence.claims.map((claim) => ({ ...claim, id: sideId("b", claim.id) }))];
}

const short = (text: string, max = 180) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Soruların ve açıklamaların cümleleri; Türkçesi arayüz sözlüğünde
 * (`learning`). Makalelerin başlıkları, iddiaları ve tanımları olduğu gibi
 * giriyor; `where` "p. 4" ya da sayfa yoksa "its sources".
 */
export type CrossQuestionWords = {
  page: (page: number) => string;
  itsSources: string;
  whoSays: (statement: string) => string;
  yesHere: (where: string, excerpt: string) => string;
  notHere: string;
  whichFirst: string;
  isFrom: (title: string, year: number) => string;
  whichHigher: (metric: string, unit: string) => string;
  higherValue: (title: string, value: string) => string;
  valueOnPage: (value: string, page: number) => string;
  whoDefines: (term: string) => string;
  definesIt: (term: string) => string;
  doesNotDefine: (term: string) => string;
  whoseDefinition: (term: string, title: string) => string;
  definedBy: (title: string) => string;
};
export const CROSS_QUESTION_WORDS: CrossQuestionWords = {
  page: (page) => `p. ${page}`,
  itsSources: "its sources",
  whoSays: (statement) => `Which paper says this? “${statement}”`,
  yesHere: (where, excerpt) => `Yes: ${where} of this paper, “${excerpt}”`,
  notHere: "Not in this paper's evidence.",
  whichFirst: "Which of the two papers came out first?",
  isFrom: (title, year) => `${title} is from ${year}.`,
  whichHigher: (metric, unit) => `Both papers report ${metric}${unit ? ` (${unit})` : ""}. Which reports the higher value?`,
  higherValue: (title, value) => `${title}: ${value}. Higher is not always better; the paper says which way is good.`,
  valueOnPage: (value, page) => `${value} (p. ${page})`,
  whoDefines: (term) => `Which paper defines “${term}” in its glossary?`,
  definesIt: (term) => `It does; the other paper's glossary has no “${term}”.`,
  doesNotDefine: (term) => `Its glossary has no “${term}”.`,
  whoseDefinition: (term, title) => `Both papers define “${term}”. Which definition is from ${title}?`,
  definedBy: (title) => `This is how ${title} defines it.`,
};

/** Bir makalenin, öbüründe aynısı olmayan, sayfası doğrulanmış iddiaları (sonuç ve yöntem önce). */
function distinctClaims(own: ResearchProject, other: ResearchProject, count: number) {
  const others = new Set(other.evidence.claims.map((claim) => foldForSearch(claim.statement)));
  const rank = { "reported-result": 0, method: 1, "author-interpretation": 2, limitation: 3, background: 4 } as const;
  return own.evidence.claims
    .filter((claim) => claim.confidence === "verified" && !others.has(foldForSearch(claim.statement)))
    .sort((left, right) => rank[left.kind] - rank[right.kind])
    .slice(0, count);
}

export function crossPaperQuestions(left: ResearchProject, right: ResearchProject, words: CrossQuestionWords = CROSS_QUESTION_WORDS): QuizQuestion[] {
  const page = (claim: Claim) => (claim.sourceRefs[0]?.page ? words.page(claim.sourceRefs[0].page) : words.itsSources);
  const a = left.evidence.paper.title;
  const b = right.evidence.paper.title;
  // Aynı başlıklı iki analizde (aynı makale) "hangisi" sorusu anlamsız.
  if (foldForSearch(a) === foldForSearch(b)) return [];
  const papers = [{ label: a, correct: false, explanation: "" }, { label: b, correct: false, explanation: "" }];
  const questions: QuizQuestion[] = [];

  // Kim söylüyor: iki makaleden sırayla.
  const fromLeft = distinctClaims(left, right, 2);
  const fromRight = distinctClaims(right, left, 2);
  const attributed = [fromLeft[0] && { claim: fromLeft[0], side: "a" as const }, fromRight[0] && { claim: fromRight[0], side: "b" as const }, fromLeft[1] && { claim: fromLeft[1], side: "a" as const }, fromRight[1] && { claim: fromRight[1], side: "b" as const }].filter(Boolean) as Array<{ claim: Claim; side: "a" | "b" }>;
  for (const { claim, side } of attributed) {
    const owner = side === "a" ? 0 : 1;
    questions.push({
      id: `cross-claim-${side}-${claim.id}`,
      kind: "single",
      prompt: words.whoSays(short(claim.statement, 260)),
      options: papers.map((option, index) => ({
        ...option,
        correct: index === owner,
        explanation: index === owner ? words.yesHere(page(claim), short(claim.sourceRefs[0]?.excerpt ?? claim.statement)) : words.notHere,
      })),
      claimIds: [sideId(side, claim.id)],
      ...(claim.sourceRefs[0]?.page ? { page: claim.sourceRefs[0].page } : {}),
    });
  }

  // Hangisi önce.
  const yearA = Number.parseInt(left.evidence.paper.year, 10);
  const yearB = Number.parseInt(right.evidence.paper.year, 10);
  if (Number.isFinite(yearA) && Number.isFinite(yearB) && yearA !== yearB) {
    const earlier = yearA < yearB ? 0 : 1;
    questions.push({
      id: "cross-year",
      kind: "single",
      prompt: words.whichFirst,
      options: papers.map((option, index) => ({ ...option, correct: index === earlier, explanation: words.isFrom(index === 0 ? a : b, index === 0 ? yearA : yearB) })),
      claimIds: [],
    });
  }

  // Ortak bir ölçüt: hangisi daha yüksek (iyi ya da kötü olduğuna karar vermeden).
  const comparison = compareProjects(left, right);
  for (const metric of comparison.sharedMetrics.filter((item) => item.left.value !== item.right.value).slice(0, 2)) {
    const higher = metric.left.value > metric.right.value ? 0 : 1;
    const where = (side: typeof metric.left) => (side.page ? words.valueOnPage(side.displayValue, side.page) : side.displayValue);
    questions.push({
      id: `cross-metric-${metric.key}`,
      kind: "single",
      prompt: words.whichHigher(metric.label, metric.unit),
      options: papers.map((option, index) => ({ ...option, correct: index === higher, explanation: words.higherValue(index === 0 ? a : b, where(index === 0 ? metric.left : metric.right)) })),
      claimIds: [],
    });
  }

  // Sözlük: yalnızca birinin tanımladığı terim, ve iki tanımdan hangisi kimin.
  const onlyLeft = comparison.onlyLeftTerms[0];
  const onlyRight = comparison.onlyRightTerms[0];
  for (const [term, owner] of [[onlyLeft, 0], [onlyRight, 1]] as const) {
    if (!term) continue;
    questions.push({
      id: `cross-term-${owner}-${foldForSearch(term)}`,
      kind: "single",
      prompt: words.whoDefines(term),
      options: papers.map((option, index) => ({ ...option, correct: index === owner, explanation: index === owner ? words.definesIt(term) : words.doesNotDefine(term) })),
      claimIds: [],
    });
  }
  const differing = comparison.sharedTerms.find((term) => !term.identical);
  if (differing) {
    questions.push({
      id: `cross-definition-${foldForSearch(differing.term)}`,
      kind: "single",
      prompt: words.whoseDefinition(differing.term, a),
      // A'nın tanımı hep ilk sırada olsaydı yanıt ezberlenirdi; sıra terime göre değişiyor.
      options: (() => {
        const options = [
          { label: short(differing.left, 220), correct: true, explanation: words.definedBy(a) },
          { label: short(differing.right, 220), correct: false, explanation: words.definedBy(b) },
        ];
        return [...differing.term].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 2 ? options.reverse() : options;
      })(),
      claimIds: [],
    });
  }

  // Önce her türden bir soru, sonra kalanlar: sınır yalnızca iddia sorularıyla dolmasın.
  const kind = (question: QuizQuestion) => (/^cross-(?:claim|term)-/.test(question.id) ? question.id.split("-").slice(1, 3).join("-") : question.id.split("-")[1]);
  const firsts = questions.filter((question, index) => questions.findIndex((other) => kind(other) === kind(question)) === index);
  return [...firsts, ...questions.filter((question) => !firsts.includes(question))].slice(0, MAX_CROSS_QUESTIONS);
}
