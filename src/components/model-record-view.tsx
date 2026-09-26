"use client";

import { useMemo } from "react";
import { ArrowLeft, Columns2, Gauge, ListX } from "lucide-react";
import { documentTaskRoles, type ModelTeam } from "@/lib/model-providers";
import { modelIdentity, modelLabel, modelRecord, type ExclusionReason, type ModelIdentity, type ModelRecord } from "@/lib/model-record";
import type { ResearchProject } from "@/lib/schema";

const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

function plural(value: number, noun: string) {
  return `${value.toLocaleString("en")} ${noun}${value === 1 ? "" : "s"}`;
}

const exclusionText: Record<ExclusionReason, string> = {
  "not-checked": "Its quotes were never checked against the PDF. Open it and use Check the quotes against the PDF in Evidence health.",
  "model-not-recorded": "The project does not say which model wrote it.",
  "check-truncated": "Its check stopped listing missing quotes at 400, so its rate would look better than it is.",
  "changed-since-check": "The evidence changed after its quotes were checked. Check them again with the PDF to count it.",
  "stage-unknown": "Two models wrote its evidence, and some claims cannot be traced to the stage that wrote them.",
};

/**
 * Hangi model kaç alıntıyı sayfasında bulunabilir yazdı?
 *
 * Bu ekran bir hüküm değil, bir sayım. Modeller farklı makaleler okudu;
 * taranmış ya da tablo ağırlıklı bir makale her modelin oranını düşürür. Bu
 * yüzden her satır kaç alıntıya dayandığını ve aralığını gösteriyor, en adil
 * karşılaştırma (aynı makale, farklı modeller) ayrıca listeleniyor ve sayıma
 * girmeyen her proje nedeniyle birlikte görünüyor.
 */
export function ModelRecordView({
  projects,
  onBack,
  onOpen,
}: {
  projects: ResearchProject[];
  onBack: () => void;
  onOpen: (project: ResearchProject) => void;
}) {
  const record = useMemo(() => modelRecord(projects), [projects]);

  return (
    <main className="compare-page model-record-page">
      <header className="library-header">
        <button className="brand" onClick={onBack} aria-label="Back to the library">
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>research studio</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> Library</button>
        </div>
      </header>

      <section className="compare-hero">
        <p className="landing-eyebrow"><span /> Model record</p>
        <h1>{record.models.length ? "How each model’s quotes held up." : "No model has a checked quote yet."}</h1>
        <p>
          Every quote a model writes is searched for on the page it cites. This adds up, for each model, how many were
          found across the papers in your library. A quote that is not found is not always invented: tables, equations
          and scanned pages do not survive text extraction. A low rate says look closer, not that the model made it up.
          No model is asked; the numbers come from the projects alone.
        </p>
      </section>

      {record.models.length > 0 && (
        <section className="compare-block">
          <div className="block-title"><Gauge size={16} /> By model</div>
          <p className="compare-note">
            Sorted by the lowest rate the evidence is consistent with (a 95% Wilson interval), so a model checked on three
            quotes cannot outrank one checked on three hundred. Each model read different papers, and a scanned or
            table-heavy paper lowers any model’s rate. Reviewed claims are a person’s decisions in the Review tab.
          </p>
          <div className="record-table-wrap">
            <table className="record-table">
              <thead>
                <tr><th>Model</th><th>Papers</th><th>Quotes found on their page</th><th>Rate</th><th>Reviewed claims</th></tr>
              </thead>
              <tbody>
                {record.models.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{modelLabel(row)}</th>
                    <td data-label="Papers">{row.papers}</td>
                    <td data-label="Quotes found">{row.found.toLocaleString("en")} of {row.checked.toLocaleString("en")}</td>
                    <td data-label="Rate"><b>{percent.format(row.rate)}</b><small>likely {percent.format(row.low)}–{percent.format(row.high)}</small></td>
                    <td data-label="Reviewed claims">{row.approved || row.rejected ? `${row.approved} approved · ${row.rejected} rejected` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="compare-block">
        <div className="block-title"><Columns2 size={16} /> Same paper, different models</div>
        {record.samePaper.length ? (
          <>
            <p className="compare-note">
              The fairest comparison in the library: the same PDF, so the same tables and equations stood in every
              model’s way.
            </p>
            <div className="record-pairs">
              {record.samePaper.map((group) => (
                <article className="compare-card" key={group.entries[0].project.id}>
                  <h2>{group.title}</h2>
                  <table className="record-table">
                    <tbody>
                      {group.entries.map((entry) => (
                        <tr key={`${entry.project.id}:${entry.key}`}>
                          <th scope="row">{modelLabel(entry)}</th>
                          <td>{entry.found} of {entry.checked}</td>
                          <td><b>{percent.format(entry.found / entry.checked)}</b></td>
                          <td><button className="library-open" onClick={() => onOpen(entry.project)}>Open</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="compare-empty">
            When the same paper is analysed with two different models, their quotes are lined up here. That is the
            fairest comparison, because the same tables and equations stand in both models’ way.
          </p>
        )}
      </section>

      {record.excluded.length > 0 && (
        <section className="compare-block">
          <div className="block-title"><ListX size={16} /> Not counted</div>
          <p className="compare-note">
            {plural(record.excluded.length, "project")} {record.excluded.length === 1 ? "is" : "are"} left out rather than
            counted with numbers that could be wrong.
          </p>
          <ul className="record-excluded">
            {record.excluded.map((item) => (
              <li key={item.project.id}>
                <div><strong>{item.project.evidence.paper.title}</strong><span>{exclusionText[item.reason]}</span></div>
                <button className="library-open" onClick={() => onOpen(item.project)}>Open</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/**
 * Model seçerken, seçilen modelin bu kütüphanedeki alıntı karnesi. Yalnızca
 * alıntı yazan görevler (kanıt ve teknik) sayılıyor; rapor ve görsel modelleri
 * alıntı yazmıyor.
 */
export function QuoteTrackRecord({ assignments, record }: { assignments: ModelTeam; record: ModelRecord }) {
  const models = [...new Map(
    documentTaskRoles
      .map((role) => modelIdentity(assignments[role]))
      .filter((model): model is ModelIdentity => Boolean(model))
      .map((model) => [model.key, model]),
  ).values()];
  if (!models.length) return null;

  return (
    <div className="quote-track-record">
      <strong>Quote record in your library</strong>
      <ul>
        {models.map((model) => {
          const row = record.models.find((item) => item.key === model.key);
          return (
            <li key={model.key}>
              <b>{modelLabel(model)}</b>
              <span>
                {row
                  ? `${row.found.toLocaleString("en")} of ${row.checked.toLocaleString("en")} quotes found on their page, in ${plural(row.papers, "paper")} (${percent.format(row.rate)}, likely ${percent.format(row.low)}–${percent.format(row.high)}).`
                  : "No checked quotes from this model in your library yet."}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
