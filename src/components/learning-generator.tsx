"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GraduationCap, KeyRound, Server, Sparkles, X } from "lucide-react";
import { describeValidationError, validateLearningIntegrity } from "@/lib/generation-validation";
import { readGenerationStream, type GenerationProgress } from "@/lib/generation-events";
import {
  missingLearningBlocks,
  type LearningBlockId,
  type LearningBlocks,
} from "@/lib/learning-generation";
import { DEFAULT_LOCAL_ENDPOINT } from "@/lib/local-endpoint";
import {
  defaultModelByProvider,
  getProvider,
  localizedProvider,
  providerCatalog,
  resolveProviderModel,
  type ModelAssignment,
  type ProviderId,
} from "@/lib/model-providers";
import { researchProjectSchema, type ResearchProject } from "@/lib/schema";
import { evidenceFingerprint } from "@/lib/section-regeneration";
import { useT } from "@/i18n/client";

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
  const messages = useT();
  // Sağlayıcının adı, anahtarın adı ve model notları arayüzün dilinde.
  const providerWords = messages.studio.models.providers;
  const provider = localizedProvider(getProvider(assignment.provider)!, providerWords);
  const t = messages.paper.learningGenerator;
  const request = messages.paper.modelRequest;
  const blockList = messages.paper.learningBlockList;
  // Her bloğun okuyucuya ne verdiği; diyalog ne yazılacağını buradan anlatıyor.
  const blockPlan = t.blocks;

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
    if (!selection) return setPhase({ name: "failed", message: request.invalidModel });
    if (!provider.local && !apiKey.trim()) return setPhase({ name: "failed", message: request.keyRequired(provider.keyLabel) });

    const abort = new AbortController();
    controller.current = abort;
    setPhase({ name: "running", progress: { stage: "story", progress: 3, title: t.sending, detail: request.keyInMemory } });
    try {
      const response = await fetch("/api/learning", {
        method: "POST",
        signal: abort.signal,
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
        body: JSON.stringify({ project, blocks, assignment: selection, apiKey }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        throw new Error(data?.error ?? t.requestFailed);
      }
      let result: { blocks: LearningBlocks; failed: Array<{ block: LearningBlockId; reason: string }>; evidenceFingerprint: string } | undefined;
      await readGenerationStream(response.body, (event) => {
        if (event.type === "progress") setPhase({ name: "running", progress: event });
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "learning") result = event as typeof result;
      });
      if (!result) throw new Error(t.nothingCameBack);

      // İstek sürerken kanıt değiştiyse (başka sekmede içe aktarma) yazılanlar ona dayanmıyor.
      if (result.evidenceFingerprint !== evidenceFingerprint(project.evidence)) {
        throw new Error(t.evidenceChanged);
      }
      const written = result.blocks;
      const added = blocks.filter((block) => written[block] !== undefined);
      let next: ResearchProject;
      try {
        next = researchProjectSchema.parse({ ...project, ...Object.fromEntries(added.map((block) => [block, written[block]])) });
        validateLearningIntegrity(next);
      } catch (error) {
        throw new Error(t.checkFailed(describeValidationError(error).join("; ")));
      }
      onApply(next);
      setPhase({ name: "done", added, gap: messages.server.learningLayer.gaps(result.failed) });
    } catch (caught) {
      const aborted = abort.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError");
      setPhase(aborted ? { name: "form" } : { name: "failed", message: caught instanceof Error ? caught.message : request.unexpected });
    } finally {
      if (controller.current === abort) controller.current = undefined;
    }
  }

  return (
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="learning-title">
      <div className="regen-panel">
        <header className="regen-header">
          <div>
            <span><GraduationCap size={13} /> {t.kicker}</span>
            <h2 id="learning-title">{t.title}</h2>
            <p lang={project.language}>{project.evidence.paper.title}</p>
          </div>
          <button className="regen-close" onClick={() => { controller.current?.abort(); onClose(); }} aria-label={messages.common.close}><X size={16} /></button>
        </header>

        {(phase.name === "form" || phase.name === "failed") && (
          <div className="regen-body">
            <p className="regen-note">{t.intro(blockList(blocks))}</p>
            <ul className="learning-plan">
              {blocks.map((block) => (
                <li key={block}><b>{blockPlan[block].label}</b><span>{blockPlan[block].purpose}</span></li>
              ))}
            </ul>
            <div className="regen-model">
              <div className="model-select provider-select">
                <select aria-label={request.provider} value={assignment.provider} onChange={(event) => {
                  const id = event.target.value as ProviderId;
                  setAssignment({ provider: id, model: defaultModelByProvider[id] });
                  setApiKey("");
                }}>
                  {providerCatalog.map((item) => <option key={item.id} value={item.id}>{localizedProvider(item, providerWords).label}</option>)}
                </select>
              </div>
              <div className="model-select">
                {provider.freeformModel ? (
                  <>
                    <input aria-label={request.model} list={`learning-models-${provider.id}`} value={assignment.model} onChange={(event) => setAssignment({ provider: provider.id, model: event.target.value })} spellCheck={false} />
                    <datalist id={`learning-models-${provider.id}`}>
                      {provider.models.map((model) => <option key={model.id} value={model.id}>{model.note}</option>)}
                    </datalist>
                  </>
                ) : (
                  <select aria-label={request.model} value={assignment.model} onChange={(event) => setAssignment({ provider: provider.id, model: event.target.value })}>
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
            <p className="regen-note">{t.sentNote}</p>
            {phase.name === "failed" && <p className="regen-error" role="alert">{phase.message}</p>}
            <footer className="regen-actions">
              <button className="regen-secondary" onClick={onClose}>{messages.common.cancel}</button>
              <button className="regen-primary" onClick={() => { void run(); }}><Sparkles size={14} /> {t.write}</button>
            </footer>
          </div>
        )}

        {phase.name === "running" && (
          <div className="regen-body" role="status" aria-live="polite">
            <h3 className="regen-running-title">{phase.progress.title}</h3>
            <p className="regen-note">{phase.progress.detail}</p>
            <div className="generation-meter"><i style={{ width: `${Math.max(2, Math.min(100, phase.progress.progress))}%` }} /></div>
            <footer className="regen-actions">
              <span className="regen-count">{Math.round(phase.progress.progress)}%{phase.progress.attempt ? ` · ${request.attempt(phase.progress.attempt)}` : ""}</span>
              <button className="regen-secondary" onClick={() => controller.current?.abort()}>{request.stop}</button>
            </footer>
          </div>
        )}

        {phase.name === "done" && (
          <div className="regen-body" role="status">
            <h3 className="regen-running-title">{t.added(blockList(phase.added))}</h3>
            <p className="regen-note">{t.undoable}</p>
            {phase.gap && <p className="regen-error">{phase.gap}</p>}
            <footer className="regen-actions">
              <button className="regen-secondary" onClick={onClose}>{messages.common.close}</button>
              <button className="regen-primary" onClick={() => { onOpen(phase.added[0]); onClose(); }}>
                {phase.added[0] === "primer" ? t.startWithPrimer : t.openIt}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
