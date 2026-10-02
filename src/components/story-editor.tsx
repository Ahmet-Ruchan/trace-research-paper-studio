"use client";

import { useMemo, useState } from "react";
import { Eye, GripVertical, LayoutTemplate, Link2, PencilLine, RefreshCw } from "lucide-react";
import type { RevisionReason } from "@/lib/project-revisions";
import type { ResearchProject, StorySection } from "@/lib/schema";
import { LanguageProvider } from "@/visuals";
import { VisualRenderer } from "./visual-renderer";
import { EvidenceDrawer } from "./evidence-drawer";
import { useSectionRegeneration } from "./section-regenerator";
import { TemplateDialog } from "./template-dialog";
import { useUiLanguage } from "@/i18n/client";

type StoryEditorProps = {
  project: ResearchProject;
  fileUrl?: string;
  onProjectChange: (project: ResearchProject, reason?: RevisionReason) => void;
  onPreview: () => void;
};

export function StoryEditor({ project, fileUrl, onProjectChange, onPreview }: StoryEditorProps) {
  const { language, t: messages } = useUiLanguage();
  const t = messages.paper.storyEditor;
  const [selectedId, setSelectedId] = useState(project.story.sections[0]?.id ?? "");
  const [claimId, setClaimId] = useState<string | undefined>();
  const selected = useMemo(
    () => project.story.sections.find((section) => section.id === selectedId),
    [project.story.sections, selectedId],
  );
  const claim = project.evidence.claims.find((item) => item.id === claimId);
  const regeneration = useSectionRegeneration(project, onProjectChange);
  const [templateOpen, setTemplateOpen] = useState(false);

  function updateSection(patch: Partial<StorySection>) {
    const now = new Date().toISOString();
    onProjectChange({
      ...project,
      updatedAt: now,
      story: {
        ...project.story,
        sections: project.story.sections.map((section) =>
          section.id === selectedId ? { ...section, ...patch } : section,
        ),
      },
    });
  }

  // Görseller dili bağlamdan okuyor; sağlayıcı olmadan Türkçeye düşüp
  // İngilizce bir projede "DESIGN" yerine "DESİGN" yazıyordu.
  return (
    <LanguageProvider language={project.language} ui={language}>
    <div className="editor-layout">
      <aside className="story-outline">
        <div className="outline-header">
          <span>{t.outline}</span>
          <strong>{t.sections(project.story.sections.length)}</strong>
        </div>
        {project.story.sections.map((section) => (
          <button
            key={section.id}
            className={selectedId === section.id ? "active" : ""}
            onClick={() => setSelectedId(section.id)}
          >
            <GripVertical size={15} />
            <span>{section.indexLabel}</span>
            <p>{section.title}</p>
          </button>
        ))}
        <button className="preview-shortcut" onClick={onPreview}>
          <Eye size={15} /> {t.preview}
        </button>
        <button className="preview-shortcut template-shortcut" onClick={() => setTemplateOpen(true)}>
          <LayoutTemplate size={15} /> {t.saveTemplate}
        </button>
      </aside>

      <main className="story-editor-main">
        {selected && (
          <>
            <div className="editor-section-meta">
              <span><PencilLine size={14} /> {t.section(selected.indexLabel)}</span>
              <span>{t.visual(selected.visual.type)}</span>
              <button
                className="regen-trigger"
                onClick={() => regeneration.open({ kind: "story", sectionId: selected.id })}
                title={messages.paper.lab.regenerateTitle("section")}
              >
                <RefreshCw size={13} /> {messages.paper.lab.regenerate}
              </button>
            </div>
            {regeneration.undoBar}
            <div className="editor-fields">
              <label>
                {t.kicker}
                <input value={selected.kicker} onChange={(event) => updateSection({ kicker: event.target.value })} />
              </label>
              <label>
                {t.title}
                <textarea
                  className="title-input"
                  value={selected.title}
                  onChange={(event) => updateSection({ title: event.target.value })}
                />
              </label>
              <label>
                {t.narrative}
                <textarea
                  className="body-input"
                  value={selected.body}
                  onChange={(event) => updateSection({ body: event.target.value })}
                />
              </label>
            </div>
            <div className="editor-evidence-links">
              <span><Link2 size={14} /> {t.linkedClaims}</span>
              <div>
                {selected.claimIds.map((id) => {
                  const linked = project.evidence.claims.find((item) => item.id === id);
                  return (
                    <button key={id} onClick={() => setClaimId(id)}>
                      {linked?.sourceRefs[0]?.page ? messages.common.page(linked.sourceRefs[0].page) : "web"} · {linked?.statement.slice(0, 72)}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>

      <aside className="editor-preview">
        {selected && <VisualRenderer visual={selected.visual} accent={project.story.accent} />}
        <div className="preview-note">
          <span>{t.rendererOutput}</span>
          <p>{t.rendererNote}</p>
        </div>
      </aside>

      {regeneration.panel}
      {templateOpen && <TemplateDialog project={project} onClose={() => setTemplateOpen(false)} />}

      {claim && (
        <div className="drawer-overlay" onClick={() => setClaimId(undefined)}>
          <div onClick={(event) => event.stopPropagation()}>
            <EvidenceDrawer
              claim={claim}
              evidence={project.evidence}
              fileUrl={fileUrl}
              onClose={() => setClaimId(undefined)}
            />
          </div>
        </div>
      )}
    </div>
    </LanguageProvider>
  );
}

