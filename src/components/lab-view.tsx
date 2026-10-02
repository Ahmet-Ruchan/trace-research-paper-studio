"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  BookMarked,
  BookOpenCheck,
  Code2,
  FlaskConical,
  Gauge,
  GraduationCap,
  Image as ImageIcon,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  NotebookPen,
  Quote,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  Star,
  TriangleAlert,
  UserCheck,
  Waypoints,
} from "lucide-react";
import type { RevisionReason } from "@/lib/project-revisions";
import type { ResearchProject } from "@/lib/schema";
import { claimHash, elementId, parseDeepLink, scrollToDeepLink } from "@/lib/deep-link";
import { foldForSearch } from "@/lib/search-text";
import { excerptAround, highlightSegments } from "@/lib/library-search";
import { PAPER_SEARCH_KINDS, searchPaper, type PaperHit } from "@/lib/paper-search";
import type { NotePlace } from "@/lib/reader-notes";
import {
  ApplicationGuideView,
  EvidenceHealthView,
  FiguresView,
  PermalinkButton,
  LanguageProvider,
  stringsFor,
  DerivationView,
  InteractiveRenderer,
  MathText,
  MisreadingsView,
  PrimerView,
  QuizView,
  StudyView,
  TermParagraphs,
} from "@/visuals";
import { EvidenceDrawer } from "./evidence-drawer";
import { ReviewPanel } from "./review-panel";
import { AskPanel } from "./ask-panel";
import type { SectionKind } from "@/lib/section-regeneration";
import { useSectionRegeneration } from "./section-regenerator";
import { LearningGenerator } from "./learning-generator";
import { LearningHealthView } from "./learning-health-view";
import { ExplainPanel } from "./explain-panel";
import { ConceptNote } from "./concept-note";
import { ConceptsView } from "./concepts-view";
import { conceptLinks } from "@/lib/concept-links";
import { readFirst } from "@/lib/reading-order";
import { missingLearningBlocks } from "@/lib/learning-generation";
import { readingDrillFor } from "@/lib/reading-drill";
import { termIndex } from "@/lib/term-index";
import { studyPath, studySummary } from "@/lib/study-path";
import { reviewCards, reviewForecast } from "@/lib/review-queue";
import { useConceptAliases, useLibraryStudy, useStudyProgress } from "./study-progress";
import { FocusRoundBar, PaperFocusOffer } from "./focus/paper-time";
import { useFocus } from "./focus/focus-provider";
import { extendReviewBlock, type ReviewBlock } from "@/lib/work-log";
import { NotesPanel, useReaderNotes } from "./reader-notes";
import { ResumeBar, scrollToSection, useReadingTracker } from "./reading-position";
import { ListenButton, ReadAloudProvider } from "./read-aloud";
import { reportSpeech } from "@/lib/read-aloud";
import { sectionMark } from "@/lib/reader-notes";
import { useUiLanguage } from "@/i18n/client";

type LabViewProps = {
  project: ResearchProject;
  fileUrl?: string;
  selectedClaimId?: string;
  onClaimSelect: (claimId?: string) => void;
  /** Verilmezse rapor bölümleri salt okunur; yeniden üretim düğmesi görünmez. */
  onProjectChange?: (project: ResearchProject, reason?: RevisionReason) => void;
  /** Alıntı denetimi için verilen PDF; içe aktarılmış projede alıntıları sayfada göstermeyi de açar. */
  onPaperFile?: (file: File) => void;
  /** Bu makalenin tekrar kartları (stüdyonun tekrar ekranı). */
  onReview?: () => void;
  /** Kütüphanedeki bütün makaleler: kavram bağları için. */
  library?: readonly ResearchProject[];
  /** Kaynaklardan önerilen bir makaleyi analiz etmek (ana ekrandaki arama). */
  onAnalysePaper?: (work: { identifier: string; title: string }) => void;
  /** Notlardan hikâyedeki bir bölüme gitmek (önizleme). */
  onShowStorySection?: (sectionId: string) => void;
  /** Dışarıdan bir bölüme gitmek (kütüphanede "Continue reading"); `nonce` her istekte değişiyor. */
  /** Başka bir yerden bir bölüme gitmek (kaldığın yer, not araması, komut paleti). */
  jump?: { section: string; reportSectionId?: string; conceptId?: string; term?: string; query?: string; nonce: number };
};

