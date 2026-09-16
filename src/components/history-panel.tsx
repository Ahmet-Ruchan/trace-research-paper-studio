"use client";

import { useEffect, useMemo, useState } from "react";
import { Bookmark, History, RotateCcw, X } from "lucide-react";
import { listLibraryRevisions, loadLibraryRevision, markLibraryRevision, saveLibraryProject } from "@/lib/project-library";
import {
  MAX_REVISION_LABEL,
  REVISION_LIMIT,
  describeProjectChanges,
  type RevisionReason,
  type RevisionSummary,
  type TextChange,
} from "@/lib/project-revisions";
import type { ResearchProject } from "@/lib/schema";
import { diffWords, withContext } from "@/lib/text-diff";

const reasonLabels: Record<RevisionReason, string> = {
  edit: "Before edits",
  regenerate: "Before a regenerated section",
  restore: "Before a restore",
  import: "Before an import",
  manual: "Saved version",
  agent: "Before an agent update",
};

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

type HistoryPanelProps = {
  project: ResearchProject;
  onRestore: (project: ResearchProject) => Promise<void>;
  onClose: () => void;
};

type Selected = { summary: RevisionSummary; project: ResearchProject };

export function HistoryPanel({ project, onRestore, onClose }: HistoryPanelProps) {
  const [revisions, setRevisions] = useState<RevisionSummary[]>();
  const [selected, setSelected] = useState<Selected>();
  const [loadingId, setLoadingId] = useState<string>();
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    listLibraryRevisions(project.id)
      .then((items) => { if (active) setRevisions(items); })
      .catch((caught: unknown) => {
        if (!active) return;
        setRevisions([]);
        setError(caught instanceof Error ? caught.message : "The history could not be loaded.");
      });
    return () => { active = false; };
    // Proje her düzenlemede yeni bir nesne; liste yalnızca proje değişince yenilenir.
  }, [project.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changes = useMemo(
    () => (selected ? describeProjectChanges(selected.project, project) : []),
    [selected, project],
  );

  async function select(summary: RevisionSummary) {
    setError(undefined);
    setLoadingId(summary.id);
    try {
      const loaded = await loadLibraryRevision(project.id, summary.id);
      setSelected({ summary: loaded.revision, project: loaded.project });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That version could not be opened.");
    } finally {
      setLoadingId(undefined);
    }
  }

  async function saveVersion() {
    setSaving(true);
    setError(undefined);
    try {
      // Otomatik kayıt yarım saniye geride kalabiliyor; işaretlenen sürüm
      // ekranda görünenle aynı olsun diye önce yazılıyor.
      await saveLibraryProject(project);
      const revision = await markLibraryRevision(project.id, label.trim() || undefined);
      setRevisions((current) => [revision, ...(current ?? [])]);
      setLabel("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The version could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div className="regen-panel wide history-panel">
        <header className="regen-header">
          <div>
            <span><History size={13} /> Version history</span>
            <h2 id="history-title">Earlier versions of this project</h2>
            <p>Trace keeps the version a change replaced: every regenerated section, restore and import, and a snapshot every ten minutes while you edit. The latest {REVISION_LIMIT} are kept.</p>
          </div>
          <button className="regen-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="regen-body">
          <div className="history-save">
            <input
              value={label}
              maxLength={MAX_REVISION_LABEL}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Name this version (optional)"
              aria-label="Version name"
            />
            <button className="regen-primary" disabled={saving} onClick={() => { void saveVersion(); }}>
              <Bookmark size={14} /> {saving ? "Saving…" : "Save this version"}
            </button>
          </div>
          {error && <p className="regen-error" role="alert">{error}</p>}

          <div className="history-layout">
            <ol className="history-list">
              {revisions === undefined && <li className="history-empty">Loading…</li>}
              {revisions?.length === 0 && (
                <li className="history-empty">No earlier versions yet. They appear after the first regenerated section, restore, import or longer edit.</li>
              )}
              {revisions?.map((revision) => (
                <li key={revision.id}>
                  <button
                    className={selected?.summary.id === revision.id ? "active" : ""}
                    onClick={() => { void select(revision); }}
                    aria-busy={loadingId === revision.id}
                  >
                    <b>{revision.label ?? reasonLabels[revision.reason]}</b>
                    <small>{dateFormat.format(new Date(revision.savedAt))}{revision.label ? ` · ${reasonLabels[revision.reason]}` : ""}</small>
                    <small>{revision.claims} claims · {revision.storySections} story · {revision.reportSections} report sections</small>
                  </button>
                </li>
              ))}
            </ol>

            <section className="history-detail" aria-live="polite">
              {!selected ? (
                <p className="regen-note">Pick a version to see what has changed since.</p>
              ) : (
                <>
                  <h3>{selected.summary.label ?? reasonLabels[selected.summary.reason]}</h3>
                  <p className="regen-note">
                    Saved {dateFormat.format(new Date(selected.summary.savedAt))}. Restoring it replaces the current project; the current one is kept in this history first, so the restore can be undone.
                  </p>
                  {changes.length === 0 ? (
                    <p className="regen-note">Nothing has changed since this version.</p>
                  ) : (
                    <>
                      <span className="history-caption">Changed since this version</span>
                      <p className="history-legend">
                        <del>Struck through</del> is what this version says; <ins>highlighted</ins> is what the project says now. Restoring brings back the struck text.
                      </p>
                      <ul className="history-changes">
                        {changes.map((change, index) => (
                          <li key={`${change.summary}-${change.subject ?? ""}-${index}`} className={`change-${change.area}`}>
                            <span>{change.summary}</span>
                            {change.subject && <small lang={project.language}>{change.subject}</small>}
                            {change.texts && (
                              <details className="history-diff">
                                <summary>Show the text</summary>
                                {change.texts.map((text) => <TextDiff key={text.field} change={text} language={project.language} />)}
                              </details>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <footer className="regen-actions">
                    <button
                      className="regen-primary"
                      disabled={changes.length === 0 || restoring}
                      onClick={() => {
                        setRestoring(true);
                        setError(undefined);
                        onRestore(selected.project).catch((caught: unknown) => {
                          setError(caught instanceof Error ? caught.message : "The version could not be restored.");
                          setRestoring(false);
                        });
                      }}
                    >
                      <RotateCcw size={14} /> {restoring ? "Restoring…" : "Restore this version"}
                    </button>
                  </footer>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Bir metin alanının kelime farkı. Silinen ve eklenen parçalar ekran
 * okuyucularda da ayrışsın diye `del` ve `ins` öğeleri kullanılıyor.
 */
function TextDiff({ change, language }: { change: TextChange; language: string }) {
  const segments = useMemo(() => withContext(diffWords(change.before, change.after)), [change.before, change.after]);
  return (
    <div className="history-diff-field">
      <span>{change.field}</span>
      <p lang={language}>
        {segments.map((segment, index) => (
          segment.type === "removed" ? <del key={index}>{segment.text}</del>
            : segment.type === "added" ? <ins key={index}>{segment.text}</ins>
              : <span key={index} className={segment.elided ? "history-elided" : undefined}>{segment.text}</span>
        ))}
      </p>
    </div>
  );
}
