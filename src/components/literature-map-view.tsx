"use client";

import { useMemo } from "react";
import { ArrowLeft, BookMarked, Gauge, Milestone, TriangleAlert } from "lucide-react";
import { useT } from "@/i18n/client";
import { buildLiteratureMap, type TrackedMetric } from "@/lib/literature-map";
import type { ResearchProject } from "@/lib/schema";
import { StudioNav } from "./focus/studio-nav";

/**
 * Üç ila altı makale, yıl sırasıyla.
 *
 * İkili karşılaştırmayla aynı söz: burada bir hüküm YOK. Bir ölçütün yıllar
 * içinde büyümesi ilerleme olarak sunulmuyor — ölçütün yönü, veri kümesi ve
 * ölçüm koşulu makaleden okunacak şeyler. Ekran hizalıyor ve her sayının
 * sayfasını gösteriyor.
 */
export function LiteratureMapView({
  projects,
  onBack,
  onOpen,
}: {
  projects: ResearchProject[];
  onBack: () => void;
  onOpen: (project: ResearchProject) => void;
}) {
  const learning = useT().learning;
  const t = learning.literatureMap;
  const map = useMemo(() => buildLiteratureMap(projects), [projects]);
  const differing = map.terms.filter((term) => !term.identical);

  return (
    <main className="compare-page">
      <header className="library-header">
        <button className="brand" onClick={onBack} aria-label={learning.shell.backToLibrary}>
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>{learning.shell.brandTagline}</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> {learning.shell.library}</button>
          <StudioNav />
        </div>
      </header>

      <section className="compare-hero">
        <p className="landing-eyebrow"><span /> {t.eyebrow}</p>
        <h1>{t.heading(map.papers.length)}</h1>
        <p>
          {t.intro}
        </p>
      </section>

      <section className="compare-block">
        <div className="block-title"><Milestone size={16} /> {t.papersTitle}</div>
        <ol className="map-timeline">
          {map.papers.map((paper) => {
            const project = projects.find((item) => item.id === paper.id);
            return (
              <li key={paper.id}>
                <span className="map-year">{paper.yearNumber ?? "—"}</span>
                <article className="compare-card">
                  <span className="compare-side">{paper.letter}</span>
                  <h2>{paper.title}</h2>
                  <p className="compare-meta">
                    {paper.authors.slice(0, 3).join(", ")}{paper.authors.length > 3 ? t.etAl : ""} · {paper.venue || t.venueUnknown}
                  </p>
                  <blockquote lang={paper.language}>{paper.thesis}</blockquote>
                  <dl className="compare-facts">
                    <div><dt>{t.claims}</dt><dd>{paper.health.claims.total}</dd></div>
                    <div><dt>{t.verified}</dt><dd>{paper.health.claims.verified}</dd></div>
                    <div><dt>{t.pagesReached}</dt><dd>{paper.health.pages.cited.length}</dd></div>
                    <div><dt>{t.depth}</dt><dd>{learning.depthNames[paper.depth]}</dd></div>
                  </dl>
                  {project && <button className="library-open" onClick={() => onOpen(project)}>{t.openThis}</button>}
                </article>
              </li>
            );
          })}
        </ol>
      </section>

      {map.languages.length > 1 ? (
        <p className="compare-warning">
          {t.languages(map.languages.join(", "))}
        </p>
      ) : null}

      <section className="compare-block">
        <div className="block-title"><Gauge size={16} /> {t.metricsTitle}</div>
        {map.metrics.length ? (
          <div className="compare-metrics">
            {map.metrics.map((metric) => <TrackedMetricCard metric={metric} key={metric.key} />)}
          </div>
        ) : (
          <p className="compare-empty">
            {t.metricsEmpty}
          </p>
        )}
      </section>

      {differing.length ? (
        <section className="compare-block">
          <div className="block-title"><BookMarked size={16} /> {t.termsTitle}</div>
          <p className="compare-note">
            {t.termsNote}
          </p>
          <div className="compare-terms map-terms">
            {differing.map((term) => (
              <article key={term.term}>
                <h3>{term.term}</h3>
                <div>
                  {term.definitions.map((item) => <p key={item.projectId}><span>{item.letter}</span>{item.definition}</p>)}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="compare-block">
        <div className="block-title"><TriangleAlert size={16} /> {t.limitsTitle}</div>
        <div className="compare-lists map-lists">
          {map.papers.map((paper) => (
            <div key={paper.id}>
              <h3><span className="compare-side">{paper.letter}</span> {paper.title}</h3>
              <ol lang={paper.language}>{paper.limitations.map((item, position) => <li key={position}>{item}</li>)}</ol>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function TrackedMetricCard({ metric }: { metric: TrackedMetric }) {
  const messages = useT();
  const t = messages.learning.literatureMap;
  const values = metric.points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 280;
  const height = 64;
  const x = (index: number) => 18 + (index * (width - 36)) / Math.max(metric.points.length - 1, 1);
  // Bütün değerler eşitse çizgi ortada düz durur; sıfıra bölme olmaz.
  const y = (value: number) => (max === min ? height / 2 : height - 14 - ((value - min) / (max - min)) * (height - 28));

  return (
    <article className="compare-metric">
      <header>
        <strong>{metric.label}</strong>
        <span>{metric.unit}</span>
      </header>
      <svg className="map-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t.sparkLabel(metric.label, metric.points.length)}>
        <polyline points={metric.points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")} />
        {metric.points.map((point, index) => (
          <g key={point.projectId}>
            <circle cx={x(index)} cy={y(point.value)} r={3.5} />
            <text x={x(index)} y={y(point.value) - 8} textAnchor="middle">{point.letter}</text>
          </g>
        ))}
      </svg>
      <table className="map-values">
        <tbody>
          {metric.points.map((point) => (
            <tr key={point.projectId}>
              <td><span className="compare-side">{point.letter}</span></td>
              <td>{point.yearNumber ?? "—"}</td>
              <td><b>{point.displayValue}</b></td>
              <td>{point.page ? messages.common.page(point.page) : t.web}</td>
              <td>{point.context}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
