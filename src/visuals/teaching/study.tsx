import { useEffect, useMemo, useRef, useState } from "react";
import { useStrings } from "../language-context";
import { InteractiveRenderer } from "../interactive-renderer";
import { VisualRenderer } from "../visual-renderer";
import { SectionPrerequisites, TermParagraphs } from "../term-text";
import { ApplicationGuideView } from "./application-guide";
import { DerivationView } from "./derivations";
import { FiguresView, figuresBySection } from "./figures";
import { MisreadingsView } from "./misreadings";
import { ConceptBody, prerequisiteTerms } from "./primer";
import { QuizView } from "./quiz";
import { sectionPrerequisites, termIndex } from "@/lib/term-index";
import {
  completeStep,
  emptyStudyProgress,
  recordAnswer,
  resumeStepId,
  savedAnswer,
  studyPath,
  studySummary,
  visitStep,
  type QuestionResult,
  type StudyProgress,
  type StudyStep,
} from "@/lib/study-path";
import type { Quiz, QuizQuestion, ResearchProject } from "@/lib/schema";

/**
 * Rehberli çalışma: makaleyi adım adım, her bölümün ardından bir soruyla.
 * Yol `study-path.ts`'te kuruluyor; bu bileşen yalnızca bir adımı gösteriyor
 * ve ilerlemeyi host'a bildiriyor. Stüdyo kütüphaneye, görüntüleyici
 * tarayıcıya yazıyor; bileşen hangisi olduğunu bilmiyor.
 */
