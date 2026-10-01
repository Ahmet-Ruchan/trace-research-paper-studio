"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { buildPaletteCommands, type PaletteTarget } from "@/lib/command-palette";
import { buildStandaloneStory } from "@/lib/export-story";
import { exportDefinitions } from "@/lib/exports";
import { deleteLibraryProject, listLibraryProjects, saveLibraryProject } from "@/lib/project-library";
import { parseTraceProject, PROJECT_TOO_LARGE, MAX_PROJECT_BYTES } from "@/lib/project-import";
import type { RevisionReason } from "@/lib/project-revisions";
import type { ReadingPosition } from "@/lib/reading-position";
import { loadSampleProject } from "@/lib/sample-project";
import { researchProjectSchema, type ResearchProject } from "@/lib/schema";
import { restoreTextSize } from "@/lib/text-size";
import { restoreTheme } from "@/lib/theme";
import { CommandPalette } from "./command-palette";
import { CompareView } from "./compare-view";
import { ConceptMapView } from "./concept-map-view";
import { ExamView } from "./exam-view";
import { FocusAlerts } from "./focus/focus-alerts";
import { FocusProvider } from "./focus/focus-provider";
import { FocusView } from "./focus/focus-view";
import { ProfileView } from "./focus/profile-view";
import { StudioNavProvider, type StudioNavTarget } from "./focus/studio-nav";
import { LearningStatsView } from "./learning-stats-view";
import { LibraryView } from "./library-view";
import { LiteratureMapView } from "./literature-map-view";
import { ModelRecordView } from "./model-record-view";
import { Onboarding } from "./onboarding";
import { ReadingListProvider } from "./reading-list";
import { scrollToSection } from "./reading-position";
import { ReviewView } from "./review-view";
import { download, projectSlug } from "./studio/download";
import { GenerationOverlay } from "./studio/generation-overlay";
import { returnLabels, STORAGE_KEY, type AppScreen, type LabJump, type WorkspaceMode, type WorkspacePanel } from "./studio/screens";
import { CHECKPOINT_KEY, useGeneration } from "./studio/use-generation";
import { useProjectDeletion } from "./studio/use-project-deletion";
import { useStudioStartup, useStudioUrl } from "./studio/use-studio-url";
import { WorkspaceView } from "./studio/workspace-view";

/**
 * Stüdyonun ekran geçişleri: hangi ekranın açık olduğu, açık makale ve
 * ekranlar arası gezinme. Makale ekranı (`studio/workspace-view.tsx`),
 * analiz akışı (`studio/use-generation.ts`), silme kuyruğu
 * (`studio/use-project-deletion.ts`) ve adres çubuğu (`studio/use-studio-url.ts`)
 * kendi dosyalarında.
 *
 * Çalışma saati bütün ekranların üstünde: sağlayıcı kökte, sayaç okuyucu
 * ekran değiştirse de sürüyor (`focus/focus-provider.tsx`).
 */
export function AppShell() {
  return (
    <FocusProvider>
      <ReadingListProvider>
        <Studio />
      </ReadingListProvider>
    </FocusProvider>
  );
}

