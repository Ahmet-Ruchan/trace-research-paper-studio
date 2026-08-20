import { useEffect, useMemo, useRef, useState } from "react";
import type { Claim, ResearchProject } from "@/lib/schema";
import {
  ApplicationGuideView,
  LanguageProvider,
  stringsFor,
  useStrings,
  DerivationView,
  InteractiveRenderer,
  MathText,
  PrimerView,
  QuizView,
  VisualRenderer,
} from "@/visuals";

type Tab = "lab" | "story" | "practice" | "technical";

/**
 * Bu sayfa ile ana uygulama arasındaki köprü. `deliver` teslim anında doldurur:
 *   `url`       — stüdyo ayakta; düğme doğrudan oraya götürür ve proje
 *                 kendiliğinden kütüphaneye düşer.
 *   `command`   — stüdyo ayakta değil; kullanıcıya onu başlatan komut gösterilir.
 *   ikisi de yok — paylaşılan hikâye çıktısı; düğme hiç çizilmez.
 *
 * Ayakta olup olmadığını sayfa İÇİNDEN yoklamıyoruz: bu dosya paylaşılabilir
 * ve sıkı bir CSP ile geliyor; ona loopback'e istek atma yetkisi vermek,
 * paylaşılan bir dosyanın alıcının yerel portlarını taramasına izin vermek olurdu.
 */
export type StudioHandoff = { url?: string; command?: string; directory?: string };

export function ViewerShell({
  project,
  initialTab,
  studio = {},
}: {
  project: ResearchProject;
  initialTab: Tab;
  studio?: StudioHandoff;
}) {
  const t = stringsFor(project.language);
  const tabLabels: Record<Tab, string> = {
    lab: t.tabLab,
    story: t.tabStory,
    practice: t.tabPractice,
    technical: t.tabTechnical,
  };
  const hasPractice = Boolean(
    project.primer || project.derivations?.length || project.interactives?.length || project.quiz || project.applicationGuide,
  );
  const tabs: Tab[] = ["lab", "story", ...(hasPractice ? (["practice"] as Tab[]) : []), ...(project.technicalAppendix ? (["technical"] as Tab[]) : [])];
  const [tab, setTab] = useState<Tab>(tabs.includes(initialTab) ? initialTab : "lab");
  const [studioOpen, setStudioOpen] = useState(false);

  useEffect(() => {
    // Arayüz İngilizce; kök `lang` de öyle. Makale metninin dili tek tek
    // içerik öğelerinde işaretlenir, kökte değil — kökü Türkçeye çekmek
    // İngilizce başlıkları "TECHNİCAL" gibi bozardı.
    document.documentElement.lang = "en";
    document.title = `${project.story.title} · Trace`;
    const accent = /^#[0-9a-f]{6}$/i.test(project.story.accent) ? project.story.accent : "#e75b37";
    document.documentElement.style.setProperty("--accent", accent);
  }, [project]);

  return (
    <LanguageProvider language={project.language}>
    <div className="viewer-shell">
      <nav className="viewer-topbar">
        <div className="viewer-brand">
          <i />
          Trace
        </div>
        <span className="viewer-local">{t.localStudio}</span>
        <div className="viewer-tabs">
          {tabs.map((item) => (
            <button
              key={item}
              type="button"
              className={item === tab ? "is-active" : ""}
              onClick={() => setTab(item)}
            >
              {tabLabels[item]}
            </button>
          ))}
        </div>
        <div className="viewer-actions">
          {studio.url ? (
            <a className="viewer-studio" href={studio.url}>
              {t.openInStudio} →
            </a>
          ) : studio.command ? (
            <button type="button" className="viewer-studio" onClick={() => setStudioOpen(true)}>
              {t.openInStudio} →
            </button>
          ) : null}
          <a className="viewer-download" download href={`./${encodeURIComponent(project.id)}.trace.json`}>
            Trace JSON ↓
          </a>
        </div>
      </nav>
      {studioOpen && <StudioPanel studio={studio} onClose={() => setStudioOpen(false)} />}

      <main className="viewer-main">
        {tab === "lab" ? <LabTab project={project} /> : null}
        {tab === "story" ? <StoryTab project={project} /> : null}
        {tab === "practice" ? <PracticeTab project={project} /> : null}
        {tab === "technical" ? <TechnicalTab project={project} /> : null}
      </main>
    </div>
    </LanguageProvider>
  );
}

