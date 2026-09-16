"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, LayoutTemplate, Plus, Trash2, X } from "lucide-react";
import {
  claimKinds,
  narrativeTemplateSchema,
  reportKinds,
  slugifyTemplateName,
  templateIssues,
  visualTypes,
  type NarrativeTemplate,
  type TemplateSlot,
} from "@/lib/narrative-templates";
import { saveTemplate } from "@/lib/template-library";

const claimKindLabels: Record<(typeof claimKinds)[number], string> = {
  "reported-result": "results",
  "author-interpretation": "interpretation",
  method: "method",
  background: "background",
  limitation: "limitation",
};

/** Şema sınırları; düğmeler bunların dışına çıkmaya izin vermiyor. */
const MIN_SLOTS = 5;
const MAX_SLOTS = 8;
const MAX_CLAIM_KINDS = 3;

type TemplateEditorProps = {
  /** Düzenlenecek şablon. `mode: "create"` ise kimlik kayıtta addan üretiliyor. */
  initial: NarrativeTemplate;
  mode: "create" | "edit";
  heading: string;
  intro: string;
  /** Yeni şablonda ad boş başlıyor; düzenlemede mevcut ad. */
  initialName?: string;
  onSaved?: (template: NarrativeTemplate) => void;
  onClose: () => void;
};