export function StudyView({
  project,
  drill,
  initialProgress,
  onSave,
  note,
}: {
  project: ResearchProject;
  /** Kanıttan üretilen okuma alıştırması; quiz'in yetmediği bölümlere soru sağlıyor. */
  drill?: Quiz;
  initialProgress?: StudyProgress;
  /** `undefined` kaydı siliyor ("Start over"). */
  onSave: (progress: StudyProgress | undefined) => void;
  /** İlerlemenin nerede saklandığı; okuyucu bilmeli. */
  note?: string;
}) {
  const t = useStrings();
  const path = useMemo(() => studyPath(project, drill), [project, drill]);
  const terms = useMemo(() => termIndex(project), [project]);
  const figures = useMemo(() => figuresBySection(project.figures, project.story.sections), [project.figures, project.story.sections]);
  const [progress, setProgress] = useState(initialProgress);
  const [stepId, setStepId] = useState(() => resumeStepId(path, initialProgress));
  const [confirmReset, setConfirmReset] = useState(false);
  const root = useRef<HTMLElement>(null);
  const outline = useRef<HTMLDetailsElement>(null);
  const moved = useRef(false);
  const saved = useRef(initialProgress);

  // Her değişiklik kaydediliyor; ilk çizim kaydı değiştirmiyor.
  useEffect(() => {
    if (progress === saved.current) return;
    saved.current = progress;
    onSave(progress);
  }, [progress, onSave]);

  // Adım değişince okuyucu yeni adımın başına dönüyor; açılışta sayfa kaymıyor.
  useEffect(() => {
    if (!moved.current) return;
    root.current?.scrollIntoView({ block: "start" });
  }, [stepId]);

  const index = Math.max(0, path.steps.findIndex((step) => step.id === stepId));
  const step = path.steps[index];
  const summary = studySummary(project, path, progress);
  const done = new Set(progress?.done ?? []);
  const now = () => new Date().toISOString();

  function go(id: string) {
    moved.current = true;
    // Adım listesi bir menü gibi: seçilince kapanıyor, yeni adım görünür kalıyor.
    if (outline.current) outline.current.open = false;
    setConfirmReset(false);
    setStepId(id);
    setProgress((previous) => visitStep(previous, id, now()));
  }

  function next() {
    const following = path.steps[index + 1];
    moved.current = true;
    setStepId(following?.id ?? step.id);
    setProgress((previous) => completeStep(previous, step.id, following?.id, now()));
  }

  function answer(question: QuizQuestion, result: QuestionResult) {
    setProgress((previous) => recordAnswer(previous, question, result, now()));
  }

  function startOver() {
    moved.current = true;
    setConfirmReset(false);
    setStepId(path.steps[0].id);
    // Tekrar kartları kalıyor: yolu baştan yürümek, aylardır süren tekrarları silmemeli.
    setProgress((previous) => (previous?.reviews?.length ? { ...emptyStudyProgress(now()), reviews: previous.reviews } : undefined));
  }

  function title(item: StudyStep) {
    if (item.kind === "start") return t.studyStartTitle;
    if (item.kind === "quiz") return t.studyFinalTitle;
    if (item.kind === "finish") return t.studyFinishTitle;
    return item.title;
  }

  const following = path.steps[index + 1];
  const unansweredCheck = step.kind === "section" && step.checkId && !savedAnswer(progress, path.questions.get(step.checkId)!);
  const nextLabel = step.kind === "start"
    ? t.studyBegin
    : unansweredCheck ? t.studySkipCheck : following?.kind === "finish" ? t.studyToResults : t.studyNext;

  return (
    <section className="study" ref={root} aria-label={t.studyHeading}>
      <header className="study-head">
        <div className="study-meta">
          <span className="study-phase">{t.studyPhases[step.phase]}</span>
          <span>{t.studyStepOf(index + 1, path.steps.length)}</span>
        </div>
        <div
          className="study-bar"
          role="progressbar"
          aria-label={t.studyProgress}
          aria-valuemin={0}
          aria-valuemax={summary.total}
          aria-valuenow={summary.done}
        >
          <i style={{ width: `${summary.total ? (summary.done / summary.total) * 100 : 0}%` }} />
        </div>
        <details className="study-outline" ref={outline}>
          <summary>{t.studyAllSteps} · {t.studyDoneOf(summary.done, summary.total)}</summary>
          <ol>
            {path.steps.map((item, position) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={done.has(item.id) ? "is-done" : ""}
                  aria-current={item.id === step.id ? "step" : undefined}
                  onClick={() => go(item.id)}
                >
                  <span aria-hidden="true">{done.has(item.id) ? "✓" : String(position + 1).padStart(2, "0")}</span>
                  <b>{t.studyPhases[item.phase]}</b>
                  <em>{title(item)}</em>
                </button>
              </li>
            ))}
          </ol>
        </details>
      </header>

      <div className="study-body" key={step.id}>
        <StepContent
          step={step}
          project={project}
          terms={terms}
          figures={figures}
          questions={path.questions}
          progress={progress}
          summary={summary}
          pathSteps={path.steps}
          stepTitle={title}
          onAnswer={answer}
          onGo={go}
        />
      </div>

      <footer className="study-nav">
        <button type="button" className="study-back" onClick={() => index > 0 && go(path.steps[index - 1].id)} disabled={index === 0}>
          ← {t.studyBack}
        </button>
        {step.kind === "finish" ? (
          confirmReset ? (
            <span className="study-reset">
              {t.studyStartOverConfirm}
              <button type="button" className="study-danger" onClick={startOver}>{t.studyClear}</button>
              <button type="button" onClick={() => setConfirmReset(false)}>{t.studyKeep}</button>
            </span>
          ) : (
            <button type="button" className="study-back" onClick={() => setConfirmReset(true)}>{t.studyStartOver}</button>
          )
        ) : (
          <button type="button" className="study-next" onClick={next}>{nextLabel} →</button>
        )}
      </footer>
      {note ? <p className="study-note">{note}</p> : null}
    </section>
  );
}

const SKIPPED_SHOWN = 5;

type StepContentProps = {
  step: StudyStep;
  project: ResearchProject;
  terms: ReturnType<typeof termIndex>;
  figures: ReturnType<typeof figuresBySection>;
  questions: ReadonlyMap<string, QuizQuestion>;
  progress?: StudyProgress;
  summary: ReturnType<typeof studySummary>;
  pathSteps: readonly StudyStep[];
  stepTitle: (step: StudyStep) => string;
  onAnswer: (question: QuizQuestion, result: QuestionResult) => void;
  onGo: (stepId: string) => void;
};