function Studio() {
  const [project, setProject] = useState<ResearchProject>();
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [screen, setScreen] = useState<AppScreen>("home");
  /** Çalışma saati ve profilden dönülecek ekran: makaledeyken açılan sayaç makaleye geri dönüyor. */
  const [returnTo, setReturnTo] = useState<AppScreen>("library");
  /** Tekrar ekranı tek bir makaleyle sınırlıysa onun kimliği (Lab'den gelindi). */
  const [reviewScope, setReviewScope] = useState<string>();
  const [comparison, setComparison] = useState<ResearchProject[]>();
  const [panel, setPanel] = useState<WorkspacePanel>();
  const [paperLookup, setPaperLookup] = useState<{ query: string; expectTitle?: string }>();
  // Kütüphaneden "Reading list": kavram haritası okuma sırasına kaydırılarak açılıyor.
  const [conceptsFocus, setConceptsFocus] = useState<"reading">();
  const [labJump, setLabJump] = useState<LabJump>();
  const [initialTeam, setInitialTeam] = useState(false);
  const [mode, setMode] = useState<WorkspaceMode>("lab");
  const [fileUrl, setFileUrl] = useState<string>();
  const [selectedClaimId, setSelectedClaimId] = useState<string>();
  const [error, setError] = useState<string>();
  const [errorTitle, setErrorTitle] = useState("Generation failed");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  /**
   * Bir sonraki otomatik kaydın nedeni. Kayıt yarım saniye gecikmeli çalıştığı
   * için neden değişiklikle birlikte bir kenara yazılıyor; yeniden üretim ya da
   * geri yükleme "edit" sayılırsa on dakikalık birleştirmeye takılır ve önceki
   * hâl geçmişte hiç görünmeyebilirdi.
   */
  const saveReason = useRef<RevisionReason>("edit");

  const generation = useGeneration({
    onStart: () => {
      setError(undefined);
      setErrorTitle("Generation failed");
      setWarnings([]);
    },
    onResult: async (nextProject, responseWarnings, file) => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      setFileUrl(URL.createObjectURL(file));
      setProject(nextProject);
      setProjects((current) => [nextProject, ...current.filter((item) => item.id !== nextProject.id)]);
      await saveLibraryProject(nextProject);
      setWarnings(responseWarnings);
      setPaperLookup(undefined);
      setMode("lab");
      setScreen("workspace");
    },
    onFailure: setError,
  });

  const deletion = useProjectDeletion({ projects, setProjects, inLibrary: screen === "library", remove: removeProject });

  // Yazı boyutu ve tema kök öğeye HTML okunurken yazılıyor (layout.tsx).
  // Geliştirmede Strict Mode `<html>`'i yeniden kurarken onları siliyor;
  // burada boyamadan önce geri yazılıyorlar. Üretimde bir şey değişmiyor.
  useLayoutEffect(() => {
    restoreTextSize();
    restoreTheme();
  }, []);

  useStudioStartup({
    setMode,
    setScreen,
    show: (opened) => {
      setProject(opened);
      setScreen("workspace");
    },
    adopted: (adopted) => {
      setProjects((current) => [adopted, ...current.filter((item) => item.id !== adopted.id)]);
      setProject(adopted);
      setMode("lab");
      setScreen("workspace");
    },
    importFailed: (message) => {
      setErrorTitle("Import failed");
      setError(message);
    },
    setInitialTeam,
    selectClaim: setSelectedClaimId,
    hydrated: () => setHydrated(true),
    setProjects,
  });

  useStudioUrl(
    { hydrated, screen, project, mode, selectedClaimId, reviewScope },
    { selectClaim: setSelectedClaimId, showPreview: () => setMode("preview") },
  );

  /**
   * Kaydın sebebi (sürüm geçmişindeki etiket) kayıt zamanlandığında bu
   * projeye bağlanıyor, zamanlayıcı çalıştığında değil. Önceden zamanlayıcı
   * okuyordu: bir değişikliğin sebebi yazıldıktan sonra, React yeni projeyi
   * işlemeden önce önceki projenin bekleyen kaydı çalışırsa sebebi o alıyor,
   * asıl değişiklik "Before edits" diye kaydediliyordu. Kaydedilmeden yerini
   * yeni bir değişikliğe bırakan kaydın sebebi de ona taşınıyor.
   */
  useEffect(() => {
    if (!project || !hydrated || screen !== "workspace") return;
    const reason = saveReason.current;
    saveReason.current = "edit";
    let saved = false;
    const timer = window.setTimeout(() => {
      saved = true;
      const updated = { ...project, updatedAt: new Date().toISOString() };
      void saveLibraryProject(updated, { reason }).then(() => {
        setProjects((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }, 500);
    return () => {
      window.clearTimeout(timer);
      if (!saved && saveReason.current === "edit") saveReason.current = reason;
    };
  }, [project, hydrated, screen]);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

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

  function changeProject(next: ResearchProject, reason?: RevisionReason) {
    if (reason) saveReason.current = reason;
    setProject(next);
  }

  function newProject() {
    window.localStorage.removeItem(CHECKPOINT_KEY);
    setProject(undefined); setFileUrl(undefined); setSelectedClaimId(undefined); setWarnings([]); setPaperLookup(undefined); setScreen("home");
  }

  /**
   * Atıf grafiğindeki bir makaleyi analiz etmek: yükleme ekranı o makale
   * aranmış hâlde açılır. Beklenen başlık da gidiyor, çünkü grafikteki kimlik
   * OpenAlex'in eşleştirmesine dayanıyor ve başka bir makaleyi gösterebiliyor.
   */
  function analyseFromGraph(node: { identifier: string; title: string }) {
    window.localStorage.removeItem(CHECKPOINT_KEY);
    setPanel(undefined);
    setPaperLookup({ query: node.identifier, expectTitle: node.title });
    setFileUrl(undefined); setSelectedClaimId(undefined); setWarnings([]);
    setScreen("home");
  }

  function openProject(nextProject: ResearchProject) {
    setPaperLookup(undefined);
    // Önceki projenin PDF'i bu projenin alıntılarını gösteremez.
    if (nextProject.id !== project?.id) setFileUrl(undefined);
    setProject(nextProject);
    setMode("lab");
    setScreen("workspace");
    setSelectedClaimId(undefined);
    setWarnings([]);
  }

  /** Kaldığın yerden: hikâyede önizleme, raporda Lab açılıp bölüme kaydırılıyor. */
  function continueReading(nextProject: ResearchProject, position: ReadingPosition) {
    openProject(nextProject);
    if (position.place === "story") {
      setMode("preview");
      window.setTimeout(() => scrollToSection("story", position.sectionId), 150);
    } else {
      setLabJump({ section: "report", reportSectionId: position.sectionId, nonce: Date.now() });
    }
  }

  /** Kütüphanedeki not aramasından: proje laboratuvarda, notların bölümünde. */
  function openNotes(nextProject: ResearchProject) {
    openProject(nextProject);
    setLabJump({ section: "notes", nonce: Date.now() });
  }

  /** Kütüphanedeki iddia aramasından: proje laboratuvarda, o iddia seçili ve görünür açılır. */
  function openClaim(nextProject: ResearchProject, claimId: string) {
    openProject(nextProject);
    setSelectedClaimId(claimId);
  }

  async function removeProject(projectId: string, keepalive = false) {
    await deleteLibraryProject(projectId, { keepalive });
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        if (researchProjectSchema.parse(JSON.parse(stored)).id === projectId) {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setProjects((current) => current.filter((item) => item.id !== projectId));
    // İşlevsel güncelleme: silme geri alma süresi dolunca, eski bir çizimin kapanışından çalışıyor.
    setProject((current) => (current?.id === projectId ? undefined : current));
  }

  async function importProject(file: File) {
    if (file.size > MAX_PROJECT_BYTES) throw new Error(PROJECT_TOO_LARGE);
    const imported = parseTraceProject(await file.text());
    await saveLibraryProject(imported, { reason: "import" });
    setProjects((current) => [imported, ...current.filter((item) => item.id !== imported.id)]);
    setProject(imported);
    setMode("lab");
    setSelectedClaimId(undefined);
    setWarnings([]);
    setScreen("workspace");
  }

  /**
   * Geçmişten geri yükleme otomatik kayda bırakılmıyor: o yarım saniye
   * gecikmeli ve geçmiş paneli hemen yeniden açılırsa "geri yüklemeden önce"
   * kaydını henüz görmüyordu. Kayıt beklenip sonra ekrana yansıtılıyor;
   * ardından gelen otomatik kayıt içerik aynı olduğu için iz bırakmaz.
   */
  async function restoreVersion(restored: ResearchProject) {
    const stamped = { ...restored, updatedAt: new Date().toISOString() };
    await saveLibraryProject(stamped, { reason: "restore" });
    setProjects((current) => [stamped, ...current.filter((item) => item.id !== stamped.id)]);
    setProject(stamped);
    setSelectedClaimId(undefined);
  }

  function openWork(target: StudioNavTarget) {
    if (screen !== "focus" && screen !== "profile") setReturnTo(screen === "compare" ? "library" : screen);
    setScreen(target);
  }
  const backFromWork = returnTo === "workspace" && !project ? "library" : returnTo;

  /** Komut paletinin listesi: açık makalenin bölümleri ve eylemleri yalnızca makaledeyken. */
  const paletteCommands = () =>
    buildPaletteCommands({
      projects,
      current: screen === "workspace" ? project : undefined,
      screen,
      exports: project ? exportDefinitions.map((definition) => ({ format: definition.format, label: definition.label, description: definition.description, unavailable: definition.unavailable?.(project) })) : [],
    });

  function runCommand(target: PaletteTarget) {
    if (target.type === "paper") {
      const next = projects.find((item) => item.id === target.projectId);
      if (next) openProject(next);
      return;
    }
    if (target.type === "screen") {
      if (target.screen === "focus" || target.screen === "profile") return openWork(target.screen);
      if (target.screen === "review" || target.screen === "exam") setReviewScope(undefined);
      if (target.screen === "concepts" || target.screen === "reading-order") {
        setConceptsFocus(target.screen === "reading-order" ? "reading" : undefined);
        return setScreen("concepts");
      }
      return setScreen(target.screen);
    }
    if (!project) return;
    setScreen("workspace");
    if (target.type === "mode") setMode(target.mode);
    else if (target.type === "lab") {
      setMode("lab");
      setLabJump({ section: target.section, reportSectionId: target.reportSectionId, conceptId: target.conceptId, term: target.term, query: target.query, nonce: Date.now() });
    } else if (target.type === "story") {
      setMode("preview");
      window.setTimeout(() => scrollToSection("story", target.sectionId), 150);
    } else if (target.type === "action") {
      if (target.action === "json") download(`${projectSlug(project)}.trace.json`, JSON.stringify(project, null, 2), "application/json");
      else if (target.action === "site") download(`${projectSlug(project)}.html`, buildStandaloneStory(project), "text/html");
      else setPanel(target.action);
    } else {
      const definition = exportDefinitions.find((item) => item.format === target.format);
      if (definition && !definition.unavailable?.(project)) download(`${projectSlug(project)}.${definition.extension}`, definition.build(project), definition.mime);
    }
  }

  /** Her ekran üst menüyü, zamanlayıcının bildirimlerini ve komut paletini taşıyor. */
  const withWork = (content: React.ReactNode) => (
    <StudioNavProvider value={{ open: openWork, current: screen === "focus" || screen === "profile" ? screen : undefined }}>
      {content}
      <FocusAlerts onOpen={() => openWork("focus")} onReport={() => openWork("profile")} />
      <CommandPalette build={paletteCommands} onRun={runCommand} />
    </StudioNavProvider>
  );

  if (!hydrated) return <div className="boot-screen"><span>trace</span></div>;
  if (screen === "focus") {
    return withWork(<FocusView projects={projects} backLabel={returnLabels[backFromWork] ?? "Library"} onBack={() => setScreen(backFromWork)} onProfile={() => setScreen("profile")} />);
  }
  if (screen === "profile") {
    return withWork(
      <ProfileView
        projects={projects}
        backLabel={returnLabels[backFromWork] ?? "Library"}
        onBack={() => setScreen(backFromWork)}
        onFocus={() => setScreen("focus")}
        onProgress={() => setScreen("progress")}
        onOpen={openProject}
        onLibraryChanged={() => void listLibraryProjects().then(setProjects).catch(() => undefined)}
      />,
    );
  }
  if (screen === "compare" && comparison && comparison.length > 2) {
    return withWork(<LiteratureMapView projects={comparison} onBack={() => setScreen("library")} onOpen={openProject} />);
  }
  if (screen === "compare" && comparison?.length === 2) {
    return withWork(
      <CompareView
        left={comparison[0]}
        right={comparison[1]}
        onBack={() => setScreen("library")}
        onOpen={openProject}
      />,
    );
  }
  if (screen === "models") {
    return withWork(<ModelRecordView projects={projects} onBack={() => setScreen("library")} onOpen={openProject} />);
  }
  if (screen === "concepts") {
    return withWork(<ConceptMapView projects={projects} onBack={() => setScreen("library")} onOpen={openProject} onAnalyse={analyseFromGraph} focusReading={conceptsFocus === "reading"} />);
  }
  if (screen === "progress") {
    return withWork(
      <LearningStatsView
        projects={projects}
        onBack={() => setScreen("library")}
        onOpen={openProject}
        onReview={() => {
          setReviewScope(undefined);
          setScreen("review");
        }}
      />,
    );
  }
  if (screen === "exam") {
    const scoped = reviewScope && project?.id === reviewScope;
    return withWork(
      <ExamView
        projects={projects}
        projectId={scoped ? reviewScope : undefined}
        backLabel="Review"
        onBack={() => setScreen("review")}
        onOpen={(target) => {
          setReviewScope(undefined);
          openProject(target);
        }}
      />,
    );
  }
  if (screen === "review") {
    const scoped = reviewScope && project?.id === reviewScope;
    return withWork(
      <ReviewView
        projects={projects}
        projectId={scoped ? reviewScope : undefined}
        onExam={() => setScreen("exam")}
        backLabel={scoped ? "Back to the paper" : "Library"}
        onBack={() => {
          setReviewScope(undefined);
          setScreen(scoped ? "workspace" : "library");
        }}
        onOpen={(target) => {
          setReviewScope(undefined);
          openProject(target);
        }}
      />,
    );
  }
  if (screen === "library") {
    return withWork(
      <LibraryView
        projects={projects}
        onReview={() => {
          setReviewScope(undefined);
          setScreen("review");
        }}
        onConcepts={() => {
          setConceptsFocus(undefined);
          setScreen("concepts");
        }}
        onContinue={continueReading}
        onReadingList={() => {
          setConceptsFocus("reading");
          setScreen("concepts");
        }}
        onProgress={() => setScreen("progress")}
        onOpen={openProject}
        onOpenClaim={openClaim}
        onOpenNotes={openNotes}
        onModelRecord={() => setScreen("models")}
        onDelete={deletion.request}
        pendingDeletion={deletion.pending}
        onUndoDelete={deletion.undo}
        onConfirmDelete={deletion.confirm}
        deleteError={deletion.error}
        onDismissDeleteError={deletion.dismissError}
        onHome={() => setScreen("home")}
        onNew={newProject}
        onImport={importProject}
        onCompare={(chosen) => {
          setComparison(chosen);
          setScreen("compare");
        }}
      />,
    );
  }
  if (screen === "home" || !project) {
    return withWork(<><Onboarding key={paperLookup?.query ?? "onboarding"} initialLookup={paperLookup} onGenerate={generation.generate} onSample={() => { void openSample(); }} sampleBusy={loadingSample} onLibrary={() => setScreen("library")} libraryProjects={projects} initialTeam={initialTeam} />{generation.loading && <GenerationOverlay progress={generation.progress} onCancel={generation.cancel} />}{error && <div className="toast error-toast"><strong>{errorTitle}</strong><p>{error}</p><button onClick={() => setError(undefined)}>Close</button></div>}</>);
  }

  return withWork(
    <WorkspaceView
      project={project}
      library={projects}
      mode={mode}
      onMode={setMode}
      fileUrl={fileUrl}
      onPaperFile={(file) => setFileUrl(URL.createObjectURL(file))}
      selectedClaimId={selectedClaimId}
      onClaimSelect={setSelectedClaimId}
      warnings={warnings}
      onDismissWarnings={() => setWarnings([])}
      labJump={labJump}
      panel={panel}
      onPanel={setPanel}
      onProjectChange={changeProject}
      onRestore={restoreVersion}
      onHome={() => setScreen("home")}
      onLibrary={() => setScreen("library")}
      onNew={newProject}
      onReview={() => {
        setReviewScope(project.id);
        setScreen("review");
      }}
      onAnalysePaper={analyseFromGraph}
    />,
  );
}
