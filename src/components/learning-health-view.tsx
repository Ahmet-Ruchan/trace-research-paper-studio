"use client";

import { useMemo, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import type { ClaimPolicy, SectionTarget } from "@/lib/section-regeneration";
import { QUIZ_KINDS_TO_COVER, describeMissingBlocks, learningHealth, spareQuestion, type QuizKindToCover } from "@/lib/learning-health";
import { REWRITE_PRESETS } from "@/lib/rewrite-presets";
import type { ResearchProject } from "@/lib/schema";

type Rewrite = (target: SectionTarget, options: { claimPolicy?: ClaimPolicy; instruction: string }) => void;

/** Modele giden yeniden yazım isteğinin parçası; ekranda görünmüyor, çevrilmiyor. */
const kindAsks: Record<QuizKindToCover, string> = {
  "reported-result": "a result the paper measured, and what it does and does not show",
  "author-interpretation": "the difference between what the authors measured and how they interpret it",
  limitation: "a limitation the paper itself states",
};

const DERIVATION_INSTRUCTION =
  "Give every step a rationale that says why it follows from the previous step. Do not repeat what the formula already says.";
const CONCEPT_INSTRUCTION = `${REWRITE_PRESETS.primer.find((preset) => preset.id === "connect")!.instruction} Cite the claims where the paper relies on it.`;

/**
 * Öğrenme sağlığı paneli (stüdyo). Her bulgu, onu gideren yeniden üretimi
 * hazır bir istekle açıyor; istek metin kutusunda görünüyor ve kanıt kilidi
 * her zamanki gibi geçerli. Yeniden üretilemeyen türlerde (etkileşimli
 * keşifler) panel yalnızca nereye bakılacağını gösteriyor.
 */
export function LearningHealthView({
  project,
  onRewrite,
  onAddLearning,
  onOpenPractice,
}: {
  project: ResearchProject;
  onRewrite?: Rewrite;
  onAddLearning?: () => void;
  onOpenPractice?: () => void;
}) {
  const learning = useT().learning;
  const t = learning.learningHealth;
  const health = useMemo(() => learningHealth(project), [project]);
  const quizIds = project.quiz?.questions.map((question) => question.id) ?? [];
  const spare = spareQuestion(health, quizIds);
  const concepts = project.primer?.concepts.length ?? 0;
  const playgrounds = (project.interactives ?? []).filter((item) => item.kind === "formula-playground").length;
  const claimsOfKind = (kind: QuizKindToCover) => project.evidence.claims.filter((claim) => claim.kind === kind).map((claim) => claim.id);

  return (
    <div className="health learning-health">
      <div className="health-stats">
        {project.quiz ? (
          <Stat
            value={`${health.sections.length - health.uncheckedSections.length}/${health.sections.length}`}
            label={t.sectionsChecked}
            note={health.uncheckedSections.length ? t.sectionsSkippable(health.uncheckedSections.length) : t.everySectionChecked}
            ratio={health.sections.length ? 1 - health.uncheckedSections.length / health.sections.length : 0}
          />
        ) : null}
        {health.quiz ? (
          <Stat
            value={`${QUIZ_KINDS_TO_COVER.length - health.quiz.uncovered.length}/${QUIZ_KINDS_TO_COVER.length}`}
            label={t.kindsAsked}
            note={QUIZ_KINDS_TO_COVER.map((kind) => t.onKind(health.quiz!.byKind[kind], t.kinds[kind].plural)).join(" · ")}
            ratio={1 - health.quiz.uncovered.length / QUIZ_KINDS_TO_COVER.length}
          />
        ) : null}
        {concepts ? (
          <Stat
            value={`${concepts - health.unusedConcepts.length}/${concepts}`}
            label={t.conceptsUsed}
            note={health.unusedConcepts.length ? t.conceptsUnneeded(health.unusedConcepts.length) : t.everyConceptPrepares}
            ratio={1 - health.unusedConcepts.length / concepts}
          />
        ) : null}
        {playgrounds ? (
          <Stat
            value={`${playgrounds - health.flatPlaygrounds.length}/${playgrounds}`}
            label={t.playgroundsRespond}
            note={health.flatPlaygrounds.length ? t.playgroundsFlat(health.flatPlaygrounds.length) : t.everySliderChanges}
            ratio={1 - health.flatPlaygrounds.length / playgrounds}
          />
        ) : null}
      </div>

      {!health.findings ? (
        <p className="health-note learning-health-clear" role="status">
          {t.clear}
        </p>
      ) : null}

      {health.missingBlocks.length ? (
        <Finding title={t.missingTitle} note={t.missingNote(learning.depthNames[project.depth], describeMissingBlocks(health.missingBlocks, learning.words.missingBlocks))}>
          {onAddLearning ? <button type="button" className="health-strengthen" onClick={onAddLearning}>{t.addLearning}</button> : null}
        </Finding>
      ) : null}

      {health.uncheckedSections.length ? (
        <Finding
          title={t.uncheckedTitle}
          note={t.uncheckedNote}
          rows={health.uncheckedSections.map((section) => ({
            key: section.id,
            area: t.areaSection,
            title: `${section.indexLabel ? `${section.indexLabel} · ` : ""}${section.title}`,
            lang: project.language,
            detail: t.claimCount(section.claimIds.length),
            action: onRewrite && spare ? (
              <button
                type="button"
                className="health-strengthen"
                onClick={() => onRewrite({ kind: "quiz", sectionId: spare }, {
                  claimPolicy: "open",
                  instruction: `Rewrite this question so that it tests the section "${section.title.slice(0, 120)}". Cite claims that section rests on: ${section.claimIds.slice(0, 4).join(", ")}. Test understanding, not recall.`,
                })}
              >
                {t.pointQuestion}
              </button>
            ) : null,
          }))}
        />
      ) : null}

      {health.quiz?.uncovered.length ? (
        <Finding
          title={t.uncoveredTitle}
          note={t.uncoveredNote}
          rows={health.quiz.uncovered.map((kind) => ({
            key: kind,
            area: t.areaQuiz,
            title: t.kinds[kind].label,
            detail: t.inEvidence(claimsOfKind(kind).length),
            action: onRewrite && spare ? (
              <button
                type="button"
                className="health-strengthen"
                onClick={() => onRewrite({ kind: "quiz", sectionId: spare }, {
                  claimPolicy: "open",
                  instruction: `Rewrite this question to ask about ${kindAsks[kind]}. Cite one of: ${claimsOfKind(kind).slice(0, 4).join(", ")}.`,
                })}
              >
                {t.rewriteQuestion}
              </button>
            ) : null,
          }))}
        />
      ) : null}

      {health.flatPlaygrounds.length ? (
        <Finding
          title={t.flatTitle}
          note={t.flatNote}
          rows={health.flatPlaygrounds.map((item) => ({
            key: item.id,
            area: t.areaPlayground,
            title: item.title,
            lang: project.language,
            detail: item.reason === "outputs" ? t.flatOutputs : t.flatChart,
            action: onOpenPractice ? <button type="button" className="health-strengthen" onClick={onOpenPractice}>{t.openIt}</button> : null,
          }))}
        />
      ) : null}

      {health.restatingSteps.length ? (
        <Finding
          title={t.restatingTitle}
          note={t.restatingNote}
          rows={health.restatingSteps.map((item) => ({
            key: item.derivationId,
            area: t.areaDerivation,
            title: item.title,
            lang: project.language,
            detail: t.steps(item.stepIds.length),
            action: onRewrite ? (
              <button
                type="button"
                className="health-strengthen"
                onClick={() => onRewrite({ kind: "derivation", sectionId: item.derivationId }, { claimPolicy: "locked", instruction: DERIVATION_INSTRUCTION })}
              >
                {t.rewriteDerivation}
              </button>
            ) : null,
          }))}
        />
      ) : null}

      {health.unusedConcepts.length ? (
        <Finding
          title={t.unusedTitle}
          note={t.unusedNote}
          rows={health.unusedConcepts.map((concept) => ({
            key: concept.id,
            area: t.areaConcept,
            title: concept.term,
            lang: project.language,
            detail: "",
            action: onRewrite ? (
              <button
                type="button"
                className="health-strengthen"
                onClick={() => onRewrite({ kind: "primer", sectionId: concept.id }, { claimPolicy: "open", instruction: CONCEPT_INSTRUCTION })}
              >
                {t.tieIt}
              </button>
            ) : null,
          }))}
        />
      ) : null}
    </div>
  );
}

type Row = { key: string; area: string; title: string; lang?: string; detail: string; action: ReactNode };

function Finding({ title, note, rows = [], children }: { title: string; note: string; rows?: Row[]; children?: ReactNode }) {
  return (
    <section className="health-block">
      <h4>{title}</h4>
      <p className="health-note">{note}</p>
      {children}
      {rows.length ? (
        <ul className="health-thin">
          {rows.map((row) => (
            <li key={row.key}>
              <span className="health-area">{row.area}</span>
              <span className="health-thin-title" lang={row.lang}>{row.title}</span>
              <span className="health-thin-count">{row.detail}</span>
              {row.action}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Stat({ value, label, note, ratio }: { value: string; label: string; note: string; ratio: number }) {
  const t = useT().learning.learningHealth;
  const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <article className="health-stat">
      <strong>{value}</strong>
      <span>{label}</span>
      <div className="health-meter" role="img" aria-label={t.percent(percent)}>
        <i className={percent >= 80 ? "is-good" : percent >= 50 ? "is-fair" : "is-weak"} style={{ width: `${percent}%` }} />
      </div>
      <small>{note}</small>
    </article>
  );
}
