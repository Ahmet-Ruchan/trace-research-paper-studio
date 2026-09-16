"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Lock, RefreshCw, Server, Sparkles, Undo2, Unlock, X } from "lucide-react";
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
import type { DeepReportSection, ResearchProject, StorySection } from "@/lib/schema";
import {
  MAX_REGENERATION_INSTRUCTION,
  findSection,
  spliceSection,
  type ClaimPolicy,
  type RegeneratedSection,
  type SectionTarget,
} from "@/lib/section-regeneration";
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
  const role = target.kind === "story" ? "visual" : "report";
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

type RegeneratorProps = {
  project: ResearchProject;
  target: SectionTarget;
  onApply: (next: ResearchProject, previous: RegeneratedSection) => void;
  onClose: () => void;
};

export function SectionRegenerator({ project, target, onApply, onClose }: RegeneratorProps) {
  const current = useMemo(() => findSection(project, target), [project, target]);
  const [assignment, setAssignment] = useState<ModelAssignment>(() => initialAssignment(project, target));
  const [apiKey, setApiKey] = useState("");
  const [instruction, setInstruction] = useState("");
  const [claimPolicy, setClaimPolicy] = useState<ClaimPolicy>("locked");
  const [phase, setPhase] = useState<Phase>({ name: "form" });
  const [applyIssues, setApplyIssues] = useState<string[]>([]);
  const controller = useRef<AbortController | undefined>(undefined);
  const provider = getProvider(assignment.provider)!;

  useEffect(() => () => controller.current?.abort(), []);
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
        body: JSON.stringify({ project, target, claimPolicy, instruction, assignment: selection, apiKey }),
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
      });
      onApply(next, current);
    } catch (error) {
      setApplyIssues(error instanceof IntegrityError ? error.issues : describeValidationError(error));
    }
  }

  if (!current) return null;
  const title = target.kind === "story" ? "Regenerate story section" : "Regenerate report section";

  return (
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="regen-title">
      <div className={`regen-panel ${phase.name === "review" ? "wide" : ""}`}>
        <header className="regen-header">
          <div>
            <span><Sparkles size={13} /> Evidence locked</span>
            <h2 id="regen-title">{title}</h2>
            <p lang={project.language}>{current.title}</p>
          </div>
          <button className="regen-close" onClick={() => { controller.current?.abort(); onClose(); }} aria-label="Close"><X size={16} /></button>
        </header>

        {(phase.name === "form" || phase.name === "failed") && (
          <div className="regen-body">
            <fieldset className="regen-policy">
              <legend>Claims this section rests on</legend>
              <label className={claimPolicy === "locked" ? "active" : ""}>
                <input type="radio" name="claim-policy" checked={claimPolicy === "locked"} onChange={() => setClaimPolicy("locked")} />
                <Lock size={14} />
                <span><b>Keep the same claims</b><small>The wording changes; the {current.claimIds.length} cited claims stay exactly as they are.</small></span>
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
                placeholder="Shorter, with a concrete example from the method. Use a timeline instead of a matrix."
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
                      onChange={(event) => setAssignment({ provider: provider.id, model: event.target.value })}
                      spellCheck={false}
                    />
                    <datalist id={`regen-models-${provider.id}`}>
                      {provider.models.map((model) => <option key={model.id} value={model.id}>{model.note}</option>)}
                    </datalist>
                  </>
                ) : (
                  <select aria-label="Model" value={assignment.model} onChange={(event) => setAssignment({ provider: provider.id, model: event.target.value })}>
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
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={provider.local ? DEFAULT_LOCAL_ENDPOINT : provider.keyLabel}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            <p className="regen-note">
              Only this section is sent to the model, with the locked evidence as its sole source. The PDF is not needed, so a local model works too. The key is used for this request and never stored.
            </p>

            {phase.name === "failed" && <p className="regen-error" role="alert">{phase.message}</p>}

            <footer className="regen-actions">
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
              <SectionPreview label="Current" project={project} section={current} />
              <SectionPreview label="Proposed" project={project} section={phase.section} baseline={current} />
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
  section,
  baseline,
}: {
  label: string;
  project: ResearchProject;
  section: RegeneratedSection;
  baseline?: RegeneratedSection;
}) {
  const before = new Set(baseline?.claimIds ?? section.claimIds);
  const removed = baseline ? baseline.claimIds.filter((id) => !section.claimIds.includes(id)) : [];
  const claims = new Map(project.evidence.claims.map((claim) => [claim.id, claim]));
  const isStory = "visual" in section;

  return (
    <article className="regen-preview">
      <span className="regen-preview-label">{label}</span>
      <div lang={project.language}>
        {isStory ? (
          <>
            <small>{(section as StorySection).kicker}</small>
            <h3>{section.title}</h3>
            <p>{(section as StorySection).body}</p>
            <div className="regen-visual"><VisualRenderer visual={(section as StorySection).visual} accent={project.story.accent} /></div>
          </>
        ) : (
          <>
            <h3>{section.title}</h3>
            <p><b>{(section as DeepReportSection).summary}</b></p>
            {(section as DeepReportSection).analysis.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </>
        )}
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
  const [target, setTarget] = useState<SectionTarget>();
  const [undo, setUndo] = useState<{ target: SectionTarget; section: RegeneratedSection }>();
  const [undoError, setUndoError] = useState<string>();

  const open = useCallback((next: SectionTarget) => {
    setUndoError(undefined);
    setTarget(next);
  }, []);

  const panel = target && onProjectChange ? (
    <SectionRegenerator
      project={project}
      target={target}
      onClose={() => setTarget(undefined)}
      onApply={(next, previous) => {
        onProjectChange(next, "regenerate");
        setUndo({ target, section: previous });
        setTarget(undefined);
      }}
    />
  ) : null;

  const undoBar = undo && onProjectChange ? (
    <div className="regen-undo" role="status">
      <span>{undoError ?? "Section regenerated against the locked evidence."}</span>
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
