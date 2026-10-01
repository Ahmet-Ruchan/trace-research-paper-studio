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
const page = (claim: Claim) => (claim.sourceRefs[0]?.page ? `p. ${claim.sourceRefs[0].page}` : "its sources");

/** Bir makalenin, öbüründe aynısı olmayan, sayfası doğrulanmış iddiaları (sonuç ve yöntem önce). */
function distinctClaims(own: ResearchProject, other: ResearchProject, count: number) {
  const others = new Set(other.evidence.claims.map((claim) => foldForSearch(claim.statement)));
  const rank = { "reported-result": 0, method: 1, "author-interpretation": 2, limitation: 3, background: 4 } as const;
  return own.evidence.claims
    .filter((claim) => claim.confidence === "verified" && !others.has(foldForSearch(claim.statement)))
    .sort((left, right) => rank[left.kind] - rank[right.kind])
    .slice(0, count);
}

export function crossPaperQuestions(left: ResearchProject, right: ResearchProject): QuizQuestion[] {
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
      prompt: `Which paper says this? “${short(claim.statement, 260)}”`,
      options: papers.map((option, index) => ({
        ...option,
        correct: index === owner,
        explanation: index === owner ? `Yes: ${page(claim)} of this paper, “${short(claim.sourceRefs[0]?.excerpt ?? claim.statement)}”` : "Not in this paper's evidence.",
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
      prompt: "Which of the two papers came out first?",
      options: papers.map((option, index) => ({ ...option, correct: index === earlier, explanation: `${index === 0 ? a : b} is from ${index === 0 ? yearA : yearB}.` })),
      claimIds: [],
    });
  }

  // Ortak bir ölçüt: hangisi daha yüksek (iyi ya da kötü olduğuna karar vermeden).
  const comparison = compareProjects(left, right);
  for (const metric of comparison.sharedMetrics.filter((item) => item.left.value !== item.right.value).slice(0, 2)) {
    const higher = metric.left.value > metric.right.value ? 0 : 1;
    const where = (side: typeof metric.left) => `${side.displayValue}${side.page ? ` (p. ${side.page})` : ""}`;
    questions.push({
      id: `cross-metric-${metric.key}`,
      kind: "single",
      prompt: `Both papers report ${metric.label}${metric.unit ? ` (${metric.unit})` : ""}. Which reports the higher value?`,
      options: papers.map((option, index) => ({ ...option, correct: index === higher, explanation: `${index === 0 ? a : b}: ${where(index === 0 ? metric.left : metric.right)}. Higher is not always better; the paper says which way is good.` })),
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
      prompt: `Which paper defines “${term}” in its glossary?`,
      options: papers.map((option, index) => ({ ...option, correct: index === owner, explanation: index === owner ? `It does; the other paper's glossary has no “${term}”.` : `Its glossary has no “${term}”.` })),
      claimIds: [],
    });
  }
  const differing = comparison.sharedTerms.find((term) => !term.identical);
  if (differing) {
    questions.push({
      id: `cross-definition-${foldForSearch(differing.term)}`,
      kind: "single",
      prompt: `Both papers define “${differing.term}”. Which definition is from ${a}?`,
      // A'nın tanımı hep ilk sırada olsaydı yanıt ezberlenirdi; sıra terime göre değişiyor.
      options: (() => {
        const options = [
          { label: short(differing.left, 220), correct: true, explanation: `This is how ${a} defines it.` },
          { label: short(differing.right, 220), correct: false, explanation: `This is how ${b} defines it.` },
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
