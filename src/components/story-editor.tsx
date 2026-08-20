"use client";

import { useMemo, useState } from "react";
import { Eye, GripVertical, Link2, PencilLine } from "lucide-react";
import type { ResearchProject, StorySection } from "@/lib/schema";
import { VisualRenderer } from "./visual-renderer";
import { EvidenceDrawer } from "./evidence-drawer";

type StoryEditorProps = {
  project: ResearchProject;
  fileUrl?: string;
  onProjectChange: (project: ResearchProject) => void;
  onPreview: () => void;
};

export function StoryEditor({ project, fileUrl, onProjectChange, onPreview }: StoryEditorProps) {
  const [selectedId, setSelectedId] = useState(project.story.sections[0]?.id ?? "");
  const [claimId, setClaimId] = useState<string | undefined>();
  const selected = useMemo(
    () => project.story.sections.find((section) => section.id === selectedId),
    [project.story.sections, selectedId],
  );
  const claim = project.evidence.claims.find((item) => item.id === claimId);

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

  return (
    <div className="editor-layout">
      <aside className="story-outline">
        <div className="outline-header">
          <span>Story outline</span>
          <strong>{project.story.sections.length} sections</strong>
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
          <Eye size={15} /> Tam ekran preview
        </button>
      </aside>

      <main className="story-editor-main">
        {selected && (
          <>
            <div className="editor-section-meta">
              <span><PencilLine size={14} /> Section {selected.indexLabel}</span>
              <span>{selected.visual.type} visual</span>
            </div>
            <div className="editor-fields">
              <label>
                Kicker
                <input value={selected.kicker} onChange={(event) => updateSection({ kicker: event.target.value })} />
              </label>
              <label>
                Title
                <textarea
                  className="title-input"
                  value={selected.title}
                  onChange={(event) => updateSection({ title: event.target.value })}
                />
              </label>
              <label>
                Narrative
                <textarea
                  className="body-input"
                  value={selected.body}
                  onChange={(event) => updateSection({ body: event.target.value })}
                />
              </label>
            </div>
            <div className="editor-evidence-links">
              <span><Link2 size={14} /> Linked claims</span>
              <div>
                {selected.claimIds.map((id) => {
                  const linked = project.evidence.claims.find((item) => item.id === id);
                  return (
                    <button key={id} onClick={() => setClaimId(id)}>
                      {linked?.sourceRefs[0]?.page ? `s. ${linked.sourceRefs[0].page}` : "web"} · {linked?.statement.slice(0, 72)}
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
          <span>Renderer output</span>
          <p>The visual is generated from validated StorySpec data; no free-form model code runs here.</p>
        </div>
      </aside>

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
  );
}

