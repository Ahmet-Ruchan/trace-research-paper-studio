"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Download, FileJson, FlaskConical, Home, LayoutTemplate, MoreHorizontal, Plus, Share2 } from "lucide-react";
import { buildStandaloneStory } from "@/lib/export-story";
import {
  generationStages,
  initialGenerationProgress,
  isGenerationStreamEvent,
  type GenerationProgress,
} from "@/lib/generation-events";
import { stringsFor } from "@/visuals";
import { researchProjectSchema, type ResearchProject } from "@/lib/schema";
import { loadSampleProject } from "@/lib/sample-project";
import { deleteLibraryProject, listLibraryProjects, saveLibraryProject } from "@/lib/project-library";
import { EvidenceDrawer } from "./evidence-drawer";
import { LabView } from "./lab-view";
import { LibraryView } from "./library-view";
import { Onboarding, type GenerationOptions } from "./onboarding";
import { StoryEditor } from "./story-editor";
import { StoryView } from "./story-view";

type WorkspaceMode = "lab" | "story" | "preview";
type AppScreen = "home" | "library" | "workspace";
const STORAGE_KEY = "trace-research-project-v1";
const CHECKPOINT_KEY = "trace-evidence-checkpoint-v1";

function checkpointPartCount(raw: string | null) {
  if (!raw) return 0;
  try {
    const value = JSON.parse(raw) as { parts?: Record<string, unknown> };
    return value.parts ? Object.values(value.parts).filter(Boolean).length : 0;
  } catch {
    return 0;
  }
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function AppShell() {
  const [project, setProject] = useState<ResearchProject>();
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [screen, setScreen] = useState<AppScreen>("home");
  const [initialTeam, setInitialTeam] = useState(false);
  const [mode, setMode] = useState<WorkspaceMode>("lab");
  const [fileUrl, setFileUrl] = useState<string>();
  const [selectedClaimId, setSelectedClaimId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [errorTitle, setErrorTitle] = useState("Generation failed");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress>(initialGenerationProgress);
  const generationController = useRef<AbortController | undefined>(undefined);
  const checkpointCount = useRef(0);

  /**
   * Plugin devir teslimi: `deliver` tarayıcıyı `?import=<url>` ile açar ve proje
   * kullanıcı hiçbir şey yapmadan kütüphaneye düşer.
   *
   * Adres YALNIZCA loopback olabilir. Aksi halde herhangi bir sayfadaki bir
   * bağlantı ("trace.app/?import=https://saldirgan/x.json") kullanıcının
   * kütüphanesine yabancı içerik yazdırabilirdi. Şema doğrulaması bu kontrolün
   * yerine geçmez: geçerli bir Trace projesi de kötü niyetli olabilir.
   */
  async function adoptHandoff(rawUrl: string) {
    window.history.replaceState(null, "", window.location.pathname);
    let url: URL;
    try {
      url = new URL(rawUrl, window.location.origin);
    } catch {
      throw new Error("The import address is not valid.");
    }
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (!loopback || !/^https?:$/.test(url.protocol)) {
      throw new Error("Imports are only accepted from an address on this machine.");
    }
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`The project could not be downloaded (HTTP ).`);
    const text = await response.text();
    if (text.length > 5 * 1024 * 1024) throw new Error("The Trace JSON exceeds the 5 MB limit.");
    const parsed = researchProjectSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`Invalid Trace project schema: ${issue?.path.join(".") || "root"} · ${issue?.message ?? "unknown error"}`);
    }
    await saveLibraryProject(parsed.data);
    setProjects((current) => [parsed.data, ...current.filter((item) => item.id !== parsed.data.id)]);
    setProject(parsed.data);
    setMode("lab");
    setScreen("workspace");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const search = new URLSearchParams(window.location.search);
        const requestedMode = search.get("mode");
        if (requestedMode === "story" || requestedMode === "preview" || requestedMode === "lab") {
          setMode(requestedMode);
        }
        if (search.get("new") === "1") window.localStorage.removeItem(CHECKPOINT_KEY);
        if (search.get("sample") === "1") {
          const sample = await loadSampleProject().catch(() => undefined);
          if (sample) {
            setProject(sample);
            setScreen("workspace");
          }
        }
        const handoff = search.get("import");
        if (handoff) {
          await adoptHandoff(handoff).catch((caught: unknown) => {
            setErrorTitle("Import failed");
            setError(caught instanceof Error ? caught.message : "The project could not be imported.");
          });
        }
        if (search.get("library") === "1") setScreen("library");
        if (search.get("team") === "1") setInitialTeam(true);
        setHydrated(true);
        // Eski tek-proje localStorage kaydını kütüphaneye taşı.
        // Taşıma BİR KEZ olmalı: anahtar silinmezse her açılışta tekrar
        // yazılıyor ve kullanıcının daha yeni içe aktardığı sürümü sessizce
        // eskisiyle değiştiriyordu. Ayrıca kütüphanedeki kayıt daha yeniyse
        // hiç dokunmuyoruz.
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            const legacy = researchProjectSchema.parse(JSON.parse(stored));
            const existing = (await listLibraryProjects().catch(() => [])).find(
              (item) => item.id === legacy.id,
            );
            if (!existing || existing.updatedAt < legacy.updatedAt) {
              await saveLibraryProject(legacy);
            }
          } catch {
            // yoksayılır; anahtar aşağıda zaten temizleniyor
          }
          window.localStorage.removeItem(STORAGE_KEY);
        }
        setProjects(await listLibraryProjects().catch(() => []));
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!project || !hydrated || screen !== "workspace") return;
    const timer = window.setTimeout(() => {
      const updated = { ...project, updatedAt: new Date().toISOString() };
      void saveLibraryProject(updated).then(() => {
        setProjects((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [project, hydrated, screen]);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  async function generate(options: GenerationOptions) {
    const controller = new AbortController();
    generationController.current = controller;
    const savedCheckpoint = window.localStorage.getItem(CHECKPOINT_KEY);
    checkpointCount.current = checkpointPartCount(savedCheckpoint);
    setGenerationProgress(initialGenerationProgress);
    setLoading(true); setError(undefined); setErrorTitle("Generation failed"); setWarnings([]);
    try {
      const form = new FormData();
      form.set("paper", options.file);
      form.set("sources", JSON.stringify(options.sources));
      form.set("apiKeys", JSON.stringify(options.apiKeys));
      form.set("assignments", JSON.stringify(options.assignments));
      form.set("language", options.language);
      form.set("audience", options.audience);
      form.set("depth", options.depth);
      if (savedCheckpoint) form.set("checkpoint", savedCheckpoint);
      const response = await fetch("/api/generate", {
        method: "POST",
        body: form,
        signal: controller.signal,
        headers: { Accept: "application/x-ndjson, application/json" },
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        throw new Error(data?.error ?? "The paper could not be generated.");
      }

      let projectData: unknown;
      let responseWarnings: string[] = [];
      const contentType = response.headers.get("content-type") ?? "";

      if (contentType.includes("application/x-ndjson")) {
        if (!response.body) throw new Error("The generation stream could not be started.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = done ? "" : (lines.pop() ?? "");

          for (const line of lines) {
            if (!line.trim()) continue;
            const event: unknown = JSON.parse(line);
            if (!isGenerationStreamEvent(event)) continue;
            if (event.type === "progress") setGenerationProgress(event);
            if (event.type === "checkpoint") {
              window.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(event.checkpoint));
              checkpointCount.current = event.completed.length;
            }
            if (event.type === "error") throw new Error(event.error);
            if (event.type === "result") {
              window.localStorage.removeItem(CHECKPOINT_KEY);
              checkpointCount.current = 0;
              projectData = event.project;
              responseWarnings = event.warnings;
              setGenerationProgress({
                stage: "finalize",
                progress: 100,
                title: "Research workspace ready.",
                detail: "Evidence map and StorySpec built successfully.",
              });
            }
          }
          if (done) break;
        }
      } else {
        const data = (await response.json()) as {
          project?: unknown;
          error?: string;
          warnings?: string[];
        };
        if (!data.project) throw new Error(data.error ?? "The paper could not be generated.");
        projectData = data.project;
        responseWarnings = data.warnings ?? [];
      }

      if (!projectData) throw new Error("Generation finished but no project data came back.");
      const nextProject = researchProjectSchema.parse(projectData);
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      setFileUrl(URL.createObjectURL(options.file));
      setProject(nextProject);
      setProjects((current) => [nextProject, ...current.filter((item) => item.id !== nextProject.id)]);
      await saveLibraryProject(nextProject);
      setWarnings(responseWarnings);
      setMode("lab");
      setScreen("workspace");
    } catch (caught) {
      const aborted = controller.signal.aborted || caught instanceof DOMException && caught.name === "AbortError";
      const resumeNote = checkpointCount.current > 0
        ? ` ${checkpointCount.current}/4 evidence stages were saved; press Analyse paper again to resume from here.`
        : "";
      setError(aborted ? "Generation cancelled; no API key or temporary file was kept." : `${caught instanceof Error ? caught.message : "Something unexpected went wrong."}${resumeNote}`);
    } finally {
      if (generationController.current === controller) generationController.current = undefined;
      setLoading(false);
    }
  }

  async function openSample() {
    window.localStorage.removeItem(CHECKPOINT_KEY);
    setError(undefined);
    setLoadingSample(true);
    try {
      setProject(await loadSampleProject());
      setMode("lab");
      setScreen("workspace");
    } catch (caught) {
      setErrorTitle("Could not open the example");
      setError(caught instanceof Error ? caught.message : "The example project could not be loaded.");
    } finally {
      setLoadingSample(false);
    }
  }
  function newProject() {
    window.localStorage.removeItem(CHECKPOINT_KEY);
    setProject(undefined); setFileUrl(undefined); setSelectedClaimId(undefined); setWarnings([]); setScreen("home");
  }

  function openProject(nextProject: ResearchProject) {
    setProject(nextProject);
    setMode("lab");
    setScreen("workspace");
    setSelectedClaimId(undefined);
    setWarnings([]);
  }

  async function removeProject(projectId: string) {
    await deleteLibraryProject(projectId);
    setProjects((current) => current.filter((item) => item.id !== projectId));
    if (project?.id === projectId) setProject(undefined);
  }

  async function importProject(file: File) {
    if (file.size > 5 * 1024 * 1024) throw new Error("The Trace JSON exceeds the 5 MB limit.");
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new Error("The file is not valid JSON.");
    }
    const parsed = researchProjectSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") || "root";
      throw new Error(`Invalid Trace project schema: ${path} · ${issue?.message ?? "unknown error"}`);
    }
    await saveLibraryProject(parsed.data);
    setProjects((current) => [parsed.data, ...current.filter((item) => item.id !== parsed.data.id)]);
    setProject(parsed.data);
    setMode("lab");
    setSelectedClaimId(undefined);
    setWarnings([]);
    setScreen("workspace");
  }

  const t = stringsFor(project?.language);

  if (!hydrated) return <div className="boot-screen"><span>trace</span></div>;
  if (screen === "library") {
    return <LibraryView projects={projects} onOpen={openProject} onDelete={removeProject} onHome={() => setScreen("home")} onNew={newProject} onImport={importProject} />;
  }
  if (screen === "home" || !project) {
    return <><Onboarding onGenerate={generate} onSample={() => { void openSample(); }} sampleBusy={loadingSample} onLibrary={() => setScreen("library")} libraryCount={projects.length} initialTeam={initialTeam} />{loading && <GenerationOverlay progress={generationProgress} onCancel={() => generationController.current?.abort()} />}{error && <div className="toast error-toast"><strong>{errorTitle}</strong><p>{error}</p><button onClick={() => setError(undefined)}>Close</button></div>}</>;
  }

  const selectedClaim = project.evidence.claims.find((claim) => claim.id === selectedClaimId);
  const slug = project.evidence.paper.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trace-story";

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <button className="workspace-brand" onClick={() => setScreen("home")}><span className="brand-glyph">t</span><span><strong>trace</strong><small>research studio</small></span></button>
        <div className="project-identity"><span>Current paper</span><strong>{project.evidence.paper.title}</strong></div>
        <nav className="mode-tabs" aria-label="Workspace mode">
          <button className={mode === "lab" ? "active" : ""} onClick={() => setMode("lab")}><FlaskConical size={15} /> Lab</button>
          <button className={mode === "story" ? "active" : ""} onClick={() => setMode("story")}><LayoutTemplate size={15} /> Story</button>
          <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}><Share2 size={15} /> Preview</button>
        </nav>
        <div className="workspace-actions">
          <button title={t.home} onClick={() => setScreen("home")}><Home size={16} /><span>{t.home}</span></button>
          <button title={t.library} onClick={() => setScreen("library")}><BookOpen size={16} /><span>{t.library}</span></button>
          <button title="Download the project JSON" onClick={() => download(`${slug}.trace.json`, JSON.stringify(project, null, 2), "application/json")}><FileJson size={16} /><span>JSON</span></button>
          <button className="export-button" onClick={() => download(`${slug}.html`, buildStandaloneStory(project), "text/html")}><Download size={16} /> Export</button>
          <button className="icon-button" title="New paper" onClick={newProject}><Plus size={17} /></button>
          <button className="icon-button" title="Coming soon" disabled><MoreHorizontal size={17} /></button>
        </div>
      </header>
      {warnings.length > 0 && <div className="warning-strip">{warnings.length} supporting sources could not be read; the analysis was completed with the rest.<button onClick={() => setWarnings([])}>Dismiss</button></div>}
      <div className="workspace-content">
        {mode === "lab" && <LabView project={project} fileUrl={fileUrl} selectedClaimId={selectedClaimId} onClaimSelect={setSelectedClaimId} />}
        {mode === "story" && <StoryEditor project={project} fileUrl={fileUrl} onProjectChange={setProject} onPreview={() => setMode("preview")} />}
        {mode === "preview" && <div className="preview-shell"><StoryView project={project} embedded onClaimSelect={setSelectedClaimId} /></div>}
      </div>
      {mode === "preview" && selectedClaim && <div className="drawer-overlay" onClick={() => setSelectedClaimId(undefined)}><div onClick={(event) => event.stopPropagation()}><EvidenceDrawer claim={selectedClaim} evidence={project.evidence} fileUrl={fileUrl} onClose={() => setSelectedClaimId(undefined)} /></div></div>}
    </div>
  );
}

