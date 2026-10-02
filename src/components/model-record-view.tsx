"use client";

import { useMemo } from "react";
import { ArrowLeft, Columns2, Gauge, ListX } from "lucide-react";
import { documentTaskRoles, type ModelTeam } from "@/lib/model-providers";
import { modelIdentity, modelLabel, modelRecord, type ModelIdentity, type ModelRecord } from "@/lib/model-record";
import type { ResearchProject } from "@/lib/schema";
import { useT } from "@/i18n/client";
import { StudioNav } from "./focus/studio-nav";

/** Yüzde arayüzün dilinde: "95.5%" / "%95,5". */
function usePercent() {
  const { locale } = useT().common;
  return useMemo(() => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }), [locale]);
}

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
  const messages = useT();
  const t = messages.paper.modelRecord;
  const header = messages.paper.pageHeader;
  const { locale } = messages.common;
  const percent = usePercent();
  const label = (model: Pick<ModelIdentity, "provider" | "model">) => modelLabel(model, t.modelLabel);

  return (
    <main className="compare-page model-record-page">
      <header className="library-header">
        <button className="brand" onClick={onBack} aria-label={header.back}>
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>{header.tagline}</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> {header.library}</button>
          <StudioNav />
        </div>
      </header>

      <section className="compare-hero">
        <p className="landing-eyebrow"><span /> {t.eyebrow}</p>
        <h1>{record.models.length ? t.title : t.titleEmpty}</h1>
        <p>{t.intro}</p>
      </section>

      {record.models.length > 0 && (
        <section className="compare-block">
          <div className="block-title"><Gauge size={16} /> {t.byModel}</div>
          <p className="compare-note">{t.byModelNote}</p>
          <div className="record-table-wrap">
            <table className="record-table">
              <thead>
                <tr><th>{t.columns.model}</th><th>{t.columns.papers}</th><th>{t.columns.quotesFound}</th><th>{t.columns.rate}</th><th>{t.columns.reviewed}</th></tr>
              </thead>
              <tbody>
                {record.models.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{label(row)}</th>
                    <td data-label={t.columns.papers}>{row.papers}</td>
                    <td data-label={t.columns.quotesFoundShort}>{t.foundOf(row.found.toLocaleString(locale), row.checked.toLocaleString(locale))}</td>
                    <td data-label={t.columns.rate}><b>{percent.format(row.rate)}</b><small>{t.likely(percent.format(row.low), percent.format(row.high))}</small></td>
                    <td data-label={t.columns.reviewed}>{row.approved || row.rejected ? t.reviewedCounts(row.approved, row.rejected) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="compare-block">
        <div className="block-title"><Columns2 size={16} /> {t.samePaper}</div>
        {record.samePaper.length ? (
          <>
            <p className="compare-note">{t.samePaperNote}</p>
            <div className="record-pairs">
              {record.samePaper.map((group) => (
                <article className="compare-card" key={group.entries[0].project.id}>
                  <h2>{group.title}</h2>
                  <table className="record-table">
                    <tbody>
                      {group.entries.map((entry) => (
                        <tr key={`${entry.project.id}:${entry.key}`}>
                          <th scope="row">{label(entry)}</th>
                          <td>{t.foundOf(String(entry.found), String(entry.checked))}</td>
                          <td><b>{percent.format(entry.found / entry.checked)}</b></td>
                          <td><button className="library-open" onClick={() => onOpen(entry.project)}>{messages.common.open}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="compare-empty">{t.samePaperEmpty}</p>
        )}
      </section>

      {record.excluded.length > 0 && (
        <section className="compare-block">
          <div className="block-title"><ListX size={16} /> {t.notCounted}</div>
          <p className="compare-note">{t.notCountedNote(record.excluded.length)}</p>
          <ul className="record-excluded">
            {record.excluded.map((item) => (
              <li key={item.project.id}>
                <div><strong>{item.project.evidence.paper.title}</strong><span>{[t.exclusions[item.reason], t.remedies[item.reason]].filter(Boolean).join(" ")}</span></div>
                <button className="library-open" onClick={() => onOpen(item.project)}>{messages.common.open}</button>
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
  const t = useT().paper.modelRecord;
  const percent = usePercent();
  const models = [...new Map(
    documentTaskRoles
      .map((role) => modelIdentity(assignments[role]))
      .filter((model): model is ModelIdentity => Boolean(model))
      .map((model) => [model.key, model]),
  ).values()];
  if (!models.length) return null;

  return (
    <div className="quote-track-record">
      <strong>{t.trackRecord}</strong>
      <ul>
        {models.map((model) => {
          const row = record.models.find((item) => item.key === model.key);
          return (
            <li key={model.key}>
              <b>{modelLabel(model, t.modelLabel)}</b>
              <span>
                {row
                  ? t.trackRow(row.found, row.checked, row.papers, percent.format(row.rate), percent.format(row.low), percent.format(row.high))
                  : t.trackNone}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
