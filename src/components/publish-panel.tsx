"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Globe, RefreshCw, Trash2, X } from "lucide-react";
import { saveLibraryProject } from "@/lib/project-library";
import {
  changePublication,
  listProjectPublications,
  publishProject,
  removePublication,
} from "@/lib/publication-library";
import {
  EXPIRY_CHOICES,
  defaultPublicationInclude,
  expiryFromDays,
  projectContentFingerprint,
  type PublicationInclude,
  type PublicationSummary,
} from "@/lib/publications";
import { groupNotes, ORPHAN_HEADING, type ReaderNote } from "@/lib/reader-notes";
import type { ResearchProject } from "@/lib/schema";
import { useT } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";

type PublishPanelProps = {
  project: ResearchProject;
  onClose: () => void;
};

function availableBlocks(project: ResearchProject, labels: Messages["paper"]["publish"]["blocks"]) {
  return [
    { key: "deepReport", label: labels.deepReport, present: Boolean(project.deepReport) },
    { key: "technicalAppendix", label: labels.technicalAppendix, present: Boolean(project.technicalAppendix) },
    {
      key: "learning",
      label: labels.learning,
      present: Boolean(project.primer || project.derivations?.length || project.quiz || project.misreadings || project.interactives?.length || project.applicationGuide),
    },
    { key: "figures", label: labels.figures, present: Boolean(project.figures?.length) },
  ] as const;
}

