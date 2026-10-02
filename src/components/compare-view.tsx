"use client";

import { useMemo } from "react";
import { ArrowLeft, BookMarked, Gauge, ListChecks, ShieldCheck, TriangleAlert } from "lucide-react";
import { LanguageProvider, QuizView } from "@/visuals";
import { compareProjects, formatDifference, type SharedMetric } from "@/lib/compare-projects";
import { crossClaims, crossPaperQuestions } from "@/lib/cross-questions";
import type { Claim, ResearchProject } from "@/lib/schema";
import { useT, useUiLanguage } from "@/i18n/client";
import { StudioNav } from "./focus/studio-nav";

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
  const { language, t: messages } = useUiLanguage();
  const t = messages.paper.compare;
  const header = messages.paper.pageHeader;
  const kindLabels = messages.paper.claimKinds.short;
  const comparison = useMemo(() => compareProjects(left, right), [left, right]);
  const crossWords = messages.learning.words.crossQuestions;
  const questions = useMemo(() => crossPaperQuestions(left, right, crossWords), [left, right, crossWords]);
  const claims = useMemo(() => crossClaims(left, right), [left, right]);
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
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
      </section>

      <section className="compare-columns">
        {[a, b].map((side, index) => {
          const project = index === 0 ? left : right;
          return (
            <article className="compare-card" key={side.id}>
              <span className="compare-side">{index === 0 ? "A" : "B"}</span>
              <h2>{side.title}</h2>
              <p className="compare-meta">
                {side.authors.slice(0, 3).join(", ")}{side.authors.length > 3 ? t.etAl : ""} · {side.year} · {side.venue}
              </p>
              <blockquote lang={side.language}>{side.thesis}</blockquote>
              <dl className="compare-facts">
                <div><dt>{t.claims}</dt><dd>{side.health.claims.total}</dd></div>
                <div><dt>{t.verified}</dt><dd>{side.health.claims.verified}</dd></div>
                <div><dt>{t.pagesReached}</dt><dd>{side.health.pages.cited.length}</dd></div>
                <div><dt>{t.depth}</dt><dd>{t.depthValues[side.depth]}</dd></div>
              </dl>
              <div className="compare-mix">
                {(Object.keys(kindLabels) as Claim["kind"][]).map((kind) => (
                  <span key={kind}><i>{side.claimMix[kind]}</i>{kindLabels[kind]}</span>
                ))}
              </div>
              <button className="library-open" onClick={() => onOpen(project)}>{t.openThis}</button>
            </article>
          );
        })}
      </section>

      {crossLanguage ? (
        <p className="compare-warning">{t.crossLanguage(a.language, b.language)}</p>
      ) : null}

      <section className="compare-block">
        <div className="block-title"><Gauge size={16} /> {t.sameMeasurement}</div>
        {comparison.sharedMetrics.length ? (
          <div className="compare-metrics">
            {comparison.sharedMetrics.map((metric) => <MetricRow metric={metric} key={metric.key} />)}
          </div>
        ) : (
          <p className="compare-empty">{t.noSharedMetric}</p>
        )}
      </section>

      {differing.length ? (
        <section className="compare-block">
          <div className="block-title"><BookMarked size={16} /> {t.sameTerm}</div>
          <p className="compare-note">{t.sameTermNote}</p>
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

      {questions.length ? (
        <section className="compare-block compare-quiz" aria-label={t.quiz}>
          <div className="block-title"><ListChecks size={16} /> {t.quiz}</div>
          <p className="compare-note">{t.quizNote}</p>
          {/* Sağlayıcı olmadan testin düğmeleri hep İngilizce kalıyordu. */}
          <LanguageProvider language={crossLanguage ? undefined : a.language} ui={language}>
            <QuizView quiz={{ title: "", intro: "", questions }} claims={claims} />
          </LanguageProvider>
        </section>
      ) : null}

      <section className="compare-block">
        <div className="block-title"><TriangleAlert size={16} /> {t.admits}</div>
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
        <div className="block-title"><ShieldCheck size={16} /> {t.vocabulary}</div>
        <div className="compare-lists">
          <div>
            <h3>{t.onlyBefore}<span className="compare-side">A</span>{t.onlyAfter}</h3>
            <p className="compare-terms-inline">{comparison.onlyLeftTerms.join(" · ") || "—"}</p>
          </div>
          <div>
            <h3>{t.onlyBefore}<span className="compare-side">B</span>{t.onlyAfter}</h3>
            <p className="compare-terms-inline">{comparison.onlyRightTerms.join(" · ") || "—"}</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricRow({ metric }: { metric: SharedMetric }) {
  const messages = useT();
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
          <small>{metric.left.page ? messages.common.page(metric.left.page) : "web"}</small>
        </div>
        <i>{formatDifference(difference, messages.paper.compare.difference)}</i>
        <div>
          <span className="compare-side">B</span>
          <b>{metric.right.displayValue}</b>
          <small>{metric.right.page ? messages.common.page(metric.right.page) : "web"}</small>
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