function GenerationOverlay({ progress, onCancel }: { progress: GenerationProgress; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      setElapsed(Math.floor((now - startedAt) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeIndex = generationStages.findIndex((stage) => stage.id === progress.stage);
  const activityAge = progress.activityAt && clock
    ? Math.max(0, Math.floor((clock - new Date(progress.activityAt).getTime()) / 1_000))
    : 0;
  const activityLabel = activityAge < 3 ? "model active" : `last model activity ${activityAge}s ago`;
  return <div className="generation-overlay" role="status" aria-live="polite"><div className="generation-card"><div className="generation-orbit"><span /><span /><span /></div><div className="generation-status-line"><p className="landing-eyebrow"><span /> Evidence pipeline running</p><small>{elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}</small></div><h2>{progress.title}</h2><p>{progress.detail}</p><div className="generation-live"><i className={activityAge < 12 ? "active" : ""} /><span>{activityLabel}</span><small>10s heartbeat</small></div><div className="generation-stages">{generationStages.map((stage, index) => <span key={stage.id} className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""}><i>{index < activeIndex ? "✓" : String(index + 1).padStart(2, "0")}</i><b>{stage.label}</b><small>{stage.description}</small></span>)}</div><div className="generation-meter"><i style={{ width: `${Math.max(2, Math.min(100, progress.progress))}%` }} /></div><div className="generation-footer"><span>{Math.round(progress.progress)}% complete{progress.attempt ? ` · attempt ${progress.attempt}` : ""}</span><button onClick={onCancel}>Cancel</button></div></div></div>;
}