function StepContent({ step, project, terms, figures, questions, progress, summary, pathSteps, stepTitle, onAnswer, onGo }: StepContentProps) {
  const t = useStrings();
  const { evidence, story } = project;

  if (step.kind === "start") {
    const count = (kind: StudyStep["kind"]) => pathSteps.filter((item) => item.kind === kind).length;
    const sections = pathSteps.filter((item) => item.kind === "section");
    const checks = sections.filter((item) => item.kind === "section" && item.checkId).length;
    const work = count("derivation") + count("interactive");
    const quiz = pathSteps.find((item) => item.kind === "quiz");
    return (
      <div className="study-start">
        <h2 className="study-title">{t.studyStartTitle}</h2>
        <p className="study-question" lang={project.language}>{evidence.researchQuestion}</p>
        <blockquote className="study-thesis">
          <span>{t.thesis}</span>
          <p lang={project.language}>{evidence.thesis}</p>
        </blockquote>
        <h3 className="study-subhead">{t.studyAhead}</h3>
        <ol className="study-ahead">
          {count("concept") ? <li><b>{t.studyPhases.prepare}</b> {t.studyAheadConcepts(count("concept"))}</li> : null}
          <li><b>{t.studyPhases.read}</b> {t.studyAheadSections(sections.length, checks)}</li>
          {work ? <li><b>{t.studyPhases.work}</b> {t.studyAheadWork(work)}</li> : null}
          {project.misreadings ? <li><b>{t.studyPhases.check}</b> {t.studyAheadMisreadings(project.misreadings.items.length)}</li> : null}
          {quiz?.kind === "quiz" ? <li><b>{t.studyPhases.check}</b> {t.studyAheadQuiz(quiz.questionIds.length)}</li> : null}
          {project.applicationGuide ? <li><b>{t.studyPhases.apply}</b> {t.studyAheadGuide}</li> : null}
        </ol>
      </div>
    );
  }

  if (step.kind === "concept" && project.primer) {
    const concept = project.primer.concepts.find((item) => item.id === step.conceptId);
    if (!concept) return null;
    return (
      <article className="study-concept">
        <span className={`primer-level level-${concept.level}`}>{t.levels[concept.level]}</span>
        <h2 className="study-title" lang={project.language}>{concept.term}</h2>
        <div className="primer-body" lang={project.language}>
          <ConceptBody concept={concept} prerequisites={prerequisiteTerms(project.primer, concept)} />
        </div>
      </article>
    );
  }

  if (step.kind === "section") {
    const section = story.sections.find((item) => item.id === step.sectionId);
    if (!section) return null;
    const check = step.checkId ? questions.get(step.checkId) : undefined;
    return (
      <article className="study-section">
        <span className="study-kicker" lang={project.language}>{section.indexLabel} · {section.kicker}</span>
        <h2 className="study-title" lang={project.language}>{section.title}</h2>
        <SectionPrerequisites concepts={sectionPrerequisites(section, terms, project.language)} />
        <div className="study-prose" lang={project.language}>
          <TermParagraphs paragraphs={section.body.split("\n\n")} entries={terms} />
        </div>
        {figures.has(section.id) ? <FiguresView figures={figures.get(section.id)!} /> : null}
        <div className="study-visual">
          <VisualRenderer visual={section.visual} accent={story.accent} />
        </div>
        {check ? (
          <StudyQuestions
            title={t.studyCheckTitle}
            intro={t.studyCheckIntro}
            questions={[check]}
            project={project}
            progress={progress}
            onAnswer={onAnswer}
          />
        ) : null}
      </article>
    );
  }

  if (step.kind === "derivation") {
    const derivation = project.derivations?.find((item) => item.id === step.derivationId);
    return derivation ? <DerivationView derivation={derivation} /> : null;
  }

  if (step.kind === "interactive") {
    const interactive = project.interactives?.find((item) => item.id === step.interactiveId);
    return interactive ? <InteractiveRenderer interactive={interactive} /> : null;
  }

  if (step.kind === "misreadings") {
    return project.misreadings ? <MisreadingsView misreadings={project.misreadings} claims={evidence.claims} /> : null;
  }

  if (step.kind === "quiz") {
    return (
      <StudyQuestions
        title={t.studyFinalTitle}
        intro={t.studyFinalIntro}
        questions={step.questionIds.flatMap((id) => questions.get(id) ?? [])}
        project={project}
        progress={progress}
        onAnswer={onAnswer}
        withSections
      />
    );
  }

  if (step.kind === "guide") {
    return project.applicationGuide ? <ApplicationGuideView guide={project.applicationGuide} /> : null;
  }

  if (step.kind === "finish") {
    const jumpList = (steps: readonly StudyStep[]) => (
      <ul className="study-jumps">
        {steps.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onGo(item.id)}>
              <b>{t.studyPhases[item.phase]}</b>
              <span lang={item.kind === "start" || item.kind === "quiz" ? undefined : project.language}>{stepTitle(item)}</span>
            </button>
          </li>
        ))}
      </ul>
    );
    return (
      <div className="study-finish">
        <h2 className="study-title">{t.studyFinishTitle}</h2>
        <p className="study-result">{t.studyFinishSteps(summary.done, summary.total)}</p>
        {summary.checks.answered ? (
          <p className="study-result">{t.studyFinishChecks(summary.checks.firstTry, summary.checks.answered, summary.checks.total)}</p>
        ) : null}
        {summary.revisit.length ? (
          <section className="study-revisit">
            <h3 className="study-subhead">{t.studyRevisit}</h3>
            <p>{t.studyRevisitHint}</p>
            {jumpList(summary.revisit)}
          </section>
        ) : summary.checks.answered ? (
          <p className="study-clear">{t.studyAllClear}</p>
        ) : null}
        {summary.skipped.length ? (
          <section className="study-skipped">
            <h3 className="study-subhead">{t.studySkipped}</h3>
            {/* Yirmi adımlık bir liste yol göstermiyor; ilk birkaçı ve kalanın sayısı yetiyor. */}
            {jumpList(summary.skipped.slice(0, SKIPPED_SHOWN))}
            {summary.skipped.length > SKIPPED_SHOWN ? (
              <p className="study-more">{t.studyMoreSteps(summary.skipped.length - SKIPPED_SHOWN)}</p>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  }

  return null;
}

/**
 * Yoldaki sorular. Daha önce yanıtlanmış bir soru önce son sonucu gösteriyor;
 * okuyucu isterse yeniden yanıtlıyor. Soru yeniden yazıldıysa eski sonuç
 * sayılmıyor (`savedAnswer` mührü karşılaştırıyor).
 */
function StudyQuestions({
  title,
  intro,
  questions,
  project,
  progress,
  onAnswer,
  withSections = false,
}: {
  title: string;
  intro: string;
  questions: readonly QuizQuestion[];
  project: ResearchProject;
  progress?: StudyProgress;
  onAnswer: (question: QuizQuestion, result: QuestionResult) => void;
  /** Son sınavda "makalede nerede" bağlantıları; bölüm sorusunda bölüm zaten üstte. */
  withSections?: boolean;
}) {
  const t = useStrings();
  const answered = questions.flatMap((question) => savedAnswer(progress, question) ?? []);
  const [fresh, setFresh] = useState(answered.length < questions.length);
  if (!questions.length) return null;

  if (!fresh) {
    return (
      <section className="study-check quiz">
        <header className="quiz-head">
          <h3>{title}</h3>
        </header>
        {questions.length === 1 ? (
          <p className="study-saved">{t.studyYourAnswer(answered[0])}</p>
        ) : (
          <p className="study-saved">{t.score(answered.filter((answer) => answer.correct && answer.attempts === 1).length, answered.length)}</p>
        )}
        <button type="button" className="quiz-check" onClick={() => setFresh(true)}>{t.studyAnswerAgain}</button>
      </section>
    );
  }

  return (
    <div className="study-check">
      <QuizView
        quiz={{ title, intro, questions: [...questions] }}
        claims={project.evidence.claims}
        sections={withSections ? project.story.sections : []}
        onResult={onAnswer}
      />
    </div>
  );
}
