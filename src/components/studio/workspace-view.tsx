"use client";

import { useState } from "react";
import { BookOpen, Download, FileJson, FlaskConical, Globe, History, Home, LayoutTemplate, Network, Plus, Share2 } from "lucide-react";
import { useUiLanguage } from "@/i18n/client";
import { buildStandaloneStory } from "@/lib/export-story";
import { exportDefinitions, exportMenuText } from "@/lib/exports";
import type { RevisionReason } from "@/lib/project-revisions";
import type { ResearchProject } from "@/lib/schema";
import { stringsFor } from "@/visuals";
import { CitationPanel } from "../citation-panel";
import { DisplayControl } from "../display-control";
import { EvidenceDrawer } from "../evidence-drawer";
import { StudioNav } from "../focus/studio-nav";
import { HistoryPanel } from "../history-panel";
import { LabView } from "../lab-view";
import { PublishPanel } from "../publish-panel";
import { NoteHighlights, ReaderNotesProvider, SelectionNoteBar } from "../reader-notes";
import { StoryEditor } from "../story-editor";
import { StoryView } from "../story-view";
import { download, projectSlug } from "./download";
import type { LabJump, WorkspaceMode, WorkspacePanel } from "./screens";

/**
 * Makale ekranı: başlık (kipler, eylemler, dışa aktarım), Lab, hikâye
 * düzenleyicisi ve önizleme, açık panel ve önizlemedeki kanıt çekmecesi.
 * Durum `app-shell.tsx`'te; komut paleti de aynı kipleri ve panelleri açıyor.
 */
