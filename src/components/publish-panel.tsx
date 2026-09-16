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
import type { ResearchProject } from "@/lib/schema";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

const stateLabels: Record<PublicationSummary["state"], string> = {
  live: "Live",
  unpublished: "Unpublished",
  expired: "Expired",
};

type PublishPanelProps = {
  project: ResearchProject;
  onClose: () => void;
};

function availableBlocks(project: ResearchProject) {
  return [
    { key: "deepReport", label: "Deep report", present: Boolean(project.deepReport) },
    { key: "technicalAppendix", label: "Technical appendix", present: Boolean(project.technicalAppendix) },
    {
      key: "learning",
      label: "Learning layer",
      present: Boolean(project.primer || project.derivations?.length || project.quiz || project.interactives?.length || project.applicationGuide),
    },
    { key: "figures", label: "The paper's own figures", present: Boolean(project.figures?.length) },
  ] as const;
}

export function PublishPanel({ project, onClose }: PublishPanelProps) {
  const [publications, setPublications] = useState<PublicationSummary[]>();
  const [include, setInclude] = useState<PublicationInclude>(defaultPublicationInclude);
  const [expiryDays, setExpiryDays] = useState<(typeof EXPIRY_CHOICES)[number]>(null);
  const [busy, setBusy] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const [error, setError] = useState<string>();
  const blocks = availableBlocks(project);
  const currentFingerprint = useMemo(() => projectContentFingerprint(project), [project]);

  useEffect(() => {
    let active = true;
    listProjectPublications(project.id)
      .then((items) => { if (active) setPublications(items); })
      .catch((caught: unknown) => {
        if (!active) return;
        setPublications([]);
        setError(caught instanceof Error ? caught.message : "The publications could not be loaded.");
      });
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
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
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
            <span><Globe size={13} /> Share</span>
            <h2 id="publish-title">Publish this story</h2>
            <p>A publication is a frozen copy with its own link. Later edits stay private until you update it. Anyone who can reach this Trace server and has the link can read it: on this machine that is only you, on a deployed studio it is everyone with the link. Search engines are asked not to index it.</p>
          </div>
          <button className="regen-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="regen-body">
          <section className="publish-new">
            <fieldset className="publish-include">
              <legend>Include</legend>
              <label className="publish-fixed"><input type="checkbox" checked disabled /> Story and evidence, with every quote and page</label>
              {blocks.map((block) => (
                <label key={block.key} className={block.present ? "" : "publish-absent"}>
                  <input
                    type="checkbox"
                    disabled={!block.present}
                    checked={block.present && include[block.key]}
                    onChange={(event) => setInclude((current) => ({ ...current, [block.key]: event.target.checked }))}
                  />
                  {block.label}{block.present ? "" : " · not in this project"}
                </label>
              ))}
            </fieldset>
            <div className="publish-actions">
              <label className="publish-expiry">
                Link stops working
                <select value={expiryDays ?? ""} onChange={(event) => setExpiryDays(event.target.value ? Number(event.target.value) as 7 | 30 | 90 : null)}>
                  {EXPIRY_CHOICES.map((days) => <option key={days ?? "never"} value={days ?? ""}>{days ? `After ${days} days` : "Never"}</option>)}
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
                      expiresAt: expiryFromDays(expiryDays, new Date().toISOString()),
                    });
                    setPublications((current) => [created, ...(current ?? [])]);
                  });
                }}
              >
                <Globe size={14} /> {busy === "create" ? "Publishing…" : "Publish a new link"}
              </button>
            </div>
          </section>

          {error && <p className="regen-error" role="alert">{error}</p>}

          <ul className="publish-list">
            {publications === undefined && <li className="history-empty">Loading…</li>}
            {publications?.length === 0 && <li className="history-empty">This project has not been published yet.</li>}
            {publications?.map((publication) => {
              // Eski kayıtlarda parmak izi yok; onlar için uyarı gösterilmiyor,
              // çünkü zaman damgası açılışta değiştiği için yanlış alarm verirdi.
              const stale = Boolean(publication.contentFingerprint) && publication.contentFingerprint !== currentFingerprint;
              const excluded = blocks.filter((block) => block.present && !publication.settings.include[block.key]).map((block) => block.label);
              return (
                <li key={publication.id} className={`publish-item state-${publication.state}`}>
                  <div className="publish-item-head">
                    <b>{stateLabels[publication.state]}</b>
                    <code>{publication.path}</code>
                  </div>
                  <small>
                    Published {dateFormat.format(new Date(publication.createdAt))}
                    {publication.settings.expiresAt ? ` · ${publication.state === "expired" ? "expired" : "expires"} ${dateFormat.format(new Date(publication.settings.expiresAt))}` : ""}
                    {excluded.length ? ` · without ${excluded.join(", ").toLowerCase()}` : ""}
                  </small>
                  {stale && publication.state !== "expired" && <small className="publish-stale">The project has changed since this copy was taken.</small>}
                  <div className="publish-item-actions">
                    <button
                      disabled={publication.state !== "live"}
                      onClick={() => {
                        void navigator.clipboard?.writeText(urlFor(publication)).then(() => {
                          setCopied(publication.id);
                          window.setTimeout(() => setCopied(undefined), 1600);
                        }).catch(() => setError("The link could not be copied; open it and copy it from the address bar."));
                      }}
                    >
                      {copied === publication.id ? <Check size={13} /> : <Copy size={13} />} {copied === publication.id ? "Copied" : "Copy link"}
                    </button>
                    <a aria-disabled={publication.state !== "live"} href={publication.state === "live" ? publication.path : undefined} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} /> Open
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
                      <RefreshCw size={13} /> Update to current version
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
                        Remove expiry
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
                        {publication.status === "live" ? "Unpublish" : "Publish again"}
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
                      <Trash2 size={13} /> Delete link
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