export function PublishPanel({ project, onClose }: PublishPanelProps) {
  const messages = useT();
  const t = messages.paper.publish;
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(messages.common.locale, { dateStyle: "medium", timeStyle: "short" }), [messages.common.locale]);
  const [publications, setPublications] = useState<PublicationSummary[]>();
  const [include, setInclude] = useState<PublicationInclude>(defaultPublicationInclude);
  // Okuyucunun notları: yalnızca seçtikleri, yalnızca istenirse (varsayılan kapalı).
  const [notes, setNotes] = useState<ReaderNote[]>([]);
  const [noteIds, setNoteIds] = useState<string[]>([]);
  const noteGroups = useMemo(
    () => groupNotes(project, notes, messages.learning.readerNotes.paperBlocks).filter((group) => group.heading !== ORPHAN_HEADING).map((group) => ({ ...group, notes: group.notes.filter((note) => note.text || note.quote) })).filter((group) => group.notes.length),
    [messages, notes, project],
  );
  const [expiryDays, setExpiryDays] = useState<(typeof EXPIRY_CHOICES)[number]>(null);
  const [busy, setBusy] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const [error, setError] = useState<string>();
  const blocks = availableBlocks(project, t.blocks);
  const currentFingerprint = useMemo(() => projectContentFingerprint(project), [project]);

  useEffect(() => {
    let active = true;
    listProjectPublications(project.id)
      .then((items) => { if (active) setPublications(items); })
      .catch((caught: unknown) => {
        if (!active) return;
        setPublications([]);
        setError(caught instanceof Error ? caught.message : t.loadFailed);
      });
    return () => { active = false; };
    // Dil değişince yeniden yüklenmesin; hata metni o anki dilde kalır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    let active = true;
    fetch(`/api/library/notes?id=${encodeURIComponent(project.id)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { notes: [] }))
      .then((data: { notes?: ReaderNote[] }) => { if (active) setNotes(data.notes ?? []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [project.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function replace(next: PublicationSummary) {
    setPublications((current) => (current ?? []).map((item) => (item.id === next.id ? next : item)));
  }

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setError(undefined);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.common.somethingWentWrong);
    } finally {
      setBusy(undefined);
    }
  }

  const urlFor = (publication: PublicationSummary) => `${window.location.origin}${publication.path}`;

  return (
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="publish-title">
      <div className="regen-panel wide">
        <header className="regen-header">
          <div>
            <span><Globe size={13} /> {t.kicker}</span>
            <h2 id="publish-title">{t.title}</h2>
            <p>{t.intro}</p>
          </div>
          <button className="regen-close" onClick={onClose} aria-label={messages.common.close}><X size={16} /></button>
        </header>

        <div className="regen-body">
          <section className="publish-new">
            <fieldset className="publish-include">
              <legend>{t.include}</legend>
              <label className="publish-fixed"><input type="checkbox" checked disabled /> {t.storyAndEvidence}</label>
              {blocks.map((block) => (
                <label key={block.key} className={block.present ? "" : "publish-absent"}>
                  <input
                    type="checkbox"
                    disabled={!block.present}
                    checked={block.present && include[block.key]}
                    onChange={(event) => setInclude((current) => ({ ...current, [block.key]: event.target.checked }))}
                  />
                  {block.label}{block.present ? "" : t.notInProject}
                </label>
              ))}
              {noteGroups.length ? (
                <>
                  <label>
                    <input type="checkbox" checked={include.notes} onChange={(event) => setInclude((current) => ({ ...current, notes: event.target.checked }))} />
                    {t.notes}
                  </label>
                  {include.notes ? (
                    <div className="publish-notes" role="group" aria-label={t.notesAria}>
                      {noteGroups.map((group) => (
                        <div key={`${group.place}-${group.heading}`}>
                          <span>{t.places[group.place]} · {group.heading}</span>
                          {group.notes.map((note) => (
                            <label key={note.id}>
                              <input
                                type="checkbox"
                                checked={noteIds.includes(note.id)}
                                onChange={(event) => setNoteIds((current) => (event.target.checked ? [...current, note.id] : current.filter((id) => id !== note.id)))}
                              />
                              <span>{note.quote ? `“${note.quote.length > 90 ? `${note.quote.slice(0, 90)}…` : note.quote}” ` : ""}{note.text.length > 120 ? `${note.text.slice(0, 120)}…` : note.text}</span>
                            </label>
                          ))}
                        </div>
                      ))}
                      <small>{t.notesNote}</small>
                    </div>
                  ) : null}
                </>
              ) : null}
            </fieldset>
            <div className="publish-actions">
              <label className="publish-expiry">
                {t.expiry}
                <select value={expiryDays ?? ""} onChange={(event) => setExpiryDays(event.target.value ? Number(event.target.value) as 7 | 30 | 90 : null)}>
                  {EXPIRY_CHOICES.map((days) => <option key={days ?? "never"} value={days ?? ""}>{days ? t.afterDays(days) : t.never}</option>)}
                </select>
              </label>
              <button
                className="regen-primary"
                disabled={busy === "create"}
                onClick={() => {
                  void run("create", async () => {
                    // Yayın diskteki sürümden alınıyor; ekrandaki son düzenleme de girsin.
                    await saveLibraryProject(project);
                    const created = await publishProject(project.id, {
                      include,
                      noteIds: include.notes ? noteIds : [],
                      expiresAt: expiryFromDays(expiryDays, new Date().toISOString()),
                    });
                    setPublications((current) => [created, ...(current ?? [])]);
                  });
                }}
              >
                <Globe size={14} /> {busy === "create" ? t.publishing : t.publishNew}
              </button>
            </div>
          </section>

          {error && <p className="regen-error" role="alert">{error}</p>}

          <ul className="publish-list">
            {publications === undefined && <li className="history-empty">{messages.common.loading}</li>}
            {publications?.length === 0 && <li className="history-empty">{t.empty}</li>}
            {publications?.map((publication) => {
              // Eski kayıtlarda parmak izi yok; onlar için uyarı gösterilmiyor,
              // çünkü zaman damgası açılışta değiştiği için yanlış alarm verirdi.
              const stale = Boolean(publication.contentFingerprint) && publication.contentFingerprint !== currentFingerprint;
              const excluded = blocks.filter((block) => block.present && !publication.settings.include[block.key]).map((block) => block.label);
              return (
                <li key={publication.id} className={`publish-item state-${publication.state}`}>
                  <div className="publish-item-head">
                    <b>{t.states[publication.state]}</b>
                    <code>{publication.path}</code>
                  </div>
                  <small>
                    {t.publishedAt(dateFormat.format(new Date(publication.createdAt)))}
                    {publication.settings.expiresAt ? t.expires(publication.state === "expired", dateFormat.format(new Date(publication.settings.expiresAt))) : ""}
                    {excluded.length ? t.without(excluded) : ""}
                    {publication.noteCount ? t.withNotes(publication.noteCount) : ""}
                  </small>
                  {stale && publication.state !== "expired" && <small className="publish-stale">{t.stale}</small>}
                  <div className="publish-item-actions">
                    <button
                      disabled={publication.state !== "live"}
                      onClick={() => {
                        void navigator.clipboard?.writeText(urlFor(publication)).then(() => {
                          setCopied(publication.id);
                          window.setTimeout(() => setCopied(undefined), 1600);
                        }).catch(() => setError(t.copyFailed));
                      }}
                    >
                      {copied === publication.id ? <Check size={13} /> : <Copy size={13} />} {copied === publication.id ? messages.common.copied : t.copyLink}
                    </button>
                    <a aria-disabled={publication.state !== "live"} href={publication.state === "live" ? publication.path : undefined} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} /> {messages.common.open}
                    </a>
                    <button
                      disabled={Boolean(busy)}
                      onClick={() => {
                        void run(`refresh-${publication.id}`, async () => {
                          await saveLibraryProject(project);
                          replace(await changePublication(publication.id, { refresh: true }));
                        });
                      }}
                    >
                      <RefreshCw size={13} /> {t.update}
                    </button>
                    {publication.state === "expired" ? (
                      <button
                        disabled={Boolean(busy)}
                        onClick={() => {
                          void run(`extend-${publication.id}`, async () => {
                            replace(await changePublication(publication.id, { settings: { ...publication.settings, expiresAt: null } }));
                          });
                        }}
                      >
                        {t.removeExpiry}
                      </button>
                    ) : (
                      <button
                        disabled={Boolean(busy)}
                        onClick={() => {
                          void run(`status-${publication.id}`, async () => {
                            replace(await changePublication(publication.id, { status: publication.status === "live" ? "unpublished" : "live" }));
                          });
                        }}
                      >
                        {publication.status === "live" ? t.unpublish : t.publishAgain}
                      </button>
                    )}
                    <button
                      className="publish-delete"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        void run(`delete-${publication.id}`, async () => {
                          await removePublication(publication.id);
                          setPublications((current) => (current ?? []).filter((item) => item.id !== publication.id));
                        });
                      }}
                    >
                      <Trash2 size={13} /> {t.deleteLink}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
