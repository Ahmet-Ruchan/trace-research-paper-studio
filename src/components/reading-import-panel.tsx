"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { useT } from "@/i18n/client";
import { formatLabel, importPlan, MAX_REFERENCE_FILE, parseReferenceFile, type ImportPlan } from "@/lib/reference-import";
import type { ResearchProject } from "@/lib/schema";
import { useReadingList } from "./reading-list";

/**
 * Zotero ya da bir .bib dosyasından okuma listesine (`reference-import.ts`).
 * Dosya tarayıcıda okunuyor; önce ne ekleneceği gösteriliyor, okuyucu onaylayınca
 * hepsi birden ekleniyor.
 */

type Preview = { file: string; format: string; found: number; skipped: number; plan: ImportPlan };

export function ReadingImportPanel({ projects }: { projects: ResearchProject[] }) {
  const messages = useT();
  const t = messages.learning.readingImport;
  const words = messages.learning.words.referenceImport;
  const reading = useReadingList();
  const [preview, setPreview] = useState<Preview>();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  if (!reading?.ready) return null;

  async function read(file: File) {
    setMessage(undefined);
    setPreview(undefined);
    try {
      if (file.size > MAX_REFERENCE_FILE) throw new Error(words.tooLarge);
      const parsed = parseReferenceFile(file.name, await file.text(), words);
      if (!parsed.works.length) throw new Error(t.noWorks(formatLabel(parsed.format)));
      setPreview({ file: file.name, format: formatLabel(parsed.format), found: parsed.works.length, skipped: parsed.skipped, plan: importPlan(parsed.works, reading!.items, projects, new Date().toISOString()) });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t.readFailed, error: true });
    }
  }

  async function add(plan: ImportPlan) {
    setBusy(true);
    try {
      await reading!.addAll(plan.fresh);
      setMessage({ text: t.added(plan.fresh.length) });
      setPreview(undefined);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t.addFailed, error: true });
    } finally {
      setBusy(false);
    }
  }

  const plan = preview?.plan;
  const notes = plan
    ? [
        plan.onList ? t.onList(plan.onList) : "",
        plan.inLibrary ? t.inLibrary(plan.inLibrary) : "",
        plan.repeated ? t.repeated(plan.repeated) : "",
        preview.skipped ? t.untitled(preview.skipped) : "",
        plan.overLimit ? t.overLimit(plan.overLimit) : "",
      ].filter(Boolean)
    : [];

  return (
    <section className="reading-import" aria-label={t.title}>
      <h3><FileUp size={15} aria-hidden="true" /> {t.heading}</h3>
      <p>
        {t.howTo.before}<strong>{t.howTo.action}</strong>{t.howTo.middle}<code>.bib</code>{t.howTo.after}
      </p>
      <label className="reading-import-file">
        <input
          type="file"
          accept=".bib,.bibtex,.ris,.json,application/x-bibtex,application/x-research-info-systems,application/json"
          aria-label={t.chooseLabel}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void read(file);
          }}
        />
        <span>{t.choose}</span>
      </label>
      {preview && plan ? (
        <div className="reading-import-preview" role="status">
          <p>
            <strong>{t.found(preview.found)}</strong>{t.foundRest(preview.file, preview.format, plan.fresh.length, notes)}
          </p>
          {plan.fresh.length ? (
            <ul>
              {plan.fresh.slice(0, 5).map((item) => (
                <li key={item.id}>{item.title}{item.year ? ` (${item.year})` : ""}</li>
              ))}
              {plan.fresh.length > 5 ? <li className="reading-import-more">{t.more(plan.fresh.length - 5)}</li> : null}
            </ul>
          ) : null}
          <div className="reading-import-actions">
            {plan.fresh.length ? (
              <button type="button" className="regen-primary" disabled={busy} onClick={() => void add(plan)}>
                {t.add(plan.fresh.length)}
              </button>
            ) : null}
            <button type="button" onClick={() => setPreview(undefined)} disabled={busy}>{messages.common.cancel}</button>
          </div>
        </div>
      ) : null}
      {message ? <p className={message.error ? "regen-error" : "reading-share-message"} role={message.error ? "alert" : "status"}>{message.text}</p> : null}
    </section>
  );
}