export function LabView({ project, fileUrl, selectedClaimId, onClaimSelect, onProjectChange, onPaperFile, onReview, library, onAnalysePaper, onShowStorySection, jump }: LabViewProps) {
  const notes = useReaderNotes();
  const notedClaims = useMemo(() => new Set((notes?.notes ?? []).flatMap((note) => (note.target.kind === "claim" ? [note.target.claimId] : []))), [notes?.notes]);
  const { language, t: messages } = useUiLanguage();
  const t = messages.paper.lab;
  const { claimKinds, claimStatus } = messages.paper;
  // Görsellerin etiketleri arayüzün dilinde; `locale` makalenin dili.
  const strings = stringsFor(project.language, language);
  const regeneration = useSectionRegeneration(project, onProjectChange);
  /** Öğrenme katmanı öğeleri için aynı tetikleyici; görüntüleyicide hiç çizilmiyor. */
  const regenerateButton = (kind: SectionKind, id: string, noun: "equation" | "derivation" | "concept" | "question") => regeneration.enabled ? (
    <span className="learning-regen">
      <button
        className="regen-trigger"
        onClick={() => regeneration.open({ kind, sectionId: id })}
        title={t.regenerateTitle(noun)}
      >
        <RefreshCw size={12} /> {t.regenerate}
      </button>
    </span>
  ) : null;
  // Makale içi arama (`paper-search.ts`); "/" arama kutusunu açıyor.
  const [paperQuery, setPaperQuery] = useState("");
  const paperSearch = useMemo(() => searchPaper(project, notes?.notes ?? [], paperQuery), [project, notes?.notes, paperQuery]);
  const searchInput = useRef<HTMLInputElement>(null);
  // Notlardan "Show it" ya da komut paletiyle Primer'de açılacak kavram.
  const [primerOpen, setPrimerOpen] = useState<string>();
  // Kalıcı bir bağlantıyla gelindiyse doğrudan kanıt defteri açılıyor: iddia
  // sağdaki çekmecede zaten görünür, ama bağlantıyı gönderen kişi listedeki
  // yerini de göstermek istemiştir.
  const [section, setSection] = useState(() => (selectedClaimId ? "claims" : "overview"));
  const jumpNonce = jump?.nonce;
  useEffect(() => {
    if (!jump) return;
    const open = setTimeout(() => {
      setSection(jump.section);
      if (jump.reportSectionId) setTimeout(() => scrollToSection("report", jump.reportSectionId!), 80);
      if (jump.conceptId) {
        setPrimerOpen(jump.conceptId);
        setTimeout(() => document.querySelector(`[data-note-section="${CSS.escape(sectionMark("concept", jump.conceptId!))}"]`)?.scrollIntoView({ block: "start" }), 80);
      }
      if (jump.term) setTimeout(() => document.querySelector(`[data-glossary-term="${CSS.escape(jump.term!)}"]`)?.scrollIntoView({ block: "center" }), 80);
      if (jump.query !== undefined) {
        setPaperQuery(jump.query);
        setTimeout(() => searchInput.current?.focus(), 0);
      }
    }, 0);
    return () => clearTimeout(open);
    // Yalnızca yeni bir istekte; `jump` nesnesi her çizimde aynı kalmayabilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpNonce]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      setSection("search");
      setTimeout(() => searchInput.current?.focus(), 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Bir yere gitmek: notlardaki "Show it" ve arama sonuçları. */
  function showPlace(place: NotePlace, sectionId: string) {
    if (place === "story") {
      if (onShowStorySection) return onShowStorySection(sectionId);
      setSection("study");
      return;
    }
    if (place === "concept") {
      setPrimerOpen(sectionId);
      setSection("primer");
    } else setSection("report");
    window.setTimeout(() => document.querySelector(`[data-note-section="${CSS.escape(sectionMark(place, sectionId))}"]`)?.scrollIntoView({ block: "start" }), 60);
  }

  function openHit(hit: PaperHit) {
    if (hit.kind === "claim" || (hit.kind === "note" && hit.target?.kind === "claim")) {
      setSection("claims");
      onClaimSelect(hit.kind === "claim" ? hit.id : (hit.target as { claimId: string }).claimId);
      return;
    }
    if (hit.kind === "note" && hit.target?.kind === "section") return showPlace(hit.target.place, hit.target.sectionId);
    if (hit.kind === "story" || hit.kind === "report" || hit.kind === "concept") return showPlace(hit.kind, hit.id);
    if (hit.kind === "term") {
      setSection("glossary");
      window.setTimeout(() => document.querySelector(`[data-glossary-term="${CSS.escape(hit.id)}"]`)?.scrollIntoView({ block: "center" }), 60);
    }
  }

  const reportSections = useMemo(() => (project.deepReport?.sections ?? []).map((item) => ({ id: item.id, title: item.title })), [project.deepReport]);
  const reportVoice = useMemo(() => reportSpeech(project), [project]);
  useReadingTracker(project.id, "report", reportSections, section === "report" && Boolean(onProjectChange));
  // Öğrenme katmanı eksikse (stüdyonun eski analizleri) Lab onu eklemeyi öneriyor.
  const missingLearning = onProjectChange ? missingLearningBlocks(project) : [];
  const [learningOpen, setLearningOpen] = useState(false);
  const quoteCheckInput = useRef<HTMLInputElement>(null);
  const [quoteCheck, setQuoteCheck] = useState<{ message: string; failed?: boolean }>();

  /**
   * Alıntıları PDF'e karşı denetler. İçe aktarılan ya da bir ajanın ürettiği
   * projede PDF yok, o yüzden kullanıcıdan istenir. Sunucu model çağırmaz;
   * sonuç projeye yazılır ve alıntısı bulunamayan iddialar needs-review olur.
   */
  async function checkQuotes(file: File) {
    setQuoteCheck({ message: t.quoteCheck.running });
    try {
      const form = new FormData();
      form.set("paper", file);
      form.set("evidence", JSON.stringify(project.evidence));
      const response = await fetch("/api/verify-excerpts", { method: "POST", body: form });
      const data = (await response.json().catch(() => undefined)) as
        | { excerptCheck?: ResearchProject["excerptCheck"]; downgradedIds?: string[]; error?: string }
        | undefined;
      if (!response.ok || !data?.excerptCheck) throw new Error(data?.error ?? t.quoteCheck.failed);
      const downgraded = new Set(data.downgradedIds ?? []);
      onProjectChange?.({
        ...project,
        excerptCheck: data.excerptCheck,
        evidence: {
          ...project.evidence,
          claims: project.evidence.claims.map((claim) =>
            downgraded.has(claim.id) ? { ...claim, confidence: "needs-review" as const } : claim,
          ),
        },
      }, "verify");
      onPaperFile?.(file);
      const missing = data.excerptCheck.unlocated.length;
      setQuoteCheck({
        message: missing
          ? t.quoteCheck.partlyFound(data.excerptCheck.checked - missing, data.excerptCheck.checked, downgraded.size)
          : t.quoteCheck.allFound(data.excerptCheck.checked),
      });
    } catch (caught) {
      setQuoteCheck({ failed: true, message: caught instanceof Error ? caught.message : t.quoteCheck.failed });
    }
  }
  const selectedClaim = useMemo(
    () => project.evidence.claims.find((claim) => claim.id === selectedClaimId),
    [project.evidence.claims, selectedClaimId],
  );

  /**
   * Kalıcı bir bağlantıyla gelindiyse iddiaya kaydır. Otuz iddialık bir
   * defterde vurgulanmış satır ekranın dışında kalabiliyor ve bağlantıyı açan
   * kişi hiçbir şey olmamış gibi hissediyordu. `block: "center"` çünkü
   * satırın hemen üstü ve altı bağlamın kendisi.
   *
   * YALNIZCA ilk çizimde. Her seçimde kaydırmak, listeye tıklayan kullanıcıyı
   * kendi tıkladığı satırın altından çekerdi.
   *
   * `behavior: "instant"` bilerek: bir bağlantı okuyucuyu hedefe götürmeli,
   * ona doğru uçurmamalı. Sayfa açılışında yapılan uzun bir animasyon
   * yönünü kaybettiriyor.
   */
  const arrivedAt = useRef(selectedClaimId);
  useEffect(() => {
    const id = arrivedAt.current;
    if (id) {
      arrivedAt.current = undefined;
      scrollToDeepLink({ kind: "claim", id });
    }

    // Sayfa içindeki bir iddia bağlantısına tıklamak belgeyi yeniden
    // yüklemiyor: defter açık değilse çapa görünmeyen bir satırı işaret eder.
    const onHashChange = () => {
      const link = parseDeepLink(window.location.hash);
      if (link?.kind !== "claim") return;
      setSection("claims");
      window.requestAnimationFrame(() => scrollToDeepLink(link));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Kanıttan üretilen okuma alıştırması öğrenme katmanı olmayan projede de var.
  const drill = useMemo(() => readingDrillFor(project, messages.learning.words.readingDrill), [project, messages]);
  const terms = useMemo(() => termIndex(project), [project]);
  const study = useStudyProgress(project.id);
  const studyProgress = study.state.status === "ready" ? study.state.progress : undefined;
  // Study yolunda geçen süre çalışma takvimine ve makaleye: adımlar arka arkaya geldikçe aynı oturum uzuyor.
  const { logStudyTime } = useFocus();
  const studyBlock = useRef<ReviewBlock | undefined>(undefined);
  const paperTitle = project.evidence.paper.title;
  const onStepTime = useCallback((start: number, end: number) => {
    const next = extendReviewBlock(studyBlock.current, start, end, () => `study-${start}`, Number.POSITIVE_INFINITY);
    if (!next || next === studyBlock.current) return;
    studyBlock.current = next;
    logStudyTime(next, { label: paperTitle, projectId: project.id });
  }, [logStudyTime, paperTitle, project.id]);
  // Kavram bağları: bu makalenin kavramları kütüphanenin başka makalelerinde.
  const libraryStudy = useLibraryStudy();
  // Okuyucunun "aynı kavram" dediği adlar; okunamazsa eşleşme yalnızca ada göre.
  const { map: aliases } = useConceptAliases();
  const studyByPaper = useMemo(() => {
    const study = new Map(libraryStudy ?? []);
    if (studyProgress) study.set(project.id, studyProgress);
    return study;
  }, [project.id, libraryStudy, studyProgress]);
  const links = useMemo(() => (library ? conceptLinks(project, library, studyByPaper, aliases) : []), [project, library, studyByPaper, aliases]);
  // Bu makaleden önce okunabilecekler: varsaydığını sözlüğünde tanımlayan makaleler.
  const firstReads = useMemo(() => (library ? readFirst(project, library, studyByPaper, aliases) : []), [project, library, studyByPaper, aliases]);
  const linkFor = (conceptId: string) => links.find((link) => link.conceptId === conceptId);
  const [openedAt] = useState(() => new Date().toISOString());
  const studyStatus = useMemo(() => {
    const path = studyPath(project, drill);
    const cards = studyProgress ? reviewCards([project], new Map([[project.id, studyProgress]])) : [];
    return { steps: path.steps.length, summary: studySummary(project, path, studyProgress), review: reviewForecast(cards, openedAt) };
  }, [project, drill, studyProgress, openedAt]);
  const hasPractice = Boolean(
    project.derivations?.length ||
      project.interactives?.length ||
      project.quiz ||
      project.misreadings ||
      project.applicationGuide ||
      drill,
  );

  const nav = [
    { id: "overview", label: t.nav.overview, icon: Lightbulb },
    { id: "search", label: messages.common.search, icon: Search },
    { id: "study", label: strings.tabStudy, icon: Route },
    ...(project.primer ? [{ id: "primer", label: strings.navPrimer, icon: GraduationCap }] : []),
    ...(library && project.primer ? [{ id: "concepts", label: t.nav.concepts, icon: Waypoints }] : []),
    ...(hasPractice ? [{ id: "practice", label: strings.navPractice, icon: SlidersHorizontal }] : []),
    ...(project.deepReport ? [{ id: "report", label: t.nav.deepReport, icon: BookOpenCheck }] : []),
    { id: "claims", label: t.nav.claims, icon: Quote },
    // Okuyucunun notları stüdyoda; sağlayıcı yoksa (salt okunur görünüm) sekme de yok.
    ...(notes ? [{ id: "notes", label: t.nav.notes(notes.notes.length), icon: NotebookPen }] : []),
    { id: "health", label: strings.navHealth, icon: ShieldCheck },
    // Öğrenme sağlığı düzeltmeleri yeniden üretimle yapılıyor; salt okunur görünümde yok.
    ...(onProjectChange ? [{ id: "learning", label: t.nav.learningHealth, icon: Activity }] : []),
    { id: "ask", label: t.nav.ask, icon: MessageCircleQuestion },
    // İnceleme projeyi değiştiriyor; salt okunur görünümde kuyruk gösterilmez.
    ...(onProjectChange ? [{ id: "review", label: t.nav.review, icon: UserCheck }] : []),
    { id: "method", label: t.nav.method, icon: FlaskConical },
    ...(project.technicalAppendix ? [{ id: "technical", label: t.nav.technical, icon: Code2 }] : []),
    { id: "metrics", label: t.nav.metrics, icon: Gauge },
    { id: "limits", label: t.nav.limitations, icon: TriangleAlert },
    { id: "glossary", label: t.nav.glossary, icon: BookMarked },
  ];

  return (
    <LanguageProvider language={project.language} ui={language}>
    <div className="lab-layout">
      <nav className="lab-nav" aria-label={strings.labSectionsAria}>
        <div className="lab-nav-label">{strings.paperMap}</div>
        {/* Telefonda simge şeridinin yerine: on üç simgenin hangisinin ne olduğu görünmüyordu. */}
        <label className="lab-nav-select">
          <span>{strings.paperMap}</span>
          <select value={section} onChange={(event) => setSection(event.target.value)} aria-label={t.nav.select}>
            {nav.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={section === item.id ? "active" : ""}
              // Tablette yalnızca simge görünüyor; ad üzerine gelince çıkıyor.
              title={item.label}
              onClick={() => setSection(item.id)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
        <div className="source-count">
          <span>{project.evidence.sources.length}</span>
          <small>{strings.linkedSources}</small>
        </div>
      </nav>

      <main className="lab-main">
        <header className="lab-section-header">
          <span>{project.evidence.paper.venue} · {project.evidence.paper.year}</span>
          <h1>{project.evidence.paper.title}</h1>
          <p>{project.evidence.paper.authors.join(", ")}</p>
        </header>

        {section === "overview" && (
          <div className="lab-content-stack">
            {missingLearning.length > 0 && (
              <section className="learning-offer" aria-label={t.learningOffer.aria}>
                <GraduationCap size={20} aria-hidden="true" />
                <div>
                  <strong>{t.learningOffer.title}</strong>
                  <p>{t.learningOffer.body(messages.paper.learningBlockList(missingLearning))}</p>
                </div>
                <button onClick={() => setLearningOpen(true)}><Sparkles size={14} /> {t.learningOffer.action}</button>
              </section>
            )}
            <section className="study-offer" aria-label={strings.studyHeading}>
              <Route size={20} aria-hidden="true" />
              <div>
                <strong>{strings.studyHeading}</strong>
                <p>
                  {studyProgress
                    ? studyProgress.finishedAt
                      ? t.studyOffer.finished(studyStatus.summary.checks.firstTry, studyStatus.summary.checks.answered)
                      : t.studyOffer.inProgress(studyStatus.summary.done, studyStatus.summary.total)
                    : t.studyOffer.notStarted(studyStatus.steps)}
                </p>
              </div>
              <div className="study-offer-actions">
                {onReview && studyStatus.review.due ? (
                  <button onClick={onReview}>
                    {t.studyOffer.reviewCards(studyStatus.review.due)} <ArrowRight size={14} />
                  </button>
                ) : null}
                <button
                  className={onReview && studyStatus.review.due ? "study-offer-secondary" : undefined}
                  onClick={() => setSection("study")}
                  disabled={study.state.status === "loading"}
                >
                  {studyProgress ? (studyProgress.finishedAt ? t.studyOffer.seeResults : t.studyOffer.continue) : t.studyOffer.start} <ArrowRight size={14} />
                </button>
              </div>
            </section>
            {onProjectChange ? <PaperFocusOffer project={project} /> : null}
            <section className="thesis-card">
              <span>{t.overview.coreThesis}</span>
              <blockquote>{project.evidence.thesis}</blockquote>
            </section>
            <section className="lab-block two-column-block">
              <div>
                <div className="block-title"><Lightbulb size={16} /> {t.overview.researchQuestion}</div>
                <p className="large-body">{project.evidence.researchQuestion}</p>
              </div>
              <div>
                <div className="block-title"><ListChecks size={16} /> {t.overview.plainSummary}</div>
                <p>{project.evidence.plainSummary}</p>
              </div>
            </section>
            <section className="lab-block">
              <div className="block-title"><Quote size={16} /> {t.overview.keyFindings}</div>
              <div className="finding-list">
                {project.evidence.findings.map((finding, index) => {
                  const claim = project.evidence.claims.find((item) =>
                    foldForSearch(item.statement).includes(foldForSearch(finding.slice(0, 18))),
                  ) ?? project.evidence.claims.filter((item) => item.kind === "reported-result")[index];
                  return (
                    <button key={`${finding}-${index}`} onClick={() => claim && onClaimSelect(claim.id)}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <p>{finding}</p>
                      <ArrowRight size={16} />
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Makalenin kendi şekilleri genel bakışta duruyor: "bu şey neye
                benziyor" sorusunun cevabı okuyucunun ilk aradığı şey. */}
            {project.figures?.length ? (
              <section className="lab-block">
                <div className="block-title"><ImageIcon size={16} /> {strings.figuresHeading}</div>
                <FiguresView figures={project.figures} />
              </section>
            ) : null}
          </div>
        )}

        {section === "study" && (
          <div className="lab-content-stack">
            {onProjectChange ? (
              <FocusRoundBar subject={{ label: project.evidence.paper.title, projectId: project.id }} hint={t.study.focusHint} />
            ) : null}
            {study.state.status === "loading" ? <p className="section-intro" role="status">{t.study.loading}</p> : null}
            {study.state.status === "failed" ? (
              <p className="regen-error" role="alert">{study.state.message} {t.study.nothingChanged}</p>
            ) : null}
            {study.state.status === "ready" ? (
              <StudyView
                project={project}
                drill={drill}
                initialProgress={study.state.progress}
                onSave={study.save}
                onStepTime={onStepTime}
                note={t.study.note}
                sectionExtra={(sectionId, handle) => <ExplainPanel project={project} target={{ kind: "story", sectionId }} study={handle} onClaimSelect={onClaimSelect} />}
                conceptExtra={library ? (conceptId) => <ConceptNote link={linkFor(conceptId)} /> : undefined}
              />
            ) : null}
            {study.saveError ? <p className="regen-error" role="status">{t.study.notSaved(study.saveError)}</p> : null}
          </div>
        )}

        {section === "report" && project.deepReport && (
          <div className="deep-report">
            {onProjectChange ? <ResumeBar projectId={project.id} place="report" /> : null}
            <header className="report-intro">
              <div><span>{t.report.kicker(project.deepReport.readingTime)}</span><h2>{project.deepReport.title}</h2></div>
              <p>{project.deepReport.dek}</p>
            </header>
            {regeneration.undoBar}
            <ReadAloudProvider place="report" language={project.language} sections={reportVoice}>
            <div className="report-sections">
              {project.deepReport.sections.map((item, index) => (
                <article className={`report-section report-${item.kind}`} key={item.id} data-note-section={sectionMark("report", item.id)}>
                  <header>
                    <span>
                      {String(index + 1).padStart(2, "0")} · {t.report.kinds[item.kind]}
                      {regeneration.enabled && (
                        <button
                          className="regen-trigger"
                          onClick={() => regeneration.open({ kind: "report", sectionId: item.id })}
                          title={t.regenerateTitle("section")}
                        >
                          <RefreshCw size={12} /> {t.regenerate}
                        </button>
                      )}
                    </span>
                    <h3>{item.title}</h3>
                    {onProjectChange ? <ListenButton sectionId={item.id} title={item.title} /> : null}
                    <p>{item.summary}</p>
                  </header>
                  <div className="report-analysis">
                    <TermParagraphs paragraphs={item.analysis} entries={terms} />
                  </div>
                  <footer>{item.claimIds.map((claimId) => (
                    <button key={claimId} onClick={() => onClaimSelect(claimId)}><span className={project.evidence.claims.find((claim) => claim.id === claimId)?.confidence === "verified" ? "verified-dot" : "review-dot"} /> {claimId}</button>
                  ))}</footer>
                </article>
              ))}
            </div>
            </ReadAloudProvider>
            <section className="report-questions">
              <span>{t.report.openQuestions}</span>
              <h2>{t.report.openQuestionsHeading}</h2>
              <ol>{project.deepReport.openQuestions.map((question, index) => <li key={`${question}-${index}`}><i>{String(index + 1).padStart(2, "0")}</i><p>{question}</p></li>)}</ol>
            </section>
          </div>
        )}

        {section === "claims" && (
          <section className="lab-block">
            <div className="block-heading-row">
              <div className="block-title"><Quote size={16} /> {t.claims.heading}</div>
              <span>{t.claims.verifiedCount(project.evidence.claims.filter((claim) => claim.confidence === "verified").length, project.evidence.claims.length)}</span>
            </div>
            <div className="claims-table">
              {project.evidence.claims.map((claim) => (
                <div
                  key={claim.id}
                  id={elementId({ kind: "claim", id: claim.id })}
                  className={selectedClaimId === claim.id ? "claim-row selected" : "claim-row"}
                >
                  <button onClick={() => onClaimSelect(claim.id)}>
                    <span className="claim-kind">{claimKinds.short[claim.kind]}{notedClaims.has(claim.id) ? <Star className="claim-noted" size={12} aria-label={t.claims.noted} /> : null}</span>
                    <p>{claim.statement}</p>
                    <span className={`claim-confidence ${claim.confidence}`}>
                      {claim.confidence === "verified" ? claimStatus.verified : t.claims.review}
                    </span>
                    <span className="claim-page">
                      {claim.sourceRefs[0]?.page ? messages.common.page(claim.sourceRefs[0].page) : "web"}
                    </span>
                  </button>
                  <PermalinkButton hash={claimHash(claim.id)} />
                </div>
              ))}
            </div>
          </section>
        )}

        {section === "notes" && (
          <section className="lab-block">
            <div className="block-title"><NotebookPen size={16} /> {t.notes.heading}</div>
            <NotesPanel
              project={project}
              study={study.state.status === "ready" ? { progress: study.state.progress, save: study.save } : undefined}
              onClaimSelect={(claimId) => {
                setSection("claims");
                onClaimSelect(claimId);
              }}
              onShowSection={showPlace}
            />
          </section>
        )}

        {section === "ask" && (
          <section className="lab-block">
            <div className="block-title"><MessageCircleQuestion size={16} /> {t.ask.heading}</div>
            <p className="section-intro">{t.ask.intro}</p>
            <AskPanel project={project} onClaimSelect={onClaimSelect} />
          </section>
        )}

        {section === "review" && onProjectChange && (
          <section className="lab-block">
            <div className="block-title"><UserCheck size={16} /> {t.review.heading}</div>
            <p className="section-intro">{t.review.intro}</p>
            {regeneration.undoBar}
            <ReviewPanel
              project={project}
              onProjectChange={onProjectChange}
              onClaimSelect={onClaimSelect}
              onRewrite={regeneration.enabled ? (item) => regeneration.open({ kind: item.area, sectionId: item.id }, { claimPolicy: "open" }) : undefined}
            />
          </section>
        )}

        {section === "health" && (
          <section className="lab-block">
            <div className="block-title"><ShieldCheck size={16} /> {strings.healthHeading}</div>
            <p className="section-intro">{strings.healthIntro}</p>
            {regeneration.undoBar}
            <input
              ref={quoteCheckInput}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void checkQuotes(file);
              }}
            />
            {quoteCheck && <p className={quoteCheck.failed ? "regen-error" : "health-note"} role="status">{quoteCheck.message}</p>}
            <EvidenceHealthView
              project={project}
              onClaimSelect={onClaimSelect}
              onCheckQuotes={regeneration.enabled ? () => quoteCheckInput.current?.click() : undefined}
              onStrengthen={regeneration.enabled
                ? (item) => regeneration.open({ kind: item.area, sectionId: item.id }, { goal: "strengthen" })
                : undefined}
            />
          </section>
        )}

        {section === "concepts" && library && project.primer && (
          <section className="lab-block">
            <div className="block-title"><Waypoints size={16} /> {t.concepts.heading}</div>
            <p className="section-intro">{t.concepts.intro}</p>
            <ConceptsView project={project} links={links} readFirst={firstReads} library={library} onAnalyse={onAnalysePaper} />
          </section>
        )}

        {section === "learning" && onProjectChange && (
          <section className="lab-block">
            <div className="block-title"><Activity size={16} /> {t.learning.heading}</div>
            <p className="section-intro">{t.learning.intro}</p>
            {regeneration.undoBar}
            <LearningHealthView
              project={project}
              onRewrite={regeneration.enabled ? (target, options) => regeneration.open(target, options) : undefined}
              onAddLearning={missingLearning.length ? () => setLearningOpen(true) : undefined}
              onOpenPractice={() => setSection("practice")}
            />
          </section>
        )}

        {section === "method" && (
          <section className="lab-block">
            <div className="block-title"><FlaskConical size={16} /> {t.method.heading}</div>
            <div className="method-timeline">
              {project.evidence.methods.map((method, index) => (
                <div key={`${method}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{method}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {section === "technical" && project.technicalAppendix && (
          <div className="technical-appendix">
            <header className="technical-intro">
              <span>{t.technical.kicker}</span>
              <h2>{project.technicalAppendix.title}</h2>
              <p>{project.technicalAppendix.overview}</p>
            </header>
            {regeneration.undoBar}

            {project.technicalAppendix.equations.length > 0 && <section className="technical-section">
              <div className="block-title"><Code2 size={16} /> {t.technical.equations}</div>
              <div className="technical-equations">{project.technicalAppendix.equations.map((equation) => {
                // Aynı kimliği taşıyan türetim varsa denklemin hemen altına
                // yerleşir: okuyucu formülü görüp adım adım açabilir.
                const derivation = project.derivations?.find((item) => item.equationId === equation.id);
                return (
                  <article key={equation.id}>
                    <span className="technical-equation-label" lang={project.language}>{equation.label}</span>
                    <MathText latex={equation.latex} plain={equation.expression} display />
                    <p>{equation.explanation}</p>
                    <dl>{equation.variables.map((variable) => <div key={variable.symbol}><dt>{variable.symbol}</dt><dd>{variable.meaning}</dd></div>)}</dl>
                    <TechnicalClaimLinks claimIds={equation.claimIds} project={project} onClaimSelect={onClaimSelect} />
                    {regenerateButton("equation", equation.id, "equation")}
                    {derivation ? <DerivationView derivation={derivation} action={regenerateButton("derivation", derivation.id, "derivation")} /> : null}
                  </article>
                );
              })}</div>
            </section>}

            <section className="technical-section">
              <div className="block-title"><FlaskConical size={16} /> {t.technical.algorithm}</div>
              <ol className="technical-steps">{project.technicalAppendix.algorithmSteps.map((step, index) => <li key={`${step.label}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.label}</strong><p>{step.detail}</p><TechnicalClaimLinks claimIds={step.claimIds} project={project} onClaimSelect={onClaimSelect} /></div></li>)}</ol>
            </section>

            {project.technicalAppendix.codeSketches.length > 0 && <section className="technical-section">
              <div className="block-title"><Code2 size={16} /> {t.technical.codeSketches}</div>
              <div className="code-sketches">{project.technicalAppendix.codeSketches.map((sketch) => <article key={sketch.title}><header><strong>{sketch.title}</strong><span>{sketch.language}</span></header><pre><code>{sketch.code}</code></pre><p>{sketch.explanation}</p><TechnicalClaimLinks claimIds={sketch.claimIds} project={project} onClaimSelect={onClaimSelect} /></article>)}</div>
            </section>}

            <div className="technical-bottom-grid">
              <section className="technical-section"><div className="block-title"><Gauge size={16} /> {t.technical.complexity}</div>{project.technicalAppendix.complexity.map((item) => <article className="complexity-card" key={item.operation}><span lang={project.language}>{item.operation}</span><strong>{item.cost}</strong><p>{item.context}</p><TechnicalClaimLinks claimIds={item.claimIds} project={project} onClaimSelect={onClaimSelect} /></article>)}</section>
              <section className="technical-section"><div className="block-title"><ListChecks size={16} /> {t.technical.implementationNotes}</div><ul className="implementation-notes">{project.technicalAppendix.implementationNotes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}</ul></section>
            </div>
          </div>
        )}

        {section === "metrics" && (
          <section className="lab-block">
            <div className="block-title"><Gauge size={16} /> {t.metrics.heading}</div>
            <div className="metrics-table">
              {project.evidence.metrics.map((metric) => (
                <button
                  key={metric.id}
                  onClick={() => {
                    const claim = project.evidence.claims.find((item) =>
                      item.sourceRefs.some(
                        (reference) => reference.page === metric.sourceRef.page && item.kind === "reported-result",
                      ),
                    );
                    if (claim) onClaimSelect(claim.id);
                  }}
                >
                  <span>{metric.label}</span>
                  <strong>{metric.displayValue} <small>{metric.unit}</small></strong>
                  <p>{metric.context}</p>
                  <em>{t.metrics.page(metric.sourceRef.page)}</em>
                </button>
              ))}
            </div>
          </section>
        )}

        {section === "limits" && (
          <section className="lab-block limit-block">
            <div className="block-title"><TriangleAlert size={16} /> {t.limits.heading}</div>
            <p className="section-intro">{t.limits.intro}</p>
            <ol>
              {project.evidence.limitations.map((limitation, index) => (
                <li key={`${limitation}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{limitation}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {section === "search" && (
          <section className="lab-block paper-search" aria-label={t.search.heading}>
            <div className="block-title"><Search size={16} /> {t.search.heading}</div>
            <label className="paper-search-field">
              <Search size={16} aria-hidden="true" />
              <input
                ref={searchInput}
                autoFocus
                value={paperQuery}
                onChange={(event) => setPaperQuery(event.target.value)}
                aria-label={t.search.heading}
                placeholder={t.search.placeholder}
              />
            </label>
            <p className="section-intro" role="status">
              {!paperSearch.terms.length
                ? t.search.hint
                : paperSearch.total
                  ? t.search.summary(paperSearch.total, PAPER_SEARCH_KINDS.filter((kind) => paperSearch.counts[kind]).map((kind) => ({ kind, count: paperSearch.counts[kind] })))
                  : t.search.nothing}
            </p>
            {paperSearch.hits.length ? (
              <ol className="paper-search-results">
                {paperSearch.hits.map((hit) => (
                  <li key={`${hit.kind}-${hit.id}`}>
                    <button type="button" onClick={() => openHit(hit)}>
                      <span className={`paper-hit-kind is-${hit.kind}`}>{t.search.hitLabels[hit.kind]}</span>
                      <strong>{highlightSegments(hit.title, paperSearch.terms).map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}</strong>
                      {hit.text ? (
                        <span className="paper-hit-text">
                          {highlightSegments(excerptAround(hit.text, paperSearch.terms, 220), paperSearch.terms).map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
            {paperSearch.total > paperSearch.hits.length ? <p className="section-intro">{t.search.showingFirst(paperSearch.hits.length)}</p> : null}
          </section>
        )}

        {section === "glossary" && (
          <section className="lab-block">
            <div className="block-title"><BookMarked size={16} /> {t.glossary.heading}</div>
            <div className="glossary-grid">
              {project.evidence.glossary.map((item) => (
                <article key={item.term} data-glossary-term={item.term}>
                  <h3>{item.term}</h3>
                  <p>{item.definition}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "primer" && project.primer && (
          <section className="lab-block">
            {regeneration.undoBar}
            <PrimerView
              key={primerOpen ?? "first"}
              primer={project.primer}
              initialOpenId={primerOpen}
              renderAction={(id) => regenerateButton("primer", id, "concept")}
              renderNote={library ? (id) => <ConceptNote link={linkFor(id)} /> : undefined}
            />
          </section>
        )}

        {section === "practice" && (
          <section className="lab-block">
            {regeneration.undoBar}
            {project.derivations?.length ? (
              <>
                <div className="block-title"><Sigma size={16} /> {strings.derivationsHeading}</div>
                {project.derivations.map((derivation) => (
                  <DerivationView derivation={derivation} key={derivation.id} action={regenerateButton("derivation", derivation.id, "derivation")} />
                ))}
              </>
            ) : null}

            {project.interactives?.length ? (
              <>
                <div className="block-title"><SlidersHorizontal size={16} /> {strings.interactivesHeading}</div>
                {project.interactives.map((interactive) => (
                  <InteractiveRenderer interactive={interactive} key={interactive.id} />
                ))}
              </>
            ) : null}

            {project.misreadings ? <MisreadingsView misreadings={project.misreadings} claims={project.evidence.claims} /> : null}

            {project.quiz ? <QuizView quiz={project.quiz} claims={project.evidence.claims} sections={project.story.sections} renderAction={(id) => regenerateButton("quiz", id, "question")} /> : null}

            {drill ? <QuizView quiz={drill} claims={project.evidence.claims} sections={project.story.sections} /> : null}

            {project.applicationGuide ? (
              <ApplicationGuideView guide={project.applicationGuide} />
            ) : null}
          </section>
        )}
      </main>

      <EvidenceDrawer
        claim={selectedClaim}
        review={selectedClaim ? project.claimReviews?.[selectedClaim.id] : undefined}
        evidence={project.evidence}
        fileUrl={fileUrl}
        persistent
      />
      {regeneration.panel}
      {learningOpen && onProjectChange && (
        <LearningGenerator
          project={project}
          onApply={(next) => onProjectChange(next, "learning")}
          onOpen={(block) => setSection(block === "primer" ? "primer" : "practice")}
          onClose={() => setLearningOpen(false)}
        />
      )}
    </div>
    </LanguageProvider>
  );
}

function TechnicalClaimLinks({ claimIds, project, onClaimSelect }: { claimIds: string[]; project: ResearchProject; onClaimSelect: (claimId?: string) => void }) {
  return <div className="technical-claim-links">{claimIds.map((claimId) => <button key={claimId} onClick={() => onClaimSelect(claimId)}><span className={project.evidence.claims.find((claim) => claim.id === claimId)?.confidence === "verified" ? "verified-dot" : "review-dot"} />{claimId}</button>)}</div>;
}