function move<T>(items: readonly T[], from: number, to: number) {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Şablonun bütün yapısını düzenler: ad, açıklama, bölüm sırası, her bölümün
 * amacı, görseli ve dayandığı iddia türleri, raporun bölüm sırası.
 *
 * Kurallar kayıttan ÖNCE canlı olarak gösteriliyor ve ihlal varken kayıt
 * kapalı: bozuk bir şablonla üretilen her anlatı reddedilir ve kullanıcı bunu
 * model ücretini ödedikten sonra öğrenirdi.
 *
 * Bir şablonla daha önce analiz edilmiş projeler şablonun kendi kopyasını
 * taşıyor; düzenleme onları değiştirmiyor.
 */
export function TemplateEditor({ initial, mode, heading, intro, initialName, onSaved, onClose }: TemplateEditorProps) {
  const [name, setName] = useState(initialName ?? initial.name);
  const [description, setDescription] = useState(initial.description);
  const [slots, setSlots] = useState<TemplateSlot[]>(() => structuredClone(initial.story));
  const [report, setReport] = useState(() => initial.report ? [...initial.report] : undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<NarrativeTemplate>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const draft = useMemo<NarrativeTemplate>(() => ({
    ...initial,
    builtIn: false,
    name: name.trim() || "Untitled template",
    description: description.trim(),
    story: slots.map((slot) => ({ ...slot, purpose: slot.purpose.trim() })),
    report,
  }), [initial, name, description, slots, report]);

  const issues = useMemo(() => {
    const parsed = narrativeTemplateSchema.safeParse(draft);
    const shape = parsed.success ? [] : parsed.error.issues.map((issue) => {
      const [area, index] = issue.path;
      return area === "story" && typeof index === "number"
        ? `Section ${index + 1}: ${issue.path[2] === "purpose" ? "give it a purpose" : issue.message}`
        : `${issue.path.join(".") || "Template"}: ${issue.message}`;
    });
    return [...shape, ...templateIssues(draft)];
  }, [draft]);

  const updateSlot = (index: number, patch: Partial<TemplateSlot>) =>
    setSlots((current) => current.map((slot, position) => (position === index ? { ...slot, ...patch } : slot)));

  function toggleKind(index: number, kind: (typeof claimKinds)[number]) {
    const slot = slots[index];
    const has = slot.claimKinds.includes(kind);
    if (!has && slot.claimKinds.length >= MAX_CLAIM_KINDS) return;
    updateSlot(index, { claimKinds: has ? slot.claimKinds.filter((item) => item !== kind) : [...slot.claimKinds, kind] });
  }

  async function save() {
    if (!name.trim()) {
      setError("Give the template a name.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      // Yeni şablonun kimliği kayıt anında addan üretiliyor; düzenlemede aynı
      // kimlik korunuyor, böylece kayıt dosyanın üzerine yazıyor.
      const now = new Date().toISOString();
      const template = await saveTemplate(mode === "create"
        ? { ...draft, id: `${slugifyTemplateName(draft.name)}-${now.replace(/\D/g, "").slice(0, 14)}`, createdAt: now }
        : { ...draft, updatedAt: now });
      setSaved(template);
      onSaved?.(template);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The template could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="template-title">
      <div className="regen-panel wide">
        <header className="regen-header">
          <div>
            <span><LayoutTemplate size={13} /> Narrative template</span>
            <h2 id="template-title">{heading}</h2>
            <p>{intro}</p>
          </div>
          <button className="regen-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="regen-body">
          {saved ? (
            <>
              <p className="regen-note"><b>{saved.name}</b> is saved. It appears under Narrative template when you analyse a paper, and agents can use it with <code>prepare --template {saved.id}</code>.{mode === "edit" ? " Projects already analysed with it keep their own copy." : ""}</p>
              <footer className="regen-actions">
                <button className="regen-primary" onClick={onClose}>Done</button>
              </footer>
            </>
          ) : (
            <>
              <div className="template-form">
                <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Template name, e.g. Weekly reading group" aria-label="Template name" />
                <textarea value={description} maxLength={400} onChange={(event) => setDescription(event.target.value)} placeholder="Who is it for? (optional)" aria-label="Template description" />
              </div>

              <span className="history-caption">Story sections, in order</span>
              <ol className="template-editor-slots">
                {slots.map((slot, index) => (
                  <li key={index}>
                    <i>{String(index + 1).padStart(2, "0")}</i>
                    <div className="template-slot-main">
                      <input
                        value={slot.purpose}
                        maxLength={160}
                        onChange={(event) => updateSlot(index, { purpose: event.target.value })}
                        aria-label={`Purpose of section ${index + 1}`}
                        placeholder="What this section does for the reader"
                      />
                      <div className="template-slot-options">
                        <select value={slot.visual} onChange={(event) => updateSlot(index, { visual: event.target.value as TemplateSlot["visual"] })} aria-label={`Visual of section ${index + 1}`}>
                          {visualTypes.map((visual) => <option key={visual} value={visual}>{visual}</option>)}
                        </select>
                        <div className="template-kinds" role="group" aria-label={`Claim kinds of section ${index + 1}`}>
                          {claimKinds.map((kind) => {
                            const active = slot.claimKinds.includes(kind);
                            return (
                              <button
                                key={kind}
                                type="button"
                                className={active ? "active" : ""}
                                aria-pressed={active}
                                disabled={!active && slot.claimKinds.length >= MAX_CLAIM_KINDS}
                                onClick={() => toggleKind(index, kind)}
                              >
                                {claimKindLabels[kind]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="template-slot-actions">
                      <button type="button" aria-label={`Move section ${index + 1} up`} disabled={index === 0} onClick={() => setSlots((current) => move(current, index, index - 1))}><ArrowUp size={13} /></button>
                      <button type="button" aria-label={`Move section ${index + 1} down`} disabled={index === slots.length - 1} onClick={() => setSlots((current) => move(current, index, index + 1))}><ArrowDown size={13} /></button>
                      <button type="button" aria-label={`Remove section ${index + 1}`} disabled={slots.length <= MIN_SLOTS} onClick={() => setSlots((current) => current.filter((_, position) => position !== index))}><Trash2 size={13} /></button>
                    </div>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="template-add-slot"
                disabled={slots.length >= MAX_SLOTS}
                onClick={() => setSlots((current) => [...current, { purpose: "", visual: "concept", claimKinds: [] }])}
              >
                <Plus size={13} /> Add a section {slots.length >= MAX_SLOTS ? `(at most ${MAX_SLOTS})` : ""}
              </button>

              <div className="template-report">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(report)}
                    onChange={(event) => setReport(event.target.checked ? [...(initial.report ?? reportKinds)] : undefined)}
                  />
                  Fix the order of the deep report sections
                </label>
                {report && (
                  <ol>
                    {report.map((kind, index) => (
                      <li key={`${kind}-${index}`}>
                        <span>{kind}</span>
                        <button type="button" aria-label={`Move ${kind} up`} disabled={index === 0} onClick={() => setReport((current) => current && move(current, index, index - 1))}><ArrowUp size={12} /></button>
                        <button type="button" aria-label={`Move ${kind} down`} disabled={index === report.length - 1} onClick={() => setReport((current) => current && move(current, index, index + 1))}><ArrowDown size={12} /></button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {issues.length > 0 && (
                <div className="regen-error" role="alert">
                  <b>This structure cannot be saved yet.</b>
                  <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                </div>
              )}
              {error && <p className="regen-error" role="alert">{error}</p>}
              <footer className="regen-actions">
                <button className="regen-secondary" onClick={onClose}>Cancel</button>
                <button className="regen-primary" disabled={saving || issues.length > 0} onClick={() => { void save(); }}>
                  {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Save template"}
                </button>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