/**
 * Stüdyo ayakta değilken çıkan panel. Kullanıcıyı boş bir bağlantı hatasına
 * göndermek yerine onu ayağa kaldıran tam komutu veriyor; JSON da zaten
 * indirilebilir durumda, yani stüdyo hiç kurulmasa bile iş kaybolmuyor.
 */
function StudioPanel({ studio, onClose }: { studio: StudioHandoff; onClose: () => void }) {
  const t = useStrings();
  return (
    <div className="viewer-studio-overlay" role="dialog" aria-modal="true" aria-label={t.openInStudio} onClick={onClose}>
      <div className="viewer-studio-panel" onClick={(event) => event.stopPropagation()}>
        <h2>{t.studioOfflineTitle}</h2>
        <p>{t.studioOfflineBody}</p>
        <pre>{studio.command}</pre>
        <p className="viewer-studio-note">{t.studioOfflineNote}</p>
        <div className="viewer-studio-buttons">
          <a href="http://127.0.0.1:3000/">{t.studioTryAnyway}</a>
          <button type="button" onClick={onClose}>{t.close}</button>
        </div>
      </div>
    </div>
  );
}

function ClaimRefs({ ids, claims }: { ids: readonly string[]; claims: Claim[] }) {
  const t = useStrings();
  const linked = ids.map((id) => claims.find((claim) => claim.id === id)).filter((claim): claim is Claim => Boolean(claim));
  if (!linked.length) return null;
  return (
    <>
      {linked.map((claim) => {
        const ref = claim.sourceRefs[0];
        return (
          <details className="evidence-note" key={claim.id}>
            <summary>{t.sourceLabel} · {ref?.page ? t.page(ref.page) : ref?.locator ?? t.sourceFallback}</summary>
            <p>{claim.statement}</p>
            <blockquote>{ref?.excerpt}</blockquote>
          </details>
        );
      })}
    </>
  );
}

