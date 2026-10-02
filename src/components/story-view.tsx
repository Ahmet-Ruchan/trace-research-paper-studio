"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, BookOpen, ExternalLink } from "lucide-react";
import { elementId, parseDeepLink, scrollToDeepLink, sectionHash } from "@/lib/deep-link";
import { sectionMark } from "@/lib/reader-notes";
import { ResumeBar, useReadingTracker } from "./reading-position";
import { ListenButton, ReadAloudProvider } from "./read-aloud";
import { storySpeech } from "@/lib/read-aloud";
import type { ResearchProject } from "@/lib/schema";
import {
  FiguresView,
  InteractiveRenderer,
  LanguageProvider,
  PermalinkButton,
  SectionPrerequisites,
  TermParagraphs,
  VisualRenderer,
  figuresBySection,
  stringsFor,
} from "@/visuals";
import { sectionPrerequisites, termIndex } from "@/lib/term-index";
import { useUiLanguage } from "@/i18n/client";

type StoryViewProps = {
  project: ResearchProject;
  embedded?: boolean;
  onClaimSelect?: (claimId: string) => void;
};

export function StoryView({ project, embedded = false, onClaimSelect }: StoryViewProps) {
  const { language, t: messages } = useUiLanguage();
  const t = messages.paper.story;
  const [activeId, setActiveId] = useState(project.story.sections[0]?.id ?? "");
  const speech = useMemo(() => storySpeech(project), [project]);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const activeSection = useMemo(
    () => project.story.sections.find((section) => section.id === activeId) ?? project.story.sections[0],
    [activeId, project.story.sections],
  );
  /**
   * Şekiller anlattıkları paragrafın yanında duruyor. Eşleştirme iddialar
   * üzerinden: bir şekil ve bir bölüm aynı iddiaya dayanıyorsa aynı yere
   * aittir. Hiçbir bölümle eşleşmeyen şekil Lab'in genel bakışında kalır.
   */
  // Sözlük ve ön bilgi terimleri anlatının içinde açılıyor.
  const terms = useMemo(() => termIndex(project), [project]);
  const figuresBySectionId = useMemo(
    () => figuresBySection(project.figures, project.story.sections),
    [project.figures, project.story.sections],
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveId(visible.target.id);
      },
      { rootMargin: "-35% 0px -40% 0px", threshold: [0, 0.25, 0.6] },
    );

    Object.values(sectionRefs.current).forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [project.story.sections]);

  /**
   * Bir bölüm bağlantısıyla gelindiyse oraya git. Tarayıcının kendi çapa
   * atlaması işe yaramıyor: hedef öğe sayfa yüklendiğinde henüz yok, React
   * onu sonra çiziyor.
   */
  useEffect(() => {
    const goToHash = () => {
      const link = parseDeepLink(window.location.hash);
      if (link?.kind === "section") scrollToDeepLink(link);
    };
    goToHash();
    // Sayfa içindeki bir bölüm bağlantısına tıklamak belgeyi yeniden
    // yüklemiyor; dinlemezsek yalnızca ilk açılış çalışırdı.
    window.addEventListener("hashchange", goToHash);
    return () => window.removeEventListener("hashchange", goToHash);
  }, []);

  // Kaldığın yer: yalnızca stüdyonun önizlemesinde (`reading-position.tsx`).
  const storySections = useMemo(() => project.story.sections.map((section) => ({ id: section.id, title: section.title })), [project.story.sections]);
  useReadingTracker(project.id, "story", storySections, embedded);

  const activeIndex = Math.max(
    project.story.sections.findIndex((section) => section.id === activeId),
    0,
  );

  return (
    <LanguageProvider language={project.language} ui={language}>
    <article
      className={`story-page ${embedded ? "is-embedded" : ""}`}
      style={{ "--story-accent": project.story.accent } as React.CSSProperties}
    >
      <div className="story-progress" aria-hidden="true">
        <span style={{ width: `${((activeIndex + 1) / project.story.sections.length) * 100}%` }} />
      </div>

      <header className="story-hero">
        <div className="story-masthead">
          <span className="story-mark"><BookOpen size={15} /> {t.mark}</span>
          <span>{project.story.readingTime}</span>
        </div>
        <div className="story-hero-copy">
          <p className="story-overline" lang={project.language}>{project.evidence.paper.year} · {project.evidence.paper.venue}</p>
          <h1>{project.story.title}</h1>
          <p className="story-dek">{project.story.dek}</p>
          <div className="story-authors">
            {project.evidence.paper.authors.slice(0, 4).join(", ")}
            {project.evidence.paper.authors.length > 4 && t.etAl}
          </div>
        </div>
        <button
          className="story-scroll-cue"
          onClick={() => sectionRefs.current[project.story.sections[0]?.id]?.scrollIntoView({ behavior: "smooth" })}
        >
          {t.start} <ArrowDown size={15} />
        </button>
      </header>

      {embedded ? <ResumeBar projectId={project.id} place="story" /> : null}
      <ReadAloudProvider place="story" language={project.language} sections={speech}>
      <div className="story-body">
        <div className="story-copy-column">
          {project.story.sections.map((section) => (
            <section
              id={section.id}
              key={section.id}
              ref={(node) => { sectionRefs.current[section.id] = node; }}
              className={`story-section ${activeId === section.id ? "is-active" : ""}`}
              data-note-section={sectionMark("story", section.id)}
            >
              <span className="story-index">{section.indexLabel}</span>
              <p className="story-kicker" lang={project.language}>{section.kicker}</p>
              <h2 id={elementId({ kind: "section", id: section.id })}>
                {section.title}
                <PermalinkButton hash={sectionHash(section.id)} />
              </h2>
              {embedded ? <ListenButton sectionId={section.id} title={section.title} /> : null}
              <SectionPrerequisites concepts={sectionPrerequisites(section, terms, project.language)} />
              <TermParagraphs paragraphs={[section.body]} entries={terms} />
              <div className="story-claim-links">
                {section.claimIds.map((claimId) => {
                  const claim = project.evidence.claims.find((item) => item.id === claimId);
                  const page = claim?.sourceRefs[0]?.page;
                  return (
                    <button key={claimId} onClick={() => onClaimSelect?.(claimId)}>
                      <span className={claim?.confidence === "verified" ? "verified-dot" : "review-dot"} />
                      {t.source(page)}
                    </button>
                  );
                })}
              </div>
              {figuresBySectionId.has(section.id) ? (
                <FiguresView figures={figuresBySectionId.get(section.id)!} />
              ) : null}
              <div className="story-mobile-visual">
                <VisualRenderer visual={section.visual} accent={project.story.accent} />
              </div>
            </section>
          ))}
        </div>

        <aside className="story-sticky-visual" aria-live="polite">
          {activeSection && (
            <VisualRenderer
              key={activeSection.id}
              visual={activeSection.visual}
              accent={project.story.accent}
              active
            />
          )}
          <nav className="story-section-dots" aria-label={t.sectionsAria}>
            {project.story.sections.map((section) => (
              <button
                key={section.id}
                className={activeId === section.id ? "active" : ""}
                aria-label={`${section.indexLabel}: ${section.title}`}
                onClick={() => sectionRefs.current[section.id]?.scrollIntoView({ behavior: "smooth" })}
              />
            ))}
          </nav>
        </aside>
      </div>
      </ReadAloudProvider>

      {project.interactives?.length ? (
        <section className="story-practice">
          <p className="story-overline">{stringsFor(project.language, language).tryItHeading}</p>
          {project.interactives.map((interactive) => (
            <InteractiveRenderer interactive={interactive} key={interactive.id} />
          ))}
        </section>
      ) : null}

      <footer className="story-closing">
        <p className="story-overline">{t.closing}</p>
        <h2>{project.story.closing.title}</h2>
        <p>{project.story.closing.body}</p>
        <div className="story-source-card">
          <div>
            <span>{t.primarySource}</span>
            <strong>{project.evidence.paper.title}</strong>
          </div>
          {project.evidence.paper.doi && (
            <a
              href={`https://doi.org/${project.evidence.paper.doi.replace("https://doi.org/", "")}`}
              target="_blank"
              rel="noreferrer"
            >
              DOI <ExternalLink size={14} />
            </a>
          )}
        </div>
      </footer>
    </article>
    </LanguageProvider>
  );
}

