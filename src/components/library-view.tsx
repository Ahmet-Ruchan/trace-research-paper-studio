"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, FileText, FileUp, Plus, Search, Trash2 } from "lucide-react";
import type { ResearchProject } from "@/lib/schema";

type LibraryViewProps = {
  projects: ResearchProject[];
  onOpen: (project: ResearchProject) => void;
  onDelete: (projectId: string) => void;
  onHome: () => void;
  onNew: () => void;
  onImport: (file: File) => Promise<void>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(value));
}

function generationLabel(project: ResearchProject) {
  const assignments = project.generation?.assignments;
  if (!assignments) return project.generation?.model;
  const models = new Set(Object.values(assignments).map((assignment) => `${assignment.provider}:${assignment.model}`));
  return models.size > 1 ? `${models.size} modelli ekip` : [...models][0]?.split(":").slice(1).join(":");
}

export function LibraryView({ projects, onOpen, onDelete, onHome, onNew, onImport }: LibraryViewProps) {
  const [query, setQuery] = useState("");
  const [importError, setImportError] = useState<string>();
  const importRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr");
    if (!needle) return projects;
    return projects.filter((project) =>
      [project.evidence.paper.title, project.evidence.paper.authors.join(" "), project.evidence.paper.venue]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(needle),
    );
  }, [projects, query]);

  return (
    <main className="library-page">
      <header className="library-header">
        <button className="brand" onClick={onHome} aria-label="Trace ana sayfa">
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>research studio</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onHome}><ArrowLeft size={15} /> Ana sayfa</button>
          <input ref={importRef} type="file" accept=".json,.trace.json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setImportError(undefined);
            void onImport(file).catch((error) => setImportError(error instanceof Error ? error.message : "Trace projesi içe alınamadı."));
          }} />
          <button className="library-import-button" onClick={() => importRef.current?.click()}><FileUp size={15} /> Trace JSON</button>
          <button className="library-new-button" onClick={onNew}><Plus size={16} /> Yeni paper</button>
        </div>
      </header>

      {importError && <div className="library-import-error">{importError}<button onClick={() => setImportError(undefined)}>Kapat</button></div>}

      <section className="library-hero">
        <div>
          <p className="landing-eyebrow"><span /> Personal research archive</p>
          <h1>Paper kütüphanen.</h1>
          <p>Ürettiğin kanıt haritaları, derin raporlar ve interaktif anlatılar tek yerde.</p>
        </div>
        <div className="library-stat"><strong>{projects.length}</strong><span>kayıtlı çalışma</span></div>
      </section>

      <section className="library-toolbar">
        <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Başlık, yazar veya venue ara" /></label>
        <span>{filtered.length} sonuç</span>
      </section>

      {filtered.length ? (
        <section className="library-grid">
          {filtered.map((project, index) => (
            <article className="library-card" key={project.id} style={{ "--card-accent": project.story.accent } as React.CSSProperties}>
              <button className="library-card-main" onClick={() => onOpen(project)}>
                <div className="library-cover">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <FileText size={25} />
                  <i />
                </div>
                <div className="library-card-copy">
                  <span>{project.evidence.paper.venue || "Research paper"} · {project.evidence.paper.year}</span>
                  <h2>{project.evidence.paper.title}</h2>
                  <p>{project.evidence.plainSummary}</p>
                  <div className="library-card-meta">
                    <span>{project.story.sections.length} story</span>
                    <span>{project.evidence.claims.length} claim</span>
                    {project.deepReport && <span>{project.deepReport.sections.length} rapor</span>}
                    {project.technicalAppendix && <span>technical appendix</span>}
                  </div>
                </div>
              </button>
              <footer>
                <span>{formatDate(project.updatedAt)}{generationLabel(project) ? ` · ${generationLabel(project)}` : ""}</span>
                <div>
                  <button className="library-delete" title="Kütüphaneden sil" onClick={() => {
                    if (window.confirm(`“${project.evidence.paper.title}” kütüphaneden silinsin mi?`)) onDelete(project.id);
                  }}><Trash2 size={15} /></button>
                  <button className="library-open" onClick={() => onOpen(project)}>Aç <ArrowRight size={15} /></button>
                </div>
              </footer>
            </article>
          ))}
        </section>
      ) : (
        <section className="library-empty">
          <BookOpen size={30} />
          <h2>{projects.length ? "Aramanla eşleşen paper yok." : "Kütüphanen ilk paper’ını bekliyor."}</h2>
          <p>Bir PDF ekle veya Codex, Claude Code ya da Gemini CLI’nin ürettiği Trace JSON’u içe al.</p>
          <button onClick={onNew}>Paper ekle <ArrowRight size={16} /></button>
        </section>
      )}
    </main>
  );
}
