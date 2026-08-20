"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, BookOpen, ExternalLink } from "lucide-react";
import type { ResearchProject } from "@/lib/schema";
import { InteractiveRenderer, LanguageProvider, VisualRenderer, stringsFor } from "@/visuals";

type StoryViewProps = {
  project: ResearchProject;
  embedded?: boolean;
  onClaimSelect?: (claimId: string) => void;
};

export function StoryView({ project, embedded = false, onClaimSelect }: StoryViewProps) {
  const [activeId, setActiveId] = useState(project.story.sections[0]?.id ?? "");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const activeSection = useMemo(
    () => project.story.sections.find((section) => section.id === activeId) ?? project.story.sections[0],
    [activeId, project.story.sections],
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

  const activeIndex = Math.max(
    project.story.sections.findIndex((section) => section.id === activeId),
    0,
  );

  return (
    <LanguageProvider language={project.language}>
    <article
      className={`story-page ${embedded ? "is-embedded" : ""}`}
      style={{ "--story-accent": project.story.accent } as React.CSSProperties}
    >
      <div className="story-progress" aria-hidden="true">
        <span style={{ width: `${((activeIndex + 1) / project.story.sections.length) * 100}%` }} />
      </div>

      <header className="story-hero">
        <div className="story-masthead">
          <span className="story-mark"><BookOpen size={15} /> Trace story</span>
          <span>{project.story.readingTime}</span>
        </div>
        <div className="story-hero-copy">
          <p className="story-overline">{project.evidence.paper.year} · {project.evidence.paper.venue}</p>
          <h1>{project.story.title}</h1>
          <p className="story-dek">{project.story.dek}</p>
          <div className="story-authors">
            {project.evidence.paper.authors.slice(0, 4).join(", ")}
            {project.evidence.paper.authors.length > 4 && " ve diğerleri"}
          </div>
        </div>
        <button
          className="story-scroll-cue"
          onClick={() => sectionRefs.current[project.story.sections[0]?.id]?.scrollIntoView({ behavior: "smooth" })}
        >
          Hikâyeye başla <ArrowDown size={15} />
        </button>
      </header>

      <div className="story-body">
        <div className="story-copy-column">
          {project.story.sections.map((section) => (
            <section
              id={section.id}
              key={section.id}
              ref={(node) => { sectionRefs.current[section.id] = node; }}
              className={`story-section ${activeId === section.id ? "is-active" : ""}`}
            >
              <span className="story-index">{section.indexLabel}</span>
              <p className="story-kicker">{section.kicker}</p>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
              <div className="story-claim-links">
                {section.claimIds.map((claimId) => {
                  const claim = project.evidence.claims.find((item) => item.id === claimId);
                  const page = claim?.sourceRefs[0]?.page;
                  return (
                    <button key={claimId} onClick={() => onClaimSelect?.(claimId)}>
                      <span className={claim?.confidence === "verified" ? "verified-dot" : "review-dot"} />
                      Kaynak {page ? `· s. ${page}` : ""}
                    </button>
                  );
                })}
              </div>
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
          <nav className="story-section-dots" aria-label="Story bölümleri">
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

      {project.interactives?.length ? (
        <section className="story-practice">
          <p className="story-overline">{stringsFor(project.language).tryItHeading}</p>
          {project.interactives.map((interactive) => (
            <InteractiveRenderer interactive={interactive} key={interactive.id} />
          ))}
        </section>
      ) : null}

      <footer className="story-closing">
        <p className="story-overline">Son okuma</p>
        <h2>{project.story.closing.title}</h2>
        <p>{project.story.closing.body}</p>
        <div className="story-source-card">
          <div>
            <span>Birincil kaynak</span>
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

