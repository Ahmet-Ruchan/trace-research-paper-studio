"use client";

import { useMemo, type ReactNode } from "react";
import type { ClaimPolicy, SectionTarget } from "@/lib/section-regeneration";
import { QUIZ_KINDS_TO_COVER, describeMissingBlocks, learningHealth, spareQuestion, type QuizKindToCover } from "@/lib/learning-health";
import { REWRITE_PRESETS } from "@/lib/rewrite-presets";
import type { ResearchProject } from "@/lib/schema";

type Rewrite = (target: SectionTarget, options: { claimPolicy?: ClaimPolicy; instruction: string }) => void;

const kindNames: Record<QuizKindToCover, { label: string; plural: string; ask: string }> = {
  "reported-result": { label: "Results", plural: "measured results", ask: "a result the paper measured, and what it does and does not show" },
  "author-interpretation": {
    label: "Interpretations",
    plural: "author interpretations",
    ask: "the difference between what the authors measured and how they interpret it",
  },
  limitation: { label: "Limitations", plural: "limitations", ask: "a limitation the paper itself states" },
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
            label="Sections a question checks"
            note={health.uncheckedSections.length ? `${health.uncheckedSections.length} can be skipped without anyone noticing.` : "Every section is checked."}
            ratio={health.sections.length ? 1 - health.uncheckedSections.length / health.sections.length : 0}
          />
        ) : null}
        {health.quiz ? (
          <Stat
            value={`${QUIZ_KINDS_TO_COVER.length - health.quiz.uncovered.length}/${QUIZ_KINDS_TO_COVER.length}`}
            label="Kinds of claim the quiz asks about"
            note={QUIZ_KINDS_TO_COVER.map((kind) => `${health.quiz!.byKind[kind]} on ${kindNames[kind].plural}`).join(" · ")}
            ratio={1 - health.quiz.uncovered.length / QUIZ_KINDS_TO_COVER.length}
          />
        ) : null}
        {concepts ? (
          <Stat
            value={`${concepts - health.unusedConcepts.length}/${concepts}`}
            label="Concepts the paper uses"
            note={health.unusedConcepts.length ? `${health.unusedConcepts.length} nothing in the story or report needs.` : "Each one prepares something."}
            ratio={1 - health.unusedConcepts.length / concepts}
          />
        ) : null}
        {playgrounds ? (
          <Stat
            value={`${playgrounds - health.flatPlaygrounds.length}/${playgrounds}`}
            label="Playgrounds that respond"
            note={health.flatPlaygrounds.length ? `${health.flatPlaygrounds.length} show the same thing whatever the sliders say.` : "Every slider changes something."}
            ratio={1 - health.flatPlaygrounds.length / playgrounds}
          />
        ) : null}
      </div>

      {!health.findings ? (
        <p className="health-note learning-health-clear" role="status">
          Nothing to fix: every section is checked by a question, the quiz asks about results, interpretations and limitations,
          every playground responds, every derivation step explains itself and every concept prepares something.
        </p>
      ) : null}

      {health.missingBlocks.length ? (
        <Finding title="Missing from the learning layer" note={`At depth ${project.depth} a reader should also get ${describeMissingBlocks(health.missingBlocks)}.`}>
          {onAddLearning ? <button type="button" className="health-strengthen" onClick={onAddLearning}>Add the learning layer</button> : null}
        </Finding>
      ) : null}

      {health.uncheckedSections.length ? (
        <Finding
          title="Sections no question checks"
          note="A reader can finish the quiz without being asked about these. Rewriting a question that another question already duplicates closes the gap without opening a new one."
          rows={health.uncheckedSections.map((section) => ({
            key: section.id,
            area: "Section",
            title: `${section.indexLabel ? `${section.indexLabel} · ` : ""}${section.title}`,
            lang: project.language,
            detail: `${section.claimIds.length} claims`,
            action: onRewrite && spare ? (
              <button
                type="button"
                className="health-strengthen"
                onClick={() => onRewrite({ kind: "quiz", sectionId: spare }, {
                  claimPolicy: "open",
                  instruction: `Rewrite this question so that it tests the section "${section.title.slice(0, 120)}". Cite claims that section rests on: ${section.claimIds.slice(0, 4).join(", ")}. Test understanding, not recall.`,
                })}
              >
                Point a question here
              </button>
            ) : null,
          }))}
        />
      ) : null}

      {health.quiz?.uncovered.length ? (
        <Finding
          title="What the quiz never asks about"
          note="The evidence has claims of these kinds, but no question rests on one. Telling a measurement from an interpretation, and knowing where a result stops, is most of reading a paper well."
          rows={health.quiz.uncovered.map((kind) => ({
            key: kind,
            area: "Quiz",
            title: kindNames[kind].label,
            detail: `${claimsOfKind(kind).length} in the evidence`,
            action: onRewrite && spare ? (
              <button
                type="button"
                className="health-strengthen"
                onClick={() => onRewrite({ kind: "quiz", sectionId: spare }, {
                  claimPolicy: "open",
                  instruction: `Rewrite this question to ask about ${kindNames[kind].ask}. Cite one of: ${claimsOfKind(kind).slice(0, 4).join(", ")}.`,
                })}
              >
                Rewrite a question
              </button>
            ) : null,
          }))}
        />
      ) : null}

      {health.flatPlaygrounds.length ? (
        <Finding
          title="Playgrounds that show nothing"
          note="Each slider was swept over its range with the others at the paper's values. A playground whose outputs never move teaches nothing by being played with."
          rows={health.flatPlaygrounds.map((item) => ({
            key: item.id,
            area: "Playground",
            title: item.title,
            lang: project.language,
            detail: item.reason === "outputs" ? "no output changes" : "the chart is a flat line",
            action: onOpenPractice ? <button type="button" className="health-strengthen" onClick={onOpenPractice}>Open it</button> : null,
          }))}
        />
      ) : null}

      {health.restatingSteps.length ? (
        <Finding
          title="Derivation steps that only restate their formula"
          note="The rationale is what teaches: why a step follows from the one before. These steps repeat their own formula in words."
          rows={health.restatingSteps.map((item) => ({
            key: item.derivationId,
            area: "Derivation",
            title: item.title,
            lang: project.language,
            detail: `${item.stepIds.length} ${item.stepIds.length === 1 ? "step" : "steps"}`,
            action: onRewrite ? (
              <button
                type="button"
                className="health-strengthen"
                onClick={() => onRewrite({ kind: "derivation", sectionId: item.derivationId }, { claimPolicy: "locked", instruction: DERIVATION_INSTRUCTION })}
              >
                Rewrite derivation
              </button>
            ) : null,
          }))}
        />
      ) : null}

      {health.unusedConcepts.length ? (
        <Finding
          title="Concepts nothing uses"
          note="No story section, report paragraph or question rests on these or names them, and no used concept builds on them. Tie each to the paper, or it is background the reader does not need."
          rows={health.unusedConcepts.map((concept) => ({
            key: concept.id,
            area: "Concept",
            title: concept.term,
            lang: project.language,
            detail: "",
            action: onRewrite ? (
              <button
                type="button"
                className="health-strengthen"
                onClick={() => onRewrite({ kind: "primer", sectionId: concept.id }, { claimPolicy: "open", instruction: CONCEPT_INSTRUCTION })}
              >
                Tie it to the paper
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
  const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <article className="health-stat">
      <strong>{value}</strong>
      <span>{label}</span>
      <div className="health-meter" role="img" aria-label={`${percent}%`}>
        <i className={percent >= 80 ? "is-good" : percent >= 50 ? "is-fair" : "is-weak"} style={{ width: `${percent}%` }} />
      </div>
      <small>{note}</small>
    </article>
  );
}
