"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { formatLabel, importPlan, MAX_REFERENCE_FILE, parseReferenceFile, type ImportPlan } from "@/lib/reference-import";
import type { ResearchProject } from "@/lib/schema";
import { useReadingList } from "./reading-list";

/**
 * Zotero ya da bir .bib dosyasından okuma listesine (`reference-import.ts`).
 * Dosya tarayıcıda okunuyor; önce ne ekleneceği gösteriliyor, okuyucu onaylayınca
 * hepsi birden ekleniyor.
 */

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

type Preview = { file: string; format: string; found: number; skipped: number; plan: ImportPlan };

export function ReadingImportPanel({ projects }: { projects: ResearchProject[] }) {
  const reading = useReadingList();
  const [preview, setPreview] = useState<Preview>();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  if (!reading?.ready) return null;

  async function read(file: File) {
    setMessage(undefined);
    setPreview(undefined);
    try {
      if (file.size > MAX_REFERENCE_FILE) throw new Error("The file is larger than 5 MB.");
      const parsed = parseReferenceFile(file.name, await file.text());
      if (!parsed.works.length) throw new Error(`No work with a title was found in this ${formatLabel(parsed.format)} file.`);
      setPreview({ file: file.name, format: formatLabel(parsed.format), found: parsed.works.length, skipped: parsed.skipped, plan: importPlan(parsed.works, reading!.items, projects, new Date().toISOString()) });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "The file could not be read.", error: true });
    }
  }

  async function add(plan: ImportPlan) {
    setBusy(true);
    try {
      await reading!.addAll(plan.fresh);
      setMessage({ text: `${plural(plan.fresh.length, "work")} added to your reading list.` });
      setPreview(undefined);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "The works could not be added.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const plan = preview?.plan;
  const notes = plan
    ? [
        plan.onList ? `${plural(plan.onList, "work")} already on your list` : "",
        plan.inLibrary ? `${plan.inLibrary} already in your library` : "",
        plan.repeated ? `${plan.repeated} listed twice in the file` : "",
        preview.skipped ? `${preview.skipped} without a title` : "",
        plan.overLimit ? `${plan.overLimit} that no longer fit (the list holds 500)` : "",
      ].filter(Boolean)
    : [];

  return (
    <section className="reading-import" aria-label="Import from Zotero or BibTeX">
      <h3><FileUp size={15} aria-hidden="true" /> Import from Zotero or a .bib file</h3>
      <p>
        In Zotero, right-click a collection, choose <strong>Export Collection…</strong> and pick BibTeX, RIS or CSL JSON; Mendeley,
        EndNote and a LaTeX project&rsquo;s <code>.bib</code> work too. The works join this list, each with its arXiv number or DOI
        when the file has one. The file is read in this browser and nothing else leaves it.
      </p>
      <label className="reading-import-file">
        <input
          type="file"
          accept=".bib,.bibtex,.ris,.json,application/x-bibtex,application/x-research-info-systems,application/json"
          aria-label="Choose a BibTeX, RIS or CSL JSON file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void read(file);
          }}
        />
        <span>Choose a file</span>
      </label>
      {preview && plan ? (
        <div className="reading-import-preview" role="status">
          <p>
            <strong>{plural(preview.found, "work")}</strong> in {preview.file} ({preview.format}):{" "}
            {plan.fresh.length ? `${plan.fresh.length} new` : "nothing new"}
            {notes.length ? `; ${notes.join(", ")}` : ""}.
          </p>
          {plan.fresh.length ? (
            <ul>
              {plan.fresh.slice(0, 5).map((item) => (
                <li key={item.id}>{item.title}{item.year ? ` (${item.year})` : ""}</li>
              ))}
              {plan.fresh.length > 5 ? <li className="reading-import-more">and {plural(plan.fresh.length - 5, "more work")}</li> : null}
            </ul>
          ) : null}
          <div className="reading-import-actions">
            {plan.fresh.length ? (
              <button type="button" className="regen-primary" disabled={busy} onClick={() => void add(plan)}>
                Add {plural(plan.fresh.length, "work")} to the reading list
              </button>
            ) : null}
            <button type="button" onClick={() => setPreview(undefined)} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : null}
      {message ? <p className={message.error ? "regen-error" : "reading-share-message"} role={message.error ? "alert" : "status"}>{message.text}</p> : null}
    </section>
  );
}
