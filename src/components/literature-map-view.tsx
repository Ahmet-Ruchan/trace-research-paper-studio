"use client";

import { useMemo } from "react";
import { ArrowLeft, BookMarked, Gauge, Milestone, TriangleAlert } from "lucide-react";
import { buildLiteratureMap, type TrackedMetric } from "@/lib/literature-map";
import type { ResearchProject } from "@/lib/schema";

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
  const map = useMemo(() => buildLiteratureMap(projects), [projects]);
  const differing = map.terms.filter((term) => !term.identical);

  return (
    <main className="compare-page">
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
        <p className="landing-eyebrow"><span /> Literature map</p>
        <h1>{map.papers.length} papers, in the order they appeared.</h1>
        <p>
          Nothing here is a verdict. Trace lines up what each paper reports — the same benchmark, the same term — in
          year order, with the page every number came from. A value that grows over the years is not progress by
          itself: the dataset, the setup and which direction is better are things the papers say, not this screen.
        </p>
      </section>

      <section className="compare-block">
        <div className="block-title"><Milestone size={16} /> The papers</div>
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
                    {paper.authors.slice(0, 3).join(", ")}{paper.authors.length > 3 ? " et al." : ""} · {paper.venue || "venue unknown"}
                  </p>
                  <blockquote lang={paper.language}>{paper.thesis}</blockquote>
                  <dl className="compare-facts">
                    <div><dt>Claims</dt><dd>{paper.health.claims.total}</dd></div>
                    <div><dt>Verified</dt><dd>{paper.health.claims.verified}</dd></div>
                    <div><dt>Pages reached</dt><dd>{paper.health.pages.cited.length}</dd></div>
                    <div><dt>Depth</dt><dd>{paper.depth}</dd></div>
                  </dl>
                  {project && <button className="library-open" onClick={() => onOpen(project)}>Open this one</button>}
                </article>
              </li>
            );
          })}
        </ol>
      </section>

      {map.languages.length > 1 ? (
        <p className="compare-warning">
          These projects were written in different languages ({map.languages.join(", ")}). Metrics and terms are
          matched by name, so labels written in different languages will not line up — few matches here means the
          wording differs, not the papers.
        </p>
      ) : null}

      <section className="compare-block">
        <div className="block-title"><Gauge size={16} /> The same measurement across papers</div>
        {map.metrics.length ? (
          <div className="compare-metrics">
            {map.metrics.map((metric) => <TrackedMetricCard metric={metric} key={metric.key} />)}
          </div>
        ) : (
          <p className="compare-empty">
            No metric appears in two or more of these papers under the same name and unit. That usually means they
            measure different things — not that they disagree.
          </p>
        )}
      </section>

      {differing.length ? (
        <section className="compare-block">
          <div className="block-title"><BookMarked size={16} /> The same term, defined differently</div>
          <p className="compare-note">
            These words recur across the papers with definitions that are not identical — worth reading before
            treating a shared word as a shared idea.
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
        <div className="block-title"><TriangleAlert size={16} /> What each admits it cannot do</div>
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
      <svg className="map-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric.label} as reported by ${metric.points.length} papers, in year order`}>
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
              <td>{point.page ? `p. ${point.page}` : "web"}</td>
              <td>{point.context}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
