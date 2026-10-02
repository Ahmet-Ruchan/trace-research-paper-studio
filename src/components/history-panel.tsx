"use client";

import { useEffect, useMemo, useState } from "react";
import { Bookmark, History, RotateCcw, X } from "lucide-react";
import { listLibraryRevisions, loadLibraryRevision, markLibraryRevision, saveLibraryProject } from "@/lib/project-library";
import {
  MAX_REVISION_LABEL,
  REVISION_LIMIT,
  describeProjectChanges,
  revisionFieldLabel,
  type RevisionSummary,
  type TextChange,
} from "@/lib/project-revisions";
import type { ResearchProject } from "@/lib/schema";
import { diffWords, withContext } from "@/lib/text-diff";
import { useT } from "@/i18n/client";

type HistoryPanelProps = {
  project: ResearchProject;
  onRestore: (project: ResearchProject) => Promise<void>;
  onClose: () => void;
};

type Selected = { summary: RevisionSummary; project: ResearchProject };

export function HistoryPanel({ project, onRestore, onClose }: HistoryPanelProps) {
  const messages = useT();
  const t = messages.paper.history;
  const reasonLabels = t.reasons;
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(messages.common.locale, { dateStyle: "medium", timeStyle: "short" }), [messages.common.locale]);
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
        setError(caught instanceof Error ? caught.message : t.loadFailed);
      });
    return () => { active = false; };
    // Proje her düzenlemede yeni bir nesne; liste yalnızca proje değişince yenilenir.
    // Dil değişince yeniden yüklenmesin; hata metni o anki dilde kalır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changes = useMemo(
    () => (selected ? describeProjectChanges(selected.project, project, t.changes) : []),
    [selected, project, t.changes],
  );

  async function select(summary: RevisionSummary) {
    setError(undefined);
    setLoadingId(summary.id);
    try {
      const loaded = await loadLibraryRevision(project.id, summary.id);
      setSelected({ summary: loaded.revision, project: loaded.project });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.openFailed);
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
      setError(caught instanceof Error ? caught.message : t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div className="regen-panel wide history-panel">
        <header className="regen-header">
          <div>
            <span><History size={13} /> {t.kicker}</span>
            <h2 id="history-title">{t.title}</h2>
            <p>{t.intro(REVISION_LIMIT)}</p>
          </div>
          <button className="regen-close" onClick={onClose} aria-label={messages.common.close}><X size={16} /></button>
        </header>

        <div className="regen-body">
          <div className="history-save">
            <input
              value={label}
              maxLength={MAX_REVISION_LABEL}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t.namePlaceholder}
              aria-label={t.nameAria}
            />
            <button className="regen-primary" disabled={saving} onClick={() => { void saveVersion(); }}>
              <Bookmark size={14} /> {saving ? messages.common.saving : t.saveThis}
            </button>
          </div>
          {error && <p className="regen-error" role="alert">{error}</p>}

          <div className="history-layout">
            <ol className="history-list">
              {revisions === undefined && <li className="history-empty">{messages.common.loading}</li>}
              {revisions?.length === 0 && (
                <li className="history-empty">{t.empty}</li>
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
                    <small>{t.counts(revision.claims, revision.storySections, revision.reportSections)}</small>
                  </button>
                </li>
              ))}
            </ol>

            <section className="history-detail" aria-live="polite">
              {!selected ? (
                <p className="regen-note">{t.pick}</p>
              ) : (
                <>
                  <h3>{selected.summary.label ?? reasonLabels[selected.summary.reason]}</h3>
                  <p className="regen-note">{t.savedAt(dateFormat.format(new Date(selected.summary.savedAt)))}</p>
                  {changes.length === 0 ? (
                    <p className="regen-note">{t.unchanged}</p>
                  ) : (
                    <>
                      <span className="history-caption">{t.changedSince}</span>
                      <p className="history-legend">
                        <del>{t.legend.struck}</del>{t.legend.afterStruck}<ins>{t.legend.highlighted}</ins>{t.legend.afterHighlighted}
                      </p>
                      <ul className="history-changes">
                        {changes.map((change, index) => (
                          <li key={`${change.summary}-${change.subject ?? ""}-${index}`} className={`change-${change.area}`}>
                            <span>{change.summary}</span>
                            {change.subject && <small lang={project.language}>{change.subject}</small>}
                            {change.texts && (
                              <details className="history-diff">
                                <summary>{t.showText}</summary>
                                {change.texts.map((text) => <TextDiff key={text.field} change={text} label={revisionFieldLabel(text.field, t.changes)} language={project.language} />)}
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
                          setError(caught instanceof Error ? caught.message : t.restoreFailed);
                          setRestoring(false);
                        });
                      }}
                    >
                      <RotateCcw size={14} /> {restoring ? t.restoring : t.restoreThis}
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
function TextDiff({ change, label, language }: { change: TextChange; label: string; language: string }) {
  const segments = useMemo(() => withContext(diffWords(change.before, change.after)), [change.before, change.after]);
  return (
    <div className="history-diff-field">
      <span>{label}</span>
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
