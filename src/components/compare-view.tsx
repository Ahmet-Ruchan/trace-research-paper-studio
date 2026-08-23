"use client";

import { useMemo } from "react";
import { ArrowLeft, BookMarked, Gauge, ShieldCheck, TriangleAlert } from "lucide-react";
import { compareProjects, formatDifference, type SharedMetric } from "@/lib/compare-projects";
import type { Claim, ResearchProject } from "@/lib/schema";

const kindLabels: Record<Claim["kind"], string> = {
  "reported-result": "Result",
  "author-interpretation": "Interpretation",
  method: "Method",
  background: "Background",
  limitation: "Limitation",
};

/**
 * İki makale yan yana.
 *
 * Bu ekranın söylemediği şey, söylediği kadar önemli: hangi makalenin haklı
 * olduğuna dair bir yargı YOK. Böyle bir yargı kanıta değil yoruma dayanırdı
 * ve Trace'in tek kuralı her cümlenin bir sayfaya bağlı olması. Ekran yalnızca
 * hizalıyor — aynı ölçüt, aynı terim — ve iki kaynağı da göstererek kararı
 * okuyucuya bırakıyor. Her sayının yanında geldiği sayfa yazıyor.
 */
export function CompareView({
  left,
  right,
  onBack,
  onOpen,
}: {
  left: ResearchProject;
  right: ResearchProject;
  onBack: () => void;
  onOpen: (project: ResearchProject) => void;
}) {
  const comparison = useMemo(() => compareProjects(left, right), [left, right]);
  const { left: a, right: b } = comparison;
  const differing = comparison.sharedTerms.filter((term) => !term.identical);
  /**
   * Eşleştirme adlara bakıyor: "BLEU" ile "BLEU". İki proje farklı dillerde
   * üretilmişse etiketler de farklı dillerde ve hiçbir şey eşleşmiyor. Bu bir
   * hata değil ama okuyucu "ortak hiçbir şey yok" diye okursa yanlış sonuca
   * varır; sebebi söylenmeli.
   */
  const crossLanguage = a.language !== b.language;

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
        <p className="landing-eyebrow"><span /> Side by side</p>
        <h1>Two papers, lined up.</h1>
        <p>
          Nothing here is a verdict. Trace aligns what each paper reports — the same benchmark, the
          same term — and shows both sources so you can judge. Every number carries the page it came from.
        </p>
      </section>

      <section className="compare-columns">
        {[a, b].map((side, index) => {
          const project = index === 0 ? left : right;
          return (
            <article className="compare-card" key={side.id}>
              <span className="compare-side">{index === 0 ? "A" : "B"}</span>
              <h2>{side.title}</h2>
              <p className="compare-meta">
                {side.authors.slice(0, 3).join(", ")}{side.authors.length > 3 ? " et al." : ""} · {side.year} · {side.venue}
              </p>
              <blockquote lang={side.language}>{side.thesis}</blockquote>
              <dl className="compare-facts">
                <div><dt>Claims</dt><dd>{side.health.claims.total}</dd></div>
                <div><dt>Verified</dt><dd>{side.health.claims.verified}</dd></div>
                <div><dt>Pages reached</dt><dd>{side.health.pages.cited.length}</dd></div>
                <div><dt>Depth</dt><dd>{side.depth}</dd></div>
              </dl>
              <div className="compare-mix">
                {(Object.keys(kindLabels) as Claim["kind"][]).map((kind) => (
                  <span key={kind}><i>{side.claimMix[kind]}</i>{kindLabels[kind]}</span>
                ))}
              </div>
              <button className="library-open" onClick={() => onOpen(project)}>Open this one</button>
            </article>
          );
        })}
      </section>

      {crossLanguage ? (
        <p className="compare-warning">
          These two projects were written in different languages ({a.language} and {b.language}).
          Metrics and terms are matched by name, so labels written in different languages will not
          line up — few matches here means the wording differs, not the papers.
        </p>
      ) : null}

      <section className="compare-block">
        <div className="block-title"><Gauge size={16} /> The same measurement in both</div>
        {comparison.sharedMetrics.length ? (
          <div className="compare-metrics">
            {comparison.sharedMetrics.map((metric) => <MetricRow metric={metric} key={metric.key} />)}
          </div>
        ) : (
          <p className="compare-empty">
            No metric appears in both papers under the same name and unit. That usually means they
            measure different things — not that they disagree.
          </p>
        )}
      </section>

      {differing.length ? (
        <section className="compare-block">
          <div className="block-title"><BookMarked size={16} /> The same term, defined differently</div>
          <p className="compare-note">
            Both papers use these words. The definitions are not identical, which is worth reading
            before treating a shared word as a shared idea.
          </p>
          <div className="compare-terms">
            {differing.map((term) => (
              <article key={term.term}>
                <h3>{term.term}</h3>
                <div>
                  <p><span>A</span>{term.left}</p>
                  <p><span>B</span>{term.right}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="compare-block">
        <div className="block-title"><TriangleAlert size={16} /> What each admits it cannot do</div>
        <div className="compare-lists">
          {[a, b].map((side, index) => (
            <div key={side.id}>
              <h3><span className="compare-side">{index === 0 ? "A" : "B"}</span> {side.title}</h3>
              <ol lang={side.language}>{side.limitations.map((item, position) => <li key={position}>{item}</li>)}</ol>
            </div>
          ))}
        </div>
      </section>

      <section className="compare-block">
        <div className="block-title"><ShieldCheck size={16} /> Vocabulary each one covers alone</div>
        <div className="compare-lists">
          <div>
            <h3><span className="compare-side">A</span> only</h3>
            <p className="compare-terms-inline">{comparison.onlyLeftTerms.join(" · ") || "—"}</p>
          </div>
          <div>
            <h3><span className="compare-side">B</span> only</h3>
            <p className="compare-terms-inline">{comparison.onlyRightTerms.join(" · ") || "—"}</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricRow({ metric }: { metric: SharedMetric }) {
  // Fark gösteriliyor ama "kazanan" gösterilmiyor: bir ölçütte büyük olanın
  // iyi olup olmadığı (BLEU'da evet, gecikmede hayır) makaleden okunacak bir
  // şey, projede kayıtlı bir şey değil.
  const difference = metric.difference ?? 0;
  // İki bağlam cümlesi aynıysa iki kez yazmak yalnızca gürültü.
  const sameContext = metric.left.context.trim() === metric.right.context.trim();
  return (
    <article className="compare-metric">
      <header>
        <strong>{metric.label}</strong>
        <span>{metric.unit}</span>
      </header>
      <div className="compare-metric-values">
        <div>
          <span className="compare-side">A</span>
          <b>{metric.left.displayValue}</b>
          <small>{metric.left.page ? `p. ${metric.left.page}` : "web"}</small>
        </div>
        <i>{formatDifference(difference)}</i>
        <div>
          <span className="compare-side">B</span>
          <b>{metric.right.displayValue}</b>
          <small>{metric.right.page ? `p. ${metric.right.page}` : "web"}</small>
        </div>
      </div>
      {sameContext ? (
        <p>{metric.left.context}</p>
      ) : (
        <>
          <p><span className="compare-side">A</span> {metric.left.context}</p>
          <p><span className="compare-side">B</span> {metric.right.context}</p>
        </>
      )}
    </article>
  );
}