export function WorkspaceView({
  project,
  library,
  mode,
  onMode,
  fileUrl,
  onPaperFile,
  selectedClaimId,
  onClaimSelect,
  warnings,
  onDismissWarnings,
  labJump,
  panel,
  onPanel,
  onProjectChange,
  onRestore,
  onHome,
  onLibrary,
  onNew,
  onReview,
  onAnalysePaper,
}: {
  project: ResearchProject;
  library: ResearchProject[];
  mode: WorkspaceMode;
  onMode: (mode: WorkspaceMode) => void;
  fileUrl?: string;
  onPaperFile: (file: File) => void;
  selectedClaimId?: string;
  onClaimSelect: (claimId: string | undefined) => void;
  warnings: string[];
  onDismissWarnings: () => void;
  labJump?: LabJump;
  panel?: WorkspacePanel;
  onPanel: (panel: WorkspacePanel | undefined) => void;
  onProjectChange: (next: ResearchProject, reason?: RevisionReason) => void;
  /** Geçmişten bir sürüm: kaydedilip ekrana konuyor. */
  onRestore: (restored: ResearchProject) => Promise<void>;
  onHome: () => void;
  onLibrary: () => void;
  onNew: () => void;
  onReview: () => void;
  onAnalysePaper: (node: { identifier: string; title: string }) => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const { language, t: messages } = useUiLanguage();
  const t = messages.studio.workspace;
  // Görsellerin etiketleri arayüzün dilinde; `locale` makalenin dilinde kalıyor.
  const strings = stringsFor(project.language, language);
  const selectedClaim = project.evidence.claims.find((claim) => claim.id === selectedClaimId);
  // Notlardan hikâyedeki bir bölüme: önizleme açılıp bölüme kaydırılıyor.
  const showStorySection = (sectionId: string) => {
    onMode("preview");
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ block: "start" }), 80);
  };
  const slug = projectSlug(project);

  return (
    <ReaderNotesProvider key={project.id} projectId={project.id}>
    <div className="workspace-shell" style={{ "--accent": project.story.accent } as React.CSSProperties}>
      <NoteHighlights />
      <SelectionNoteBar />
      <header className="workspace-header">
        <button className="workspace-brand" onClick={onHome}><span className="brand-glyph">t</span><span><strong>trace</strong><small>{messages.studio.brand.tagline}</small></span></button>
        <div className="project-identity"><span>{t.currentPaper}</span><strong>{project.evidence.paper.title}</strong></div>
        <nav className="mode-tabs" aria-label={t.modes}>
          <button className={mode === "lab" ? "active" : ""} title={t.lab} onClick={() => onMode("lab")}><FlaskConical size={15} /> {t.lab}</button>
          <button className={mode === "story" ? "active" : ""} title={t.story} onClick={() => onMode("story")}><LayoutTemplate size={15} /> {t.story}</button>
          <button className={mode === "preview" ? "active" : ""} title={t.preview} onClick={() => onMode("preview")}><Share2 size={15} /> {t.preview}</button>
        </nav>
        <div className="workspace-actions">
          <button title={strings.home} aria-label={strings.home} onClick={onHome}><Home size={16} /><span>{strings.home}</span></button>
          <button title={strings.library} aria-label={strings.library} onClick={onLibrary}><BookOpen size={16} /><span>{strings.library}</span></button>
          <button title={t.downloadJson} aria-label="JSON" onClick={() => download(`${slug}.trace.json`, JSON.stringify(project, null, 2), "application/json")}><FileJson size={16} /><span>JSON</span></button>
          <button title={t.citationsTitle} aria-label={t.citations} onClick={() => onPanel("citations")}><Network size={16} /><span>{t.citations}</span></button>
          <button title={t.publishTitle} aria-label={t.publish} onClick={() => onPanel("publish")}><Globe size={16} /><span>{t.publish}</span></button>
          <div className="export-menu">
            <button className="export-button" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((open) => !open)}><Download size={16} /> {t.export}</button>
            {exportOpen && (
              <>
                <button className="export-menu-backdrop" aria-label={t.closeExportMenu} onClick={() => setExportOpen(false)} />
                <div className="export-menu-list" role="menu">
                  <button role="menuitem" onClick={() => { setExportOpen(false); download(`${slug}.html`, buildStandaloneStory(project), "text/html"); }}>
                    <strong>{t.interactiveSite}</strong><small>{t.interactiveSiteDetail}</small>
                  </button>
                  {exportDefinitions.map((definition) => {
                    const text = exportMenuText(definition, project, messages.paper.exportMenu);
                    const reason = text.unavailable;
                    return (
                      <button
                        role="menuitem"
                        key={definition.format}
                        disabled={Boolean(reason)}
                        onClick={() => { setExportOpen(false); download(`${slug}.${definition.extension}`, definition.build(project), definition.mime); }}
                      >
                        <strong>{text.label}</strong><small>{reason ?? text.description}</small>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <DisplayControl />
          <button className="icon-button" title={t.newPaper} onClick={onNew}><Plus size={17} /></button>
          <button className="icon-button" title={t.versionHistory} aria-label={t.versionHistory} onClick={() => onPanel("history")}><History size={17} /></button>
          <StudioNav />
        </div>
      </header>
      {warnings.length > 0 && <div className="warning-strip" title={warnings.join("\n")}>{warnings.length === 1 ? warnings[0] : t.analysisNotes(warnings.length, warnings.join(" · "))}<button onClick={onDismissWarnings}>{t.dismiss}</button></div>}
      <div className="workspace-content">
        {mode === "lab" && <LabView project={project} library={library} onAnalysePaper={onAnalysePaper} onReview={onReview} fileUrl={fileUrl} selectedClaimId={selectedClaimId} onClaimSelect={onClaimSelect} onProjectChange={onProjectChange} onPaperFile={onPaperFile} onShowStorySection={showStorySection} jump={labJump} />}
        {mode === "story" && <StoryEditor project={project} fileUrl={fileUrl} onProjectChange={onProjectChange} onPreview={() => onMode("preview")} />}
        {mode === "preview" && <div className="preview-shell"><StoryView project={project} embedded onClaimSelect={onClaimSelect} /></div>}
      </div>
      {panel === "publish" && <PublishPanel project={project} onClose={() => onPanel(undefined)} />}
      {panel === "citations" && <CitationPanel project={project} onAnalyse={onAnalysePaper} onClose={() => onPanel(undefined)} />}
      {panel === "history" && (
        <HistoryPanel
          project={project}
          onRestore={async (restored) => {
            await onRestore(restored);
            onPanel(undefined);
          }}
          onClose={() => onPanel(undefined)}
        />
      )}
      {mode === "preview" && selectedClaim && <div className="drawer-overlay" onClick={() => onClaimSelect(undefined)}><div onClick={(event) => event.stopPropagation()}><EvidenceDrawer claim={selectedClaim} review={project.claimReviews?.[selectedClaim.id]} evidence={project.evidence} fileUrl={fileUrl} onClose={() => onClaimSelect(undefined)} /></div></div>}
    </div>
    </ReaderNotesProvider>
  );
}
