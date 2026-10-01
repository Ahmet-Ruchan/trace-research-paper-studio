import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  recordAnswer,
  resumeStepId,
  savedAnswer,
  startOverProgress,
  studyPath,
  studySummary,
  visitStep,
  type QuestionResult,
  type StudyProgress,
  type StudyStep,
} from "@/lib/study-path";
import type { Quiz, QuizQuestion, ResearchProject } from "@/lib/schema";
import { mergeStudyProgress, readStudyTransfer, studyTransferFile, studyTransferFileName } from "@/lib/study-transfer";
import { STUDY_STEP_CAP_MS } from "@/lib/work-log";
import { sectionMark } from "@/lib/reader-notes";

/** Bölüm ekine verilen: ilerleme ve onu değiştirmenin tek yolu, çalışmanın kendi kaydıyla. */
export type StudyHandle = {
  progress?: StudyProgress;
  update: (change: (previous: StudyProgress | undefined) => StudyProgress | undefined) => void;
};

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
  sectionExtra,
  conceptExtra,
  onStepTime,
}: {
  project: ResearchProject;
  /** Kanıttan üretilen okuma alıştırması; quiz'in yetmediği bölümlere soru sağlıyor. */
  drill?: Quiz;
  initialProgress?: StudyProgress;
  /** `undefined` kaydı siliyor ("Start over"). */
  onSave: (progress: StudyProgress | undefined) => void;
  /** İlerlemenin nerede saklandığı; okuyucu bilmeli. */
  note?: string;
  /**
   * Stüdyo verir: bölüm adımının sonunda "kendi cümlelerinle anlat". Görüntüleyicide
   * model yok. İlerlemeyi okuyup değiştirebiliyor: anlatışların geçmişi orada.
   */
  sectionExtra?: (sectionId: string, study: StudyHandle) => ReactNode;
  /** Stüdyo verir: kavramın kütüphanedeki başka makalelerde çalışılıp çalışılmadığı. */
  conceptExtra?: (conceptId: string) => ReactNode;
  /**
   * Stüdyo verir: adımda geçen süre, parça parça (dakikada bir, adım
   * değişince, sekme gizlenince, çıkarken). Adım başına en çok
   * `STUDY_STEP_CAP_MS`; gizli sekmede geçen süre sayılmıyor.
   */
  onStepTime?: (start: number, end: number) => void;
}) {
  const t = useStrings();
  const path = useMemo(() => studyPath(project, drill), [project, drill]);
  const terms = useMemo(() => termIndex(project), [project]);
  const figures = useMemo(() => figuresBySection(project.figures, project.story.sections), [project.figures, project.story.sections]);
  const [progress, setProgress] = useState(initialProgress);
  const [stepId, setStepId] = useState(() => resumeStepId(path, initialProgress));
  const [confirmReset, setConfirmReset] = useState(false);
  const [carryMessage, setCarryMessage] = useState<{ ok: boolean; text: string }>();
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

  // Adımda geçen süre: her adım kendi sınırıyla, yalnızca sekme görünürken.
  const stepTime = useRef(onStepTime);
  useEffect(() => {
    stepTime.current = onStepTime;
  });
  useEffect(() => {
    if (!stepTime.current) return;
    let shown: number | undefined = document.hidden ? undefined : Date.now();
    let spent = 0;
    const report = () => {
      if (shown === undefined) return;
      const at = Date.now();
      const end = Math.min(at, shown + Math.max(0, STUDY_STEP_CAP_MS - spent));
      if (end > shown) {
        stepTime.current?.(shown, end);
        spent += end - shown;
      }
      shown = document.hidden ? undefined : at;
    };
    const visibility = () => {
      if (document.hidden) report();
      else if (shown === undefined) shown = Date.now();
    };
    const tick = setInterval(report, 60_000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", visibility);
      report();
    };
  }, [stepId]);

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
    // Tekrar kartları ve anlatışlar kalıyor: yolu baştan yürümek, aylardır süren
    // tekrarları ya da okuyucunun neyi eklediğini gösteren geçmişi silmemeli.
    setProgress((previous) => startOverProgress(previous, now()));
  }

  /** İlerlemeyi bir dosyaya indiriyor (`study-transfer.ts`); başka bir cihazda yükleniyor. */
  function saveToFile() {
    if (!progress) return setCarryMessage({ ok: false, text: t.studyNothingToSave });
    const blob = new Blob([`${JSON.stringify(studyTransferFile(project, progress, now()), null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = studyTransferFileName(project);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setCarryMessage(undefined);
  }

  /** Dosyadaki ilerleme buradakiyle birleşiyor; başka makalenin dosyası hiçbir şeyi değiştirmiyor. */
  async function loadFromFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return setCarryMessage({ ok: false, text: t.studyLoadInvalid });
    }
    const outcome = readStudyTransfer(raw, project);
    if (!outcome.ok) {
      return setCarryMessage({ ok: false, text: outcome.reason === "other-paper" ? t.studyLoadOtherPaper(outcome.paperTitle) : t.studyLoadInvalid });
    }
    const merged = mergeStudyProgress(progress, outcome.progress, now());
    setProgress(merged);
    setCarryMessage({ ok: true, text: t.studyLoaded(merged.done.length, merged.answers.length, merged.reviews?.length ?? 0) });
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
          onUpdate={setProgress}
          sectionExtra={sectionExtra}
          conceptExtra={conceptExtra}
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
      <div className="study-carry">
        <button type="button" onClick={saveToFile}>{t.studySaveFile}</button>
        <label className="study-carry-load">
          {t.studyLoadFile}
          <input type="file" accept=".json,application/json" onChange={(event) => { void loadFromFile(event.currentTarget); }} />
        </label>
        <p className="study-note">{t.studyCarryHint}</p>
        {carryMessage ? <p className={carryMessage.ok ? "study-carry-message" : "study-carry-message is-error"} role="status">{carryMessage.text}</p> : null}
      </div>
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
  onUpdate: StudyHandle["update"];
  sectionExtra?: (sectionId: string, study: StudyHandle) => ReactNode;
  conceptExtra?: (conceptId: string) => ReactNode;
};

function StepContent({ step, project, terms, figures, questions, progress, summary, pathSteps, stepTitle, onAnswer, onGo, onUpdate, sectionExtra, conceptExtra }: StepContentProps) {
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
        {conceptExtra?.(concept.id)}
        {/* Vurgu ve not için işaret: Primer'deki aynı kavramla aynı yer. */}
        <div className="primer-body" lang={project.language} data-note-section={sectionMark("concept", concept.id)}>
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
        {/* Story önizlemesindeki bölümle aynı işaret: burada yapılan vurgu orada da görünüyor. */}
        <div className="study-prose" lang={project.language} data-note-section={sectionMark("story", section.id)}>
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
        {sectionExtra?.(section.id, { progress, update: onUpdate })}
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
