"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GraduationCap, KeyRound, Server, Sparkles, X } from "lucide-react";
import { describeValidationError, validateLearningIntegrity } from "@/lib/generation-validation";
import { readGenerationStream, type GenerationProgress } from "@/lib/generation-events";
import {
  describeLearningGaps,
  learningBlockList,
  missingLearningBlocks,
  type LearningBlockId,
  type LearningBlocks,
} from "@/lib/learning-generation";
import { DEFAULT_LOCAL_ENDPOINT } from "@/lib/local-endpoint";
import {
  defaultModelByProvider,
  getProvider,
  providerCatalog,
  resolveProviderModel,
  type ModelAssignment,
  type ProviderId,
} from "@/lib/model-providers";
import { researchProjectSchema, type ResearchProject } from "@/lib/schema";
import { evidenceFingerprint } from "@/lib/section-regeneration";

/** Her bloğun okuyucuya ne verdiği; diyalog ne yazılacağını buradan anlatıyor. */
const blockPlan: Record<LearningBlockId, { label: string; purpose: string }> = {
  primer: { label: "Primer", purpose: "What the paper assumes you already know, in the order to learn it." },
  quiz: { label: "Quiz", purpose: "Questions that check understanding; every answer shows its page and quote." },
  derivations: { label: "Derivations", purpose: "The key results worked out step by step, each step with its reason." },
  interactives: { label: "Interactive explorations", purpose: "Playgrounds and simulations that run the paper's formulas from its own settings." },
  applicationGuide: { label: "Application guide", purpose: "How to use the method, its settings, pitfalls, and when not to." },
};

type Phase =
  | { name: "form" }
  | { name: "running"; progress: GenerationProgress }
  | { name: "done"; added: LearningBlockId[]; gap?: string }
  | { name: "failed"; message: string };

type LearningGeneratorProps = {
  project: ResearchProject;
  /** Yazılan bloklar projeye takıldıktan sonra; çağıran bir revizyonla kaydeder. */
  onApply: (next: ResearchProject) => void;
  /** Bitince açılacak bölüm: ön bilgi varsa oradan başlanıyor. */
  onOpen: (block: LearningBlockId) => void;
  onClose: () => void;
};

function initialAssignment(project: ResearchProject): ModelAssignment {
  const assignments = project.generation?.assignments;
  const used = assignments?.teaching ?? assignments?.report;
  return (used ? resolveProviderModel(used.provider, used.model) : undefined) ?? { provider: "gemini", model: defaultModelByProvider.gemini };
}

/**
 * Öğrenme katmanı olmayan projeye katmanı ekler. Yalnızca eksik bloklar
 * yazılıyor; var olan bir blok olduğu gibi kalıyor. Anahtar hiçbir yerde
 * saklanmıyor.
 */
