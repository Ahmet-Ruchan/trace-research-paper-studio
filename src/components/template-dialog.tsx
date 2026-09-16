"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutTemplate, X } from "lucide-react";
import { templateFromProject, templateIssues } from "@/lib/narrative-templates";
import type { NarrativeTemplate, ResearchProject } from "@/lib/schema";
import { saveTemplate } from "@/lib/template-library";

type TemplateDialogProps = {
  project: ResearchProject;
  onClose: () => void;
};

/**
 * Bu anlatının yapısını şablon olarak kaydeder. Amaçlar iddia türlerinden
 * önerilir ama düzenlenebilir: şablon başka makalelere uygulanacak, bu
 * yüzden içeriğe değil işleve dair olmalı.
 */
export function TemplateDialog({ project, onClose }: TemplateDialogProps) {
  const initial = useMemo(() => templateFromProject(project, { name: "Untitled template" }), [project]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [purposes, setPurposes] = useState(() => initial.story.map((slot) => slot.purpose));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<NarrativeTemplate>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const draft = useMemo<NarrativeTemplate>(() => {
    const base = templateFromProject(project, { name: name.trim() || "Untitled template", description: description.trim() });
    return { ...base, story: base.story.map((slot, index) => ({ ...slot, purpose: purposes[index]?.trim() || slot.purpose })) };
  }, [project, name, description, purposes]);
  const issues = templateIssues(draft);

  async function save() {
    if (!name.trim()) {
      setError("Give the template a name.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      setSaved(await saveTemplate(draft));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The template could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="template-title">
      <div className="regen-panel">
        <header className="regen-header">
          <div>
            <span><LayoutTemplate size={13} /> Narrative template</span>
            <h2 id="template-title">Save this story&apos;s structure</h2>
            <p>The template keeps the order of sections, their visuals and the kinds of claims they lean on, never the text. Pick it when you analyse the next paper.</p>
          </div>
          <button className="regen-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="regen-body">
          {saved ? (
            <>
              <p className="regen-note"><b>{saved.name}</b> is saved. It appears under Narrative template when you analyse a paper, and agents can use it with <code>prepare --template {saved.id}</code>.</p>
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
              <ol className="template-slots">
                {draft.story.map((slot, index) => (
                  <li key={index}>
                    <i>{String(index + 1).padStart(2, "0")}</i>
                    <input
                      value={purposes[index] ?? ""}
                      maxLength={160}
                      onChange={(event) => setPurposes((current) => current.map((item, position) => (position === index ? event.target.value : item)))}
                      aria-label={`Purpose of section ${index + 1}`}
                    />
                    <small>{slot.visual} · {slot.claimKinds.join(", ") || "any claims"}</small>
                  </li>
                ))}
              </ol>
              {draft.report && <p className="regen-note">Report order: {draft.report.join(" → ")}</p>}
              {issues.length > 0 && (
                <div className="regen-error" role="alert">
                  <b>This structure cannot be reused as it is.</b>
                  <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                </div>
              )}
              {error && <p className="regen-error" role="alert">{error}</p>}
              <footer className="regen-actions">
                <button className="regen-secondary" onClick={onClose}>Cancel</button>
                <button className="regen-primary" disabled={saving || issues.length > 0} onClick={() => { void save(); }}>
                  {saving ? "Saving…" : "Save template"}
                </button>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