function LabTab({ project }: { project: ResearchProject }) {
  const t = useStrings();
  const { evidence } = project;
  return (
    <div className="viewer-page">
      <header className="viewer-page-head">
        <h1>{evidence.paper.title}</h1>
        <p className="viewer-byline">
          {evidence.paper.authors.join(", ")} · {evidence.paper.year} · {evidence.paper.venue}
        </p>
      </header>

      <section className="viewer-block">
        <h2>{t.thesis}</h2>
        <p className="viewer-lead">{evidence.thesis}</p>
        <h2>{t.plainSummary}</h2>
        <p>{evidence.plainSummary}</p>
        <h2>{t.researchQuestion}</h2>
        <p>{evidence.researchQuestion}</p>
      </section>

      <section className="viewer-block">
        <h2>{t.methodsFindingsLimits}</h2>
        <div className="viewer-tri">
          <article>
            <span className="viewer-eyebrow">{t.methods}</span>
            <ul>{evidence.methods.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </article>
          <article>
            <span className="viewer-eyebrow">{t.findings}</span>
            <ul>{evidence.findings.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </article>
          <article>
            <span className="viewer-eyebrow">{t.limitations}</span>
            <ul>{evidence.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </article>
        </div>
      </section>

      {evidence.metrics.length ? (
        <section className="viewer-block">
          <h2>{t.metrics}</h2>
          <div className="viewer-metrics">
            {evidence.metrics.map((metric) => (
              <article key={metric.id}>
                <strong>{metric.displayValue}</strong>
                <span>{metric.label}</span>
                <small>{metric.context}</small>
                <details className="evidence-note">
                  <summary>{t.sourceLabel}{metric.sourceRef.page ? ` · ${t.page(metric.sourceRef.page)}` : ""}</summary>
                  <blockquote>{metric.sourceRef.excerpt}</blockquote>
                </details>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="viewer-block">
        <h2>{t.claims}</h2>
        <div className="viewer-claims">
          {evidence.claims.map((claim) => (
            <article key={claim.id} className={claim.confidence === "needs-review" ? "is-review" : ""}>
              <span className="viewer-claim-kind">{claim.kind}</span>
              <p>{claim.statement}</p>
              {claim.sourceRefs.map((ref, index) => (
                <details className="evidence-note" key={index}>
                  <summary>{t.sourceLabel}{ref.page ? ` · ${t.page(ref.page)}` : ""}</summary>
                  <blockquote>{ref.excerpt}</blockquote>
                </details>
              ))}
            </article>
          ))}
        </div>
      </section>

      {project.deepReport ? (
        <section className="viewer-block">
          <h2>{project.deepReport.title}</h2>
          <p className="viewer-lead">{project.deepReport.dek}</p>
          {project.deepReport.sections.map((section) => (
            <article className="viewer-report-section" key={section.id}>
              <span className="viewer-eyebrow">{section.kind}</span>
              <h3>{section.title}</h3>
              <p className="viewer-summary">{section.summary}</p>
              {section.analysis.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              <ClaimRefs ids={section.claimIds} claims={evidence.claims} />
            </article>
          ))}
          <h3>{t.openQuestions}</h3>
          <ol className="viewer-questions">
            {project.deepReport.openQuestions.map((question, index) => <li key={index}>{question}</li>)}
          </ol>
        </section>
      ) : null}

      {evidence.glossary.length ? (
        <section className="viewer-block">
          <h2>{t.glossary}</h2>
          <dl className="viewer-glossary">
            {evidence.glossary.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>{item.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function StoryTab({ project }: { project: ResearchProject }) {
  const t = useStrings();
  const { story, evidence } = project;
  const [activeId, setActiveId] = useState(story.sections[0]?.id);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nodes = containerRef.current?.querySelectorAll("[data-section]");
    if (!nodes?.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.section;
          if (entry.isIntersecting && id) setActiveId(id);
        }
      },
      { rootMargin: "-35% 0px -40% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [story.sections.length]);

  const active = story.sections.find((section) => section.id === activeId) ?? story.sections[0];
  const interactives = project.interactives ?? [];

  return (
    <div className="viewer-story" ref={containerRef}>
      <header className="viewer-story-head">
        <h1>{story.title}</h1>
        <p>{story.dek}</p>
        <small>{story.readingTime}</small>
      </header>

      <div className="viewer-story-grid">
        <div className="viewer-story-copy">
          {story.sections.map((section) => (
            <section className="viewer-story-section" data-section={section.id} key={section.id}>
              <span className="viewer-eyebrow">
                {section.indexLabel} · {section.kicker}
              </span>
              <h2>{section.title}</h2>
              {section.body.split("\n\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              <ClaimRefs ids={section.claimIds} claims={evidence.claims} />
              <div className="viewer-mobile-visual">
                <VisualRenderer visual={section.visual} accent={story.accent} />
              </div>
            </section>
          ))}
        </div>
        <aside className="viewer-story-sticky">
          {active ? <VisualRenderer visual={active.visual} accent={story.accent} /> : null}
        </aside>
      </div>

      {interactives.length ? (
        <section className="viewer-block">
          <h2>{t.tryItHeading}</h2>
          {interactives.map((interactive) => (
            <InteractiveRenderer interactive={interactive} key={interactive.id} />
          ))}
        </section>
      ) : null}

      <footer className="viewer-story-closing">
        <h2>{story.closing.title}</h2>
        <p>{story.closing.body}</p>
      </footer>
    </div>
  );
}

function PracticeTab({ project }: { project: ResearchProject }) {
  const t = useStrings();
  return (
    <div className="viewer-page">
      {project.primer ? (
        <section className="viewer-block">
          <PrimerView primer={project.primer} />
        </section>
      ) : null}

      {project.derivations?.length ? (
        <section className="viewer-block">
          <h2>{t.derivationsHeading}</h2>
          {project.derivations.map((derivation) => (
            <DerivationView derivation={derivation} key={derivation.id} />
          ))}
        </section>
      ) : null}

      {project.interactives?.length ? (
        <section className="viewer-block">
          <h2>{t.interactivesHeading}</h2>
          {project.interactives.map((interactive) => (
            <InteractiveRenderer interactive={interactive} key={interactive.id} />
          ))}
        </section>
      ) : null}

      {project.quiz ? (
        <section className="viewer-block">
          <QuizView quiz={project.quiz} claims={project.evidence.claims} />
        </section>
      ) : null}

      {project.applicationGuide ? (
        <section className="viewer-block">
          <ApplicationGuideView guide={project.applicationGuide} />
        </section>
      ) : null}
    </div>
  );
}

function TechnicalTab({ project }: { project: ResearchProject }) {
  const t = useStrings();
  const appendix = project.technicalAppendix;
  const derivationByEquation = useMemo(
    () =>
      new Map(
        (project.derivations ?? [])
          .filter((item) => item.equationId)
          .map((item) => [item.equationId!, item]),
      ),
    [project.derivations],
  );
  if (!appendix) return null;

  return (
    <div className="viewer-page">
      <header className="viewer-page-head">
        <h1>{appendix.title}</h1>
        <p className="viewer-lead">{appendix.overview}</p>
      </header>

      {appendix.equations.length ? (
        <section className="viewer-block">
          <h2>{t.equations}</h2>
          {appendix.equations.map((equation) => (
            <article className="viewer-equation" key={equation.id}>
              <h3>{equation.label}</h3>
              <MathText latex={equation.latex} plain={equation.expression} display />
              <p>{equation.explanation}</p>
              <dl className="viewer-variables">
                {equation.variables.map((variable) => (
                  <div key={variable.symbol}>
                    <dt>{variable.symbol}</dt>
                    <dd>{variable.meaning}</dd>
                  </div>
                ))}
              </dl>
              <ClaimRefs ids={equation.claimIds} claims={project.evidence.claims} />
              {derivationByEquation.has(equation.id) ? (
                <DerivationView derivation={derivationByEquation.get(equation.id)!} />
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      <section className="viewer-block">
        <h2>{t.algorithmSteps}</h2>
        <ol className="viewer-algorithm">
          {appendix.algorithmSteps.map((step, index) => (
            <li key={index}>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      {appendix.codeSketches.length ? (
        <section className="viewer-block">
          <h2>{t.codeSketches}</h2>
          {appendix.codeSketches.map((sketch, index) => (
            <article key={index}>
              <h3>{sketch.title}</h3>
              <pre className="guide-code">
                <code>{sketch.code}</code>
              </pre>
              <p>{sketch.explanation}</p>
            </article>
          ))}
        </section>
      ) : null}

      {appendix.complexity.length ? (
        <section className="viewer-block">
          <h2>{t.complexity}</h2>
          <div className="guide-scroll">
            <table className="guide-table">
              <thead>
                <tr>
                  <th scope="col">{t.operation}</th>
                  <th scope="col">{t.cost}</th>
                  <th scope="col">{t.context}</th>
                </tr>
              </thead>
              <tbody>
                {appendix.complexity.map((item, index) => (
                  <tr key={index}>
                    <th scope="row">{item.operation}</th>
                    <td><code>{item.cost}</code></td>
                    <td>{item.context}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="viewer-block">
        <h2>{t.implementationNotes}</h2>
        <ul className="viewer-notes">
          {appendix.implementationNotes.map((note, index) => <li key={index}>{note}</li>)}
        </ul>
      </section>
    </div>
  );
}