export function LearningGenerator({ project, onApply, onOpen, onClose }: LearningGeneratorProps) {
  const blocks = useMemo(() => missingLearningBlocks(project), [project]);
  const [assignment, setAssignment] = useState<ModelAssignment>(() => initialAssignment(project));
  const [apiKey, setApiKey] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "form" });
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

  async function run() {
    const selection = resolveProviderModel(assignment.provider, assignment.model);
    if (!selection) return setPhase({ name: "failed", message: "The model name is not valid for this provider." });
    if (!provider.local && !apiKey.trim()) return setPhase({ name: "failed", message: `${provider.keyLabel} is required.` });

    const abort = new AbortController();
    controller.current = abort;
    setPhase({ name: "running", progress: { stage: "story", progress: 3, title: "Sending the evidence.", detail: "The key stays in memory for this request only." } });
    try {
      const response = await fetch("/api/learning", {
        method: "POST",
        signal: abort.signal,
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
        body: JSON.stringify({ project, blocks, assignment: selection, apiKey }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        throw new Error(data?.error ?? "The learning layer could not be written.");
      }
      let result: { blocks: LearningBlocks; failed: Array<{ block: LearningBlockId; reason: string }>; evidenceFingerprint: string } | undefined;
      await readGenerationStream(response.body, (event) => {
        if (event.type === "progress") setPhase({ name: "running", progress: event });
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "learning") result = event as typeof result;
      });
      if (!result) throw new Error("The request finished but no learning material came back.");

      // İstek sürerken kanıt değiştiyse (başka sekmede içe aktarma) yazılanlar ona dayanmıyor.
      if (result.evidenceFingerprint !== evidenceFingerprint(project.evidence)) {
        throw new Error("The evidence changed while the learning material was being written. Nothing was added; try again.");
      }
      const written = result.blocks;
      const added = blocks.filter((block) => written[block] !== undefined);
      let next: ResearchProject;
      try {
        next = researchProjectSchema.parse({ ...project, ...Object.fromEntries(added.map((block) => [block, written[block]])) });
        validateLearningIntegrity(next);
      } catch (error) {
        throw new Error(`The learning material did not pass the check: ${describeValidationError(error).join("; ")}`);
      }
      onApply(next);
      setPhase({ name: "done", added, gap: describeLearningGaps(result.failed) });
    } catch (caught) {
      const aborted = abort.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError");
      setPhase(aborted ? { name: "form" } : { name: "failed", message: caught instanceof Error ? caught.message : "Something unexpected went wrong." });
    } finally {
      if (controller.current === abort) controller.current = undefined;
    }
  }

  return (
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="learning-title">
      <div className="regen-panel">
        <header className="regen-header">
          <div>
            <span><GraduationCap size={13} /> Learning layer</span>
            <h2 id="learning-title">Add the learning layer</h2>
            <p lang={project.language}>{project.evidence.paper.title}</p>
          </div>
          <button className="regen-close" onClick={() => { controller.current?.abort(); onClose(); }} aria-label="Close"><X size={16} /></button>
        </header>

        {(phase.name === "form" || phase.name === "failed") && (
          <div className="regen-body">
            <p className="regen-note">
              Trace writes {learningBlockList(blocks)} from the evidence already collected. Every item cites the claims it rests on and is checked
              like a full analysis. The PDF is not needed, so a local model works too.
            </p>
            <ul className="learning-plan">
              {blocks.map((block) => (
                <li key={block}><b>{blockPlan[block].label}</b><span>{blockPlan[block].purpose}</span></li>
              ))}
            </ul>
            <div className="regen-model">
              <div className="model-select provider-select">
                <select aria-label="Provider" value={assignment.provider} onChange={(event) => {
                  const id = event.target.value as ProviderId;
                  setAssignment({ provider: id, model: defaultModelByProvider[id] });
                  setApiKey("");
                }}>
                  {providerCatalog.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
              <div className="model-select">
                {provider.freeformModel ? (
                  <>
                    <input aria-label="Model" list={`learning-models-${provider.id}`} value={assignment.model} onChange={(event) => setAssignment({ provider: provider.id, model: event.target.value })} spellCheck={false} />
                    <datalist id={`learning-models-${provider.id}`}>
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
            <p className="regen-note">Only the claims, metrics and technical appendix of this project are sent. The key is used for this request and never stored.</p>
            {phase.name === "failed" && <p className="regen-error" role="alert">{phase.message}</p>}
            <footer className="regen-actions">
              <button className="regen-secondary" onClick={onClose}>Cancel</button>
              <button className="regen-primary" onClick={() => { void run(); }}><Sparkles size={14} /> Write the learning layer</button>
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

        {phase.name === "done" && (
          <div className="regen-body" role="status">
            <h3 className="regen-running-title">Added {learningBlockList(phase.added)}.</h3>
            <p className="regen-note">The previous version is in the project history, so this can be undone.</p>
            {phase.gap && <p className="regen-error">{phase.gap}</p>}
            <footer className="regen-actions">
              <button className="regen-secondary" onClick={onClose}>Close</button>
              <button className="regen-primary" onClick={() => { onOpen(phase.added[0]); onClose(); }}>
                {phase.added[0] === "primer" ? "Start with the primer" : "Open it"}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
