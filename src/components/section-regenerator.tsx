"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gauge, KeyRound, Lock, RefreshCw, Server, ShieldPlus, Sparkles, Undo2, Unlock, X } from "lucide-react";
import { MIN_SECTION_CLAIMS, isThinSection } from "@/lib/evidence-health";
import { IntegrityError, describeValidationError } from "@/lib/generation-validation";
import { readGenerationStream, type GenerationProgress } from "@/lib/generation-events";
import { DEFAULT_LOCAL_ENDPOINT } from "@/lib/local-endpoint";
import {
  defaultModelByProvider,
  getProvider,
  providerCatalog,
  resolveProviderModel,
  type ModelAssignment,
  type ProviderId,
} from "@/lib/model-providers";
import type { RevisionReason } from "@/lib/project-revisions";
import type { DeepReportSection, Derivation, PrimerConcept, QuizQuestion, ResearchProject, StorySection, TechnicalAppendix } from "@/lib/schema";
import type { ProbeVerdict } from "@/lib/model-probe";
import { requestModelProbe } from "@/lib/model-probe-client";
import {
  MAX_REGENERATION_INSTRUCTION,
  buildSectionRegenerationPrompt,
  findSection,
  sectionKindInfo,
  sectionTitle,
  spliceSection,
  type ClaimPolicy,
  type RegeneratedSection,
  type RegenerationGoal,
  type SectionTarget,
} from "@/lib/section-regeneration";
import { MathText } from "@/visuals";
import { VisualRenderer } from "./visual-renderer";

/**
 * Seçilen model hatırlanıyor, anahtar HİÇBİR ZAMAN. Güven modeli ilk
 * üretimdekiyle aynı: anahtar yalnızca etkin istek için bellekte durur.
 */
const MODEL_PREFERENCE_KEY = "trace-regeneration-model-v1";

function rememberedAssignment(): ModelAssignment | undefined {
  try {
    const raw = window.localStorage.getItem(MODEL_PREFERENCE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as { provider?: unknown; model?: unknown };
    return resolveProviderModel(String(value.provider ?? ""), String(value.model ?? ""));
  } catch {
    return undefined;
  }
}

function initialAssignment(project: ResearchProject, target: SectionTarget): ModelAssignment {
  const role = sectionKindInfo(target.kind).taskRole;
  const used = project.generation?.assignments?.[role];
  return (
    rememberedAssignment() ??
    (used ? resolveProviderModel(used.provider, used.model) : undefined) ??
    { provider: "gemini", model: defaultModelByProvider.gemini }
  );
}

type Phase =
  | { name: "form" }
  | { name: "running"; progress: GenerationProgress }
  | { name: "review"; section: RegeneratedSection; evidenceFingerprint: string }
  | { name: "failed"; message: string };

type ProbeState =
  | { name: "idle" }
  | { name: "running" }
  | { name: "done"; verdict: ProbeVerdict; message: string }
  | { name: "failed"; message: string };

type RegeneratorProps = {
  project: ResearchProject;
  target: SectionTarget;
  goal?: RegenerationGoal;
  /** Reddedilmiş bir iddiaya dayanan bölüm yeniden yazılırken kilit baştan açık gelir. */
  claimPolicy?: ClaimPolicy;
  onApply: (next: ResearchProject, previous: RegeneratedSection) => void;
  onClose: () => void;
};

export function SectionRegenerator({ project, target, goal = "revise", claimPolicy: initialClaimPolicy, onApply, onClose }: RegeneratorProps) {
  const current = useMemo(() => findSection(project, target), [project, target]);
  const [assignment, setAssignment] = useState<ModelAssignment>(() => initialAssignment(project, target));
  const [apiKey, setApiKey] = useState("");
  const [instruction, setInstruction] = useState("");
  // Güçlendirmek başka iddialara dayanmak demek; kilit bu hedefte anlamsız.
  const [claimPolicy, setClaimPolicy] = useState<ClaimPolicy>(initialClaimPolicy ?? (goal === "strengthen" ? "open" : "locked"));
  const strengthen = goal === "strengthen";
  const [phase, setPhase] = useState<Phase>({ name: "form" });
  const [applyIssues, setApplyIssues] = useState<string[]>([]);
  const [probe, setProbe] = useState<ProbeState>({ name: "idle" });
  const controller = useRef<AbortController | undefined>(undefined);
  const probeController = useRef<AbortController | undefined>(undefined);
  const provider = getProvider(assignment.provider)!;

  useEffect(() => () => {
    controller.current?.abort();
    probeController.current?.abort();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase.name !== "running") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase.name]);

  function chooseProvider(id: ProviderId) {
    setAssignment({ provider: id, model: defaultModelByProvider[id] });
    setApiKey("");
    setProbe({ name: "idle" });
  }

  function chooseModel(model: string) {
    setAssignment({ provider: provider.id, model });
    setProbe({ name: "idle" });
  }

  /**
   * Bölümü göndermeden önce modelin hızını ölçer. Yerel bir modelle yapılan
   * gerçek denemede istek on beş dakika sessizce bekleyip zaman aşımına
   * uğradı; bunu önceden söylemenin tek yolu kısa bir deneme.
   */
  async function testModel() {
    const selection = resolveProviderModel(assignment.provider, assignment.model);
    if (!selection) {
      setProbe({ name: "failed", message: "The model name is not valid for this provider." });
      return;
    }
    if (!provider.local && !apiKey.trim()) {
      setProbe({ name: "failed", message: `${provider.keyLabel} is required.` });
      return;
    }
    probeController.current?.abort();
    const abort = new AbortController();
    probeController.current = abort;
    setProbe({ name: "running" });
    try {
      const promptCharacters = buildSectionRegenerationPrompt(project, target, { claimPolicy, instruction, goal }).length;
      const answer = await requestModelProbe({ assignment: selection, apiKey, promptCharacters }, abort.signal);
      setProbe({ name: "done", verdict: answer.verdict, message: answer.message });
    } catch (caught) {
      if (abort.signal.aborted) return;
      setProbe({ name: "failed", message: caught instanceof Error ? caught.message : "The model could not be tested." });
    } finally {
      if (probeController.current === abort) probeController.current = undefined;
    }
  }

  async function run() {
    const selection = resolveProviderModel(assignment.provider, assignment.model);
    if (!selection) {
      setPhase({ name: "failed", message: "The model name is not valid for this provider." });
      return;
    }
    if (!provider.local && !apiKey.trim()) {
      setPhase({ name: "failed", message: `${provider.keyLabel} is required.` });
      return;
    }
    try {
      window.localStorage.setItem(MODEL_PREFERENCE_KEY, JSON.stringify(selection));
    } catch {
      // Tercih hatırlanamasa da istek çalışır.
    }

    const abort = new AbortController();
    controller.current = abort;
    setApplyIssues([]);
    setPhase({
      name: "running",
      progress: { stage: "story", progress: 4, title: "Sending the section request.", detail: "The key stays in memory for this request only." },
    });

    try {
      const response = await fetch("/api/regenerate", {
        method: "POST",
        signal: abort.signal,
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
        body: JSON.stringify({ project, target, claimPolicy, goal, instruction, assignment: selection, apiKey }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        throw new Error(data?.error ?? "The section could not be regenerated.");
      }
      let result: { section: RegeneratedSection; evidenceFingerprint: string } | undefined;
      await readGenerationStream(response.body, (event) => {
        if (event.type === "progress") setPhase({ name: "running", progress: event });
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "section") {
          result = { section: event.section as RegeneratedSection, evidenceFingerprint: event.evidenceFingerprint };
        }
      });
      if (!result) throw new Error("The request finished but no section came back.");
      setPhase({ name: "review", ...result });
    } catch (caught) {
      const aborted = abort.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError");
      setPhase(aborted
        ? { name: "form" }
        : { name: "failed", message: caught instanceof Error ? caught.message : "Something unexpected went wrong." });
    } finally {
      if (controller.current === abort) controller.current = undefined;
    }
  }

  function apply() {
    if (phase.name !== "review" || !current) return;
    try {
      // İstemci de aynı kilidi uyguluyor: istek sürerken proje değiştiyse
      // (başka bir sekmede içe aktarma, elle düzenleme) bölüm yine denetlenir.
      const next = spliceSection(project, target, phase.section, {
        claimPolicy,
        expectedFingerprint: phase.evidenceFingerprint,
        goal,
      });
      onApply(next, current);
    } catch (error) {
      setApplyIssues(error instanceof IntegrityError ? error.issues : describeValidationError(error));
    }
  }

  if (!current) return null;
  const { label, noun } = sectionKindInfo(target.kind);
  const title = strengthen ? `Strengthen the evidence of a ${label}` : `Regenerate ${label}`;
  const health = strengthen ? isThinSection(current.claimIds, project.evidence.claims) : undefined;

  return (
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="regen-title">
      <div className={`regen-panel ${phase.name === "review" ? "wide" : ""}`}>
        <header className="regen-header">
          <div>
            <span>{strengthen ? <><ShieldPlus size={13} /> Evidence health</> : <><Sparkles size={13} /> Evidence locked</>}</span>
            <h2 id="regen-title">{title}</h2>
            <p lang={project.language}>{sectionTitle(target.kind, current)}</p>
          </div>
          <button className="regen-close" onClick={() => { controller.current?.abort(); onClose(); }} aria-label="Close"><X size={16} /></button>
        </header>

        {(phase.name === "form" || phase.name === "failed") && (
          <div className="regen-body">
            {health && (
              <p className="regen-note regen-strengthen">
                This section rests on <b>{health.claimCount} claim{health.claimCount === 1 ? "" : "s"}</b>, {health.verifiedCount} verified.
                The new version must cite at least {MIN_SECTION_CLAIMS} existing claims, one of them verified, or it is rejected.
                Where the evidence does not back a sentence, the model narrows the sentence instead.
              </p>
            )}
            <fieldset className="regen-policy">
              <legend>Claims this {noun} rests on</legend>
              <label className={claimPolicy === "locked" ? "active" : ""}>
                <input type="radio" name="claim-policy" checked={claimPolicy === "locked"} disabled={strengthen} onChange={() => setClaimPolicy("locked")} />
                <Lock size={14} />
                <span><b>Keep the same claims</b><small>{current.claimIds.length
                  ? `The wording changes; ${current.claimIds.length === 1 ? "the cited claim stays exactly as it is" : `the ${current.claimIds.length} cited claims stay exactly as they are`}.`
                  : `The wording changes; the ${noun} keeps citing no claims.`}</small></span>
              </label>
              <label className={claimPolicy === "open" ? "active" : ""}>
                <input type="radio" name="claim-policy" checked={claimPolicy === "open"} onChange={() => setClaimPolicy("open")} />
                <Unlock size={14} />
                <span><b>Choose from all evidence</b><small>The model may cite other existing claims. It still cannot add a fact.</small></span>
              </label>
            </fieldset>

            <label className="regen-field">
              What should change? <small>Optional</small>
              <textarea
                value={instruction}
                maxLength={MAX_REGENERATION_INSTRUCTION}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder={PLACEHOLDERS[target.kind]}
              />
              <small className="regen-count">{instruction.length}/{MAX_REGENERATION_INSTRUCTION}</small>
            </label>

            <div className="regen-model">
              <div className="model-select provider-select">
                <select aria-label="Provider" value={assignment.provider} onChange={(event) => chooseProvider(event.target.value as ProviderId)}>
                  {providerCatalog.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
              <div className="model-select">
                {provider.freeformModel ? (
                  <>
                    <input
                      aria-label="Model"
                      list={`regen-models-${provider.id}`}
                      value={assignment.model}
                      onChange={(event) => chooseModel(event.target.value)}
                      spellCheck={false}
                    />
                    <datalist id={`regen-models-${provider.id}`}>
                      {provider.models.map((model) => <option key={model.id} value={model.id}>{model.note}</option>)}
                    </datalist>
                  </>
                ) : (
                  <select aria-label="Model" value={assignment.model} onChange={(event) => chooseModel(event.target.value)}>
                    {provider.models.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.note}</option>)}
                  </select>
                )}
              </div>
              <div className="key-input">
                {provider.local ? <Server size={14} /> : <KeyRound size={14} />}
                <input
                  type={provider.local ? "text" : "password"}
                  aria-label={provider.keyLabel}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setProbe({ name: "idle" });
                  }}
                  placeholder={provider.local ? DEFAULT_LOCAL_ENDPOINT : provider.keyLabel}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            <p className="regen-note">
              Only this {noun} is sent to the model, with the locked evidence as its sole source. The PDF is not needed, so a local model works too. The key is used for this request and never stored.
            </p>

            {probe.name === "running" && <p className="regen-probe" role="status">Testing the model with a short request…</p>}
            {probe.name === "done" && <p className={`regen-probe probe-${probe.verdict}`} role="status">{probe.message}</p>}
            {probe.name === "failed" && <p className="regen-probe probe-too-slow" role="alert">{probe.message}</p>}
            {phase.name === "failed" && <p className="regen-error" role="alert">{phase.message}</p>}

            <footer className="regen-actions">
              <button className="regen-secondary regen-test" disabled={probe.name === "running"} onClick={() => { void testModel(); }}>
                <Gauge size={14} /> {probe.name === "running" ? "Testing…" : "Test model"}
              </button>
              <button className="regen-secondary" onClick={onClose}>Cancel</button>
              <button className="regen-primary" onClick={() => { void run(); }}><RefreshCw size={14} /> Regenerate</button>
            </footer>
          </div>
        )}

        {phase.name === "running" && (
          <div className="regen-body" role="status" aria-live="polite">
            <h3 className="regen-running-title">{phase.progress.title}</h3>
            <p className="regen-note">{phase.progress.detail}</p>
            <div className="generation-meter"><i style={{ width: `${Math.max(2, Math.min(100, phase.progress.progress))}%` }} /></div>
            <footer className="regen-actions">
              <span className="regen-count">{Math.round(phase.progress.progress)}%{phase.progress.attempt ? ` · attempt ${phase.progress.attempt}` : ""}</span>
              <button className="regen-secondary" onClick={() => controller.current?.abort()}>Stop</button>
            </footer>
          </div>
        )}

        {phase.name === "review" && (
          <div className="regen-body">
            <div className="regen-compare">
              <SectionPreview label="Current" project={project} kind={target.kind} section={current} />
              <SectionPreview label="Proposed" project={project} kind={target.kind} section={phase.section} baseline={current} />
            </div>
            {applyIssues.length > 0 && (
              <div className="regen-error" role="alert">
                <b>This version can no longer be applied.</b>
                <ul>{applyIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
              </div>
            )}
            <footer className="regen-actions">
              <button className="regen-secondary" onClick={onClose}>Discard</button>
              <button className="regen-secondary" onClick={() => { void run(); }}><RefreshCw size={14} /> Try again</button>
              <button className="regen-primary" onClick={apply}>Use this version</button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionPreview({
  label,
  project,
  kind,
  section,
  baseline,
}: {
  label: string;
  project: ResearchProject;
  kind: SectionTarget["kind"];
  section: RegeneratedSection;
  baseline?: RegeneratedSection;
}) {
  const before = new Set(baseline?.claimIds ?? section.claimIds);
  const removed = baseline ? baseline.claimIds.filter((id) => !section.claimIds.includes(id)) : [];
  const claims = new Map(project.evidence.claims.map((claim) => [claim.id, claim]));

  return (
    <article className="regen-preview">
      <span className="regen-preview-label">{label}</span>
      <div lang={project.language}>
        <SectionBody project={project} kind={kind} section={section} />
      </div>
      <ul className="regen-claims">
        {section.claimIds.map((id) => (
          <li key={id} className={before.has(id) ? "" : "added"} title={claims.get(id)?.statement}>
            {before.has(id) ? "" : "+ "}{id}
          </li>
        ))}
        {removed.map((id) => <li key={id} className="removed" title={claims.get(id)?.statement}>− {id}</li>)}
      </ul>
    </article>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const PLACEHOLDERS: Record<SectionTarget["kind"], string> = {
  story: "Shorter, with a concrete example from the method. Use a timeline instead of a matrix.",
  report: "Separate what the authors report from what follows. Name the cost of the design.",
  primer: "Explain it with an everyday analogy before the formal definition.",
  quiz: "Make the wrong options plausible misreadings of the result, not obvious mistakes.",
  derivation: "Smaller steps, and say which assumption each step uses.",
  equation: "Explain every symbol, and say what would change without this term.",
};

/** Karşılaştırmada gösterilen içerik; okuyucunun göreceği biçime yakın ama sade. */
function SectionBody({ project, kind, section }: { project: ResearchProject; kind: SectionTarget["kind"]; section: RegeneratedSection }) {
  if (kind === "story") {
    const story = section as StorySection;
    return (
      <>
        <small>{story.kicker}</small>
        <h3>{story.title}</h3>
        <p>{story.body}</p>
        <div className="regen-visual"><VisualRenderer visual={story.visual} accent={project.story.accent} /></div>
      </>
    );
  }
  if (kind === "report") {
    const report = section as DeepReportSection;
    return (
      <>
        <h3>{report.title}</h3>
        <p><b>{report.summary}</b></p>
        {report.analysis.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </>
    );
  }
  if (kind === "primer") {
    const concept = section as PrimerConcept;
    return (
      <>
        <small>{concept.level}</small>
        <h3>{concept.term}</h3>
        <p>{concept.intuition}</p>
        {concept.formal ? <MathText latex={concept.formal} display /> : null}
        <p><b>Why it matters.</b> {concept.whyItMatters}</p>
      </>
    );
  }
  if (kind === "quiz") {
    const question = section as QuizQuestion;
    return (
      <>
        <small>{question.kind}</small>
        <h3>{question.prompt}</h3>
        <ul className="regen-options">
          {question.options.map((option, index) => (
            <li key={index} className={option.correct ? "correct" : ""}>
              <b>{option.correct ? "✓" : "·"} {option.label}</b>
              <span>{option.explanation}</span>
            </li>
          ))}
        </ul>
      </>
    );
  }
  if (kind === "derivation") {
    const derivation = section as Derivation;
    return (
      <>
        <h3>{derivation.title}</h3>
        <p><b>{derivation.goal}</b></p>
        <ol className="regen-steps">
          {derivation.steps.map((step) => (
            <li key={step.id}>
              <MathText latex={step.latex} plain={step.plain} display />
              <span>{step.rationale}</span>
            </li>
          ))}
        </ol>
        {derivation.numericExample ? <p><b>Example.</b> {derivation.numericExample.result}</p> : null}
      </>
    );
  }
  const equation = section as TechnicalAppendix["equations"][number];
  return (
    <>
      <small>{equation.id}</small>
      <h3>{equation.label}</h3>
      <MathText latex={equation.latex} plain={equation.expression} display />
      <p>{equation.explanation}</p>
      <ul className="regen-options">
        {equation.variables.map((variable) => (
          <li key={variable.symbol}><b>{variable.symbol}</b> <span>{variable.meaning}</span></li>
        ))}
      </ul>
    </>
  );
}

/**
 * Yeniden üretimi bir görünüme bağlayan kanca: paneli açar, sonucu uygular
 * ve son değişikliği geri alınabilir tutar.
 *
 * Geri alma da aynı takma yolundan geçiyor. Eski bölüm tanım gereği geçerli,
 * ama arada kullanıcı başka bir şeyi değiştirdiyse doğrudan üzerine yazmak
 * o değişikliği sessizce ezerdi; takma yolu yalnızca o bölüme dokunur.
 */
export function useSectionRegeneration(
  project: ResearchProject,
  onProjectChange?: (project: ResearchProject, reason?: RevisionReason) => void,
) {
  const [request, setRequest] = useState<{ target: SectionTarget; goal: RegenerationGoal; claimPolicy?: ClaimPolicy }>();
  const target = request?.target;
  const [undo, setUndo] = useState<{ target: SectionTarget; section: RegeneratedSection }>();
  const [undoError, setUndoError] = useState<string>();

  const open = useCallback((next: SectionTarget, options: { goal?: RegenerationGoal; claimPolicy?: ClaimPolicy } = {}) => {
    setUndoError(undefined);
    setRequest({ target: next, goal: options.goal ?? "revise", claimPolicy: options.claimPolicy });
  }, []);

  const panel = target && onProjectChange ? (
    <SectionRegenerator
      project={project}
      target={target}
      goal={request?.goal}
      claimPolicy={request?.claimPolicy}
      onClose={() => setRequest(undefined)}
      onApply={(next, previous) => {
        onProjectChange(next, "regenerate");
        setUndo({ target, section: previous });
        setRequest(undefined);
      }}
    />
  ) : null;

  const undoBar = undo && onProjectChange ? (
    <div className="regen-undo" role="status">
      <span>{undoError ?? `${capitalize(sectionKindInfo(undo.target.kind).label)} regenerated against the locked evidence.`}</span>
      <button
        onClick={() => {
          try {
            onProjectChange(spliceSection(project, undo.target, undo.section, { claimPolicy: "open" }), "restore");
            setUndo(undefined);
          } catch (error) {
            setUndoError(describeValidationError(error)[0] ?? "The previous version could not be restored.");
          }
        }}
      >
        <Undo2 size={13} /> Undo
      </button>
      <button aria-label="Dismiss" onClick={() => setUndo(undefined)}><X size={13} /></button>
    </div>
  ) : null;

  return { open, panel, undoBar, enabled: Boolean(onProjectChange) };
}
