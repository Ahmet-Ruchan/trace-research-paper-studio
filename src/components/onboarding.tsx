"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, BookOpen, Check, ChevronDown, Eye, EyeOff, FileText, Link2, LockKeyhole, Plus, Search, Sparkles, Upload, Users, X } from "lucide-react";
import { useUiLanguage } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";
import { uiLocale } from "@/i18n/languages";
import {
  createSingleModelTeam,
  defaultModelByProvider,
  documentTaskRoles,
  getProvider,
  localizedProvider,
  localizedTaskCatalog,
  providerCatalog,
  providerReadsDocuments,
  recommendedModelTeam,
  type GenerationTaskRole,
  type ModelAssignment,
  type ModelTeam,
  type ProviderId,
} from "@/lib/model-providers";
import { DEFAULT_LOCAL_ENDPOINT } from "@/lib/local-endpoint";
import { languageOptions, preferredLanguage, type ProjectLanguage } from "@/lib/preferred-language";
import { builtInTemplates } from "@/lib/narrative-templates";
import { modelRecord } from "@/lib/model-record";
import { readSetupPreferences, serializeSetupPreferences, writeSetupPreferences } from "@/lib/setup-preferences";
import type { NarrativeTemplate, ResearchProject } from "@/lib/schema";
import { deleteTemplate, listTemplates } from "@/lib/template-library";
import { downloadCandidate, findPapers, originLabels, type PaperCandidate } from "@/lib/paper-lookup";
import { QuoteTrackRecord } from "./model-record-view";
import { TeamProbe } from "./team-probe";
import { DisplayControl } from "./display-control";
import { TemplateEditor } from "./template-editor";
import { StudioNav } from "./focus/studio-nav";

export type GenerationOptions = {
  file: File;
  sources: string[];
  apiKeys: Partial<Record<ProviderId, string>>;
  assignments: ModelTeam;
  language: string;
  audience: "general" | "student" | "expert";
  depth: "concise" | "standard" | "deep";
  template?: NarrativeTemplate;
};

/** Tarayıcı dili oturum boyunca değişmez; abone olunacak bir olay yok. */
const subscribeNever = () => () => {};
const readBrowserLanguage = () => preferredLanguage();
const readServerLanguage = (): ProjectLanguage => "en";

/**
 * Analiz dilinin seçicisi arayüzün dilinde: adlar `Intl.DisplayNames` ile o
 * dilde yazılıp o dilin sırasıyla diziliyor ("Almanca", "İngilizce" …).
 */
function languageChoicesIn(choices: Array<{ tag: string; label: string }>, locale: string) {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([locale], { type: "language" });
  } catch {
    return choices;
  }
  const named = choices.map((choice) => {
    let label = choice.label;
    try {
      label = names.of(choice.tag) ?? choice.label;
    } catch {
      // Tanınmayan etiket: İngilizce ad (ya da etiketin kendisi) kalıyor.
    }
    return { tag: choice.tag, label };
  });
  return named.sort((a, b) => a.label.localeCompare(b.label, locale));
}

/** Hazır şablonun ekrandaki adı ve açıklaması arayüzün dilinde; şablonun kendisi (istem) değişmiyor. */
function templateText(template: NarrativeTemplate, t: Messages["studio"]["templates"]) {
  const shown = template.builtIn ? t.builtIn[template.id] : undefined;
  return { name: shown?.name ?? template.name, description: shown?.description ?? template.description };
}

type OnboardingProps = {
  onGenerate: (options: GenerationOptions) => void;
  onSample: () => void;
  sampleBusy?: boolean;
  onLibrary: () => void;
  /** Kütüphane; sayısı başlıkta, alıntı karnesi model seçiminin altında. */
  libraryProjects: ResearchProject[];
  initialTeam?: boolean;
  /** Atıf grafiğinden "bunu analiz et" ile gelindiğinde aranacak makale. */
  initialLookup?: { query: string; expectTitle?: string };
};

export function Onboarding({ onGenerate, onSample, onLibrary, libraryProjects, initialTeam = false, sampleBusy = false, initialLookup }: OnboardingProps) {
  const { language: uiLanguage, t: messages } = useUiLanguage();
  const t = messages.studio.onboarding;
  const providerWords = messages.studio.models.providers;
  const taskCatalog = useMemo(() => localizedTaskCatalog(providerWords), [providerWords]);
  const providerOptions = useMemo(() => providerCatalog.map((item) => localizedProvider(item, providerWords)), [providerWords]);
  const libraryCount = libraryProjects.length;
  const quoteRecord = useMemo(() => modelRecord(libraryProjects), [libraryProjects]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [dragging, setDragging] = useState(false);
  const [lookup, setLookup] = useState(initialLookup?.query ?? "");
  const [lookupBusy, setLookupBusy] = useState<"search" | "download">();
  const [candidates, setCandidates] = useState<PaperCandidate[]>();
  const [sourceInput, setSourceInput] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [apiKeys, setApiKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [visibleKeys, setVisibleKeys] = useState<Partial<Record<ProviderId, boolean>>>({});
  // Çıktının dili kullanıcıdan gelir; başlangıçta tarayıcı dili öneriliyor.
  // Sunucuda `navigator` yok, o yüzden değer doğrudan başlangıç durumu olarak
  // okunamaz: sunucu "en" çizerken istemci "tr" çizer ve hydration ayrışır.
  // `useSyncExternalStore` iki tarafa ayrı anlık görüntü vermenin React'teki
  // yolu. Kullanıcı seçimi bunu geçersiz kılar.
  const detectedLanguage = useSyncExternalStore(subscribeNever, readBrowserLanguage, readServerLanguage);
  // Son analizin seçimleri bu tarayıcıda hatırlanıyor (anahtarlar hariç).
  // Bileşen yalnızca istemcide, açılıştan sonra çiziliyor; ilk durum doğrudan
  // depodan okunabiliyor.
  const [remembered] = useState(readSetupPreferences);
  const [chosenLanguage, setLanguage] = useState<ProjectLanguage | undefined>(remembered.language);
  const language = chosenLanguage ?? detectedLanguage;
  // Liste kullanıcının kendi dilini de içerir; yaygın diller yalnızca kısayol.
  const languageChoices = useMemo(
    () => languageChoicesIn(languageOptions(detectedLanguage, remembered.language), uiLocale(uiLanguage)),
    [detectedLanguage, remembered.language, uiLanguage],
  );
  const [audience, setAudience] = useState<"general" | "student" | "expert">(remembered.audience ?? "student");
  const [depth, setDepth] = useState<"concise" | "standard" | "deep">(remembered.depth ?? "standard");
  const [provider, setProvider] = useState<ProviderId>(remembered.single?.provider ?? "gemini");
  const [model, setModel] = useState(remembered.single?.model ?? defaultModelByProvider.gemini);
  const [orchestration, setOrchestration] = useState<"single" | "team">(initialTeam ? "team" : remembered.orchestration ?? "single");
  const [team, setTeam] = useState<ModelTeam>(() => structuredClone(remembered.team ?? recommendedModelTeam));
  const [openRouterModels, setOpenRouterModels] = useState<Array<{ id: string; label: string; contextLength?: number }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [templates, setTemplates] = useState<NarrativeTemplate[]>(() => [...builtInTemplates]);
  const [templateId, setTemplateId] = useState(remembered.templateId ?? "");
  const [editing, setEditing] = useState<{ template: NarrativeTemplate; copy: boolean }>();
  // Hatırlanan şablon silinmiş olabilir ya da kayıtlı şablonlar henüz
  // gelmemiş olabilir: listede olmayan bir kimlik "şablon yok" sayılıyor.
  const template = templates.find((item) => item.id === templateId);
  const selectedTemplateId = template?.id ?? "";
  const [moreOpen, setMoreOpen] = useState(Boolean(remembered.templateId));

  // Seçimler değiştikçe yazılıyor. Açılışta hiçbir şey yazılmıyor: bağlantıyla
  // gelen "model ekibi" (initialTeam) kullanıcının seçimi değil.
  const setup = useMemo(
    () => ({ audience, depth, language: chosenLanguage, single: { provider, model }, orchestration, team, templateId: templateId || undefined }),
    [audience, depth, chosenLanguage, provider, model, orchestration, team, templateId],
  );
  const [openingSetup] = useState(() => serializeSetupPreferences(setup));
  const setupChanged = useRef(false);
  useEffect(() => {
    if (!setupChanged.current && serializeSetupPreferences(setup) === openingSetup) return;
    setupChanged.current = true;
    writeSetupPreferences(setup);
  }, [setup, openingSetup]);

  // Kaydedilmiş şablonlar sunucudan geliyor; ulaşılamazsa hazır şablonlar yine seçilebilir.
  useEffect(() => {
    let active = true;
    listTemplates().then((items) => { if (active) setTemplates(items); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function removeTemplate(id: string) {
    try {
      await deleteTemplate(id);
      setTemplates((current) => current.filter((item) => item.id !== id));
      setTemplateId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.errors.templateNotRemoved);
    }
  }
  const assignments = orchestration === "single"
    ? createSingleModelTeam({ provider, model })
    : team;
  const usedProviders = providerOptions.filter((item) =>
    Object.values(assignments).some((assignment) => assignment.provider === item.id),
  );

  function acceptFile(nextFile?: File) {
    setError(undefined);
    if (!nextFile) return;
    if (nextFile.type !== "application/pdf") {
      setError(t.errors.onlyPdf);
      return;
    }
    if (nextFile.size > 35 * 1024 * 1024) {
      setError(t.errors.tooLarge);
      return;
    }
    setFile(nextFile);
  }

  /**
   * PDF'i olmayan kullanıcı: başlık, DOI, arXiv kimliği ya da depo bağlantısı.
   * Tek ve indirilebilir bir aday varsa doğrudan alınır; birden çok aday
   * varsa seçim kullanıcıya bırakılır — yanlış makaleyi analiz etmek,
   * bir tık fazladan çok daha pahalı.
   */
  async function runLookup(query = lookup, expectTitle?: string) {
    const value = query.trim();
    if (value.length < 3) return setError(t.errors.lookupTooShort);
    setError(undefined);
    setCandidates(undefined);
    setLookupBusy("search");
    try {
      const found = await findPapers(value, expectTitle);
      if (!found.length) throw new Error(t.errors.notFound);
      if (found.length === 1 && found[0].pdfUrls.length) return await takeCandidate(found[0]);
      setCandidates(found);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.errors.lookupFailed);
    } finally {
      setLookupBusy(undefined);
    }
  }

  async function takeCandidate(candidate: PaperCandidate) {
    setError(undefined);
    setLookupBusy("download");
    try {
      acceptFile(await downloadCandidate(candidate));
      setCandidates(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.errors.downloadFailed);
    } finally {
      setLookupBusy(undefined);
    }
  }

  // Atıf grafiğinden gelen istek sayfa açılır açılmaz aranır.
  const ranInitialLookup = useRef(false);
  useEffect(() => {
    if (!initialLookup || ranInitialLookup.current) return;
    ranInitialLookup.current = true;
    const timer = window.setTimeout(() => { void runLookup(initialLookup.query, initialLookup.expectTitle); }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLookup]);

  function addSource() {
    const value = sourceInput.trim();
    if (!value) return;
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      if (sources.length >= 3) {
        setError(t.errors.tooManySources);
        return;
      }
      setSources((current) => [...current, url.toString()]);
      setSourceInput("");
      setError(undefined);
    } catch {
      setError(t.errors.badSource);
    }
  }

  function submit() {
    if (!file) return setError(t.errors.needPdf);
    // Yerel sağlayıcıda "anahtar" bir adres ve boş bırakılabilir: boşsa
    // sunucu tarafı Ollama'nın varsayılan adresini kullanıyor.
    const missingProvider = usedProviders.find((item) => !item.local && !apiKeys[item.id]?.trim());
    if (missingProvider) return setError(t.errors.needsKey(missingProvider.label, missingProvider.keyLabel));
    const unreadable = documentTaskRoles.find((role) => !providerReadsDocuments(assignments[role].provider));
    if (unreadable) {
      const task = taskCatalog.find((item) => item.id === unreadable);
      const unreadableProvider = getProvider(assignments[unreadable].provider);
      return setError(t.errors.cannotReadPdf(unreadableProvider ? localizedProvider(unreadableProvider, providerWords).label : assignments[unreadable].provider, task?.shortLabel ?? unreadable));
    }
    const invalidAssignment = Object.entries(assignments).find(([, assignment]) => !assignment.model.trim());
    if (invalidAssignment) return setError(t.errors.needsModel(taskCatalog.find((task) => task.id === invalidAssignment[0])?.label ?? t.errors.task));
    setError(undefined);
    onGenerate({
      file,
      sources,
      apiKeys: Object.fromEntries(Object.entries(apiKeys).map(([id, key]) => [id, key?.trim()])),
      assignments,
      language,
      audience,
      depth,
      template,
    });
  }

  function changeProvider(nextProvider: ProviderId) {
    setProvider(nextProvider);
    setModel(defaultModelByProvider[nextProvider]);
    setError(undefined);
  }

  function updateTeamAssignment(role: GenerationTaskRole, assignment: ModelAssignment) {
    setTeam((current) => ({ ...current, [role]: assignment }));
  }

  async function loadOpenRouterModels() {
    const openRouterKey = apiKeys.openrouter?.trim();
    if (!openRouterKey) return setError(t.errors.needOpenRouterKey);
    setModelsLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/models/openrouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: openRouterKey }),
      });
      const data = await response.json() as { models?: typeof openRouterModels; error?: string };
      if (!response.ok || !data.models) throw new Error(data.error ?? t.errors.catalogueFailed);
      setOpenRouterModels(data.models);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.errors.catalogueFailed);
    } finally {
      setModelsLoading(false);
    }
  }

  return (
    <main className="onboarding-page">
      <header className="landing-header">
        <a className="brand" href="#top" aria-label={messages.studio.brand.home}>
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>{messages.studio.brand.tagline}</small></span>
        </a>
        <div className="landing-header-actions">
          <DisplayControl />
          <button className="text-button" onClick={onLibrary}><BookOpen size={15} /> {t.library} <span className="nav-count">{libraryCount}</span></button>
          <button className="text-button" onClick={onSample} disabled={sampleBusy}>{sampleBusy ? t.loadingExample : t.openExample} <ArrowRight size={15} /></button>
          <StudioNav />
        </div>
      </header>

      <section className="landing-hero" id="top">
        <div className="landing-copy">
          <p className="landing-eyebrow"><span /> {t.eyebrow}</p>
          <h1>{t.headlineStart}<em>{t.headlineEmphasis}</em>{t.headlineEnd}</h1>
          <p className="landing-lead">{t.lead}</p>
          <div className="principle-row">
            <span><Check size={14} /> {t.principles.sourceLinked}</span>
            <span><Check size={14} /> {t.principles.editable}</span>
            <span><Check size={14} /> {t.principles.staticExport}</span>
          </div>
        </div>

        <div className="ingest-panel">
          <div className="panel-heading">
            <div><span>01</span><strong>{t.addPaper}</strong></div>
            <small>{t.pdfLimit}</small>
          </div>

          <div
            className={`drop-zone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              acceptFile(event.dataTransfer.files[0]);
            }}
          >
            <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={(event) => acceptFile(event.target.files?.[0])} />
            {file ? (
              <>
                <span className="file-icon"><FileText size={22} /></span>
                <div className="file-copy"><strong>{file.name}</strong><small>{t.fileReady(file.size / 1024 / 1024)}</small></div>
                <button className="icon-button" onClick={() => setFile(undefined)} aria-label={t.removePdf}><X size={17} /></button>
              </>
            ) : (
              <>
                <span className="upload-icon"><Upload size={21} /></span>
                <div><strong>{t.dropHere}</strong><small>{t.orPick}</small></div>
                <button onClick={() => inputRef.current?.click()}>{t.chooseFile}</button>
              </>
            )}
          </div>

          {!file && (
            <div className="paper-finder">
              <div className="input-with-icon">
                <Search size={16} />
                <input
                  value={lookup}
                  onChange={(event) => setLookup(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && !lookupBusy && void runLookup()}
                  placeholder={t.finderPlaceholder}
                  aria-label={t.finderLabel}
                />
                <button onClick={() => { void runLookup(); }} disabled={Boolean(lookupBusy)} aria-label={t.findPaper}><ArrowRight size={16} /></button>
              </div>
              {lookupBusy && <p className="paper-finder-status">{lookupBusy === "search" ? t.searching : t.downloading}</p>}
              {candidates && (
                <ul className="paper-candidates">
                  {candidates.map((candidate, index) => (
                    <li key={`${candidate.origin}-${candidate.title}-${index}`}>
                      <div>
                        <strong>{candidate.title}</strong>
                        <small>
                          {[candidate.authors.slice(0, 3).join(", "), candidate.year, candidate.venue, originLabels[candidate.origin] ?? candidate.origin].filter(Boolean).join(" · ")}
                        </small>
                        {!candidate.pdfUrls.length && (
                          <small className="paper-candidate-note">
                            {t.noOpenCopy}{" "}
                            {(candidate.blockedPdfUrls[0] ?? candidate.url) && <a href={candidate.blockedPdfUrls[0] ?? candidate.url} target="_blank" rel="noreferrer">{t.getItYourself}</a>}{t.dropAbove}
                          </small>
                        )}
                      </div>
                      <button disabled={!candidate.pdfUrls.length || Boolean(lookupBusy)} onClick={() => { void takeCandidate(candidate); }}>{t.useThis}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="config-grid">
            <label>{t.reader}<select value={audience} onChange={(event) => setAudience(event.target.value as typeof audience)}><option value="general">{t.audiences.general}</option><option value="student">{t.audiences.student}</option><option value="expert">{t.audiences.expert}</option></select></label>
            <label>{t.depth}<select value={depth} onChange={(event) => setDepth(event.target.value as typeof depth)}><option value="concise">{t.depths.concise}</option><option value="standard">{t.depths.standard}</option><option value="deep">{t.depths.deep}</option></select></label>
            <label>{t.language}<select value={language} onChange={(event) => setLanguage(event.target.value)}>{languageChoices.map((choice) => <option key={choice.tag} value={choice.tag}>{choice.label}</option>)}</select></label>
          </div>

          {/* Çoğu analizde gerekmeyen seçimler kapalı başlıyor; biri seçiliyse
              (ya da hatırlanıyorsa) açık, özet satırı da ne seçildiğini söylüyor. */}
          <details className="setup-more" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
            <summary>
              <span>{t.moreOptions}</span>
              <small>{[
                t.supportingSources(sources.length),
                template ? templateText(template, messages.studio.templates).name : t.narrativeTemplateShort,
              ].join(" · ")}</small>
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <div className="source-entry">
              <div className="input-with-icon">
                <Link2 size={16} />
                <input value={sourceInput} onChange={(event) => setSourceInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addSource()} placeholder={t.sourcePlaceholder} />
                <button onClick={addSource} aria-label={t.addSource}><Plus size={16} /></button>
              </div>
              {sources.map((source) => (
                <div className="source-chip" key={source}>
                  <span>{new URL(source).hostname}</span>
                  <button onClick={() => setSources((current) => current.filter((item) => item !== source))} aria-label={t.removeSource(new URL(source).hostname)}><X size={13} /></button>
                </div>
              ))}
            </div>

            <div className="config-grid">
              <label className="template-field">
                {t.narrativeTemplate}
                <select value={selectedTemplateId} onChange={(event) => setTemplateId(event.target.value)}>
                  <option value="">{t.noTemplate}</option>
                  {templates.map((item) => (
                    <option key={item.id} value={item.id}>{t.templateOption(templateText(item, messages.studio.templates).name, Boolean(item.builtIn), item.story.length)}</option>
                  ))}
                </select>
              </label>
            </div>
            {template && (
              <p className="template-note">
                <span>{templateText(template, messages.studio.templates).description || t.savedFrom(template.source?.title)}</span>
                <span>
                  {t.templateSets(template.story.length, template.report?.length)}
                  {template.builtIn
                    ? <button onClick={() => setEditing({ template, copy: true })}>{t.customizeCopy}</button>
                    : (
                      <>
                        <button onClick={() => setEditing({ template, copy: false })}>{t.editTemplate}</button>
                        <button onClick={() => { void removeTemplate(template.id); }}>{t.removeTemplate}</button>
                      </>
                    )}
                </span>
              </p>
            )}
          </details>

          <section className="orchestration-config">
            <div className="orchestration-heading">
              <div><Sparkles size={15} /><span>{t.orchestration}</span></div>
              <div className="orchestration-toggle">
                <button className={orchestration === "single" ? "active" : ""} onClick={() => setOrchestration("single")}>{t.singleModel}</button>
                <button className={orchestration === "team" ? "active" : ""} onClick={() => setOrchestration("team")}><Users size={13} /> {t.modelTeam}</button>
              </div>
            </div>

            {orchestration === "single" ? (
              <div className="single-model-row">
                <div className="model-select provider-select"><select aria-label={t.modelProvider} value={provider} onChange={(event) => changeProvider(event.target.value as ProviderId)}>{providerOptions.map((item) => (
                  /* Tek model dört işi birden yapıyor; biri makaleyi okumak.
                     PDF'i alamayan sağlayıcı burada seçilemez — ama model
                     ekibinde yazı ve görsel işlerine atanabilir. */
                  <option key={item.id} value={item.id} disabled={!providerReadsDocuments(item.id)}>
                    {item.label}{!providerReadsDocuments(item.id) ? t.teamOnly : item.readsPaperAsText ? t.readsAsText : ""}
                  </option>
                ))}</select></div>
                <ModelPicker assignment={{ provider, model }} onChange={(assignment) => { setProvider(assignment.provider); setModel(assignment.model); }} openRouterModels={openRouterModels} inputId="single" />
                <p>{t.runsAll}</p>
              </div>
            ) : (
              <>
                <div className="team-preset-row">
                  <div><strong>{t.taskAssignment}</strong><span>{t.taskAssignmentNote}</span></div>
                  <button onClick={() => setTeam(structuredClone(recommendedModelTeam))}>{t.recommendedTeam}</button>
                </div>
                <div className="task-assignment-grid">
                  {taskCatalog.map((task, index) => (
                    <article className="task-assignment-card" key={task.id}>
                      <header><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{task.label}</strong><small>{task.recommendation}</small></div></header>
                      <p>{task.description}</p>
                      <div className="task-model-controls">
                        <select aria-label={t.taskProvider(task.label)} value={team[task.id].provider} onChange={(event) => {
                          const nextProvider = event.target.value as ProviderId;
                          updateTeamAssignment(task.id, { provider: nextProvider, model: defaultModelByProvider[nextProvider] });
                        }}>{providerOptions.map((item) => {
                          const needsDocument = documentTaskRoles.includes(task.id);
                          const blocked = needsDocument && !providerReadsDocuments(item.id);
                          const asText = needsDocument && item.readsPaperAsText;
                          return (
                            <option key={item.id} value={item.id} disabled={blocked}>
                              {item.label}{blocked ? t.cannotReadPdf : asText ? t.readsAsText : ""}
                            </option>
                          );
                        })}</select>
                        <ModelPicker assignment={team[task.id]} onChange={(assignment) => updateTeamAssignment(task.id, assignment)} openRouterModels={openRouterModels} inputId={task.id} compact />
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}

            {libraryCount > 0 && <QuoteTrackRecord assignments={assignments} record={quoteRecord} />}

            <div className="credential-heading"><LockKeyhole size={14} /><div><strong>{t.keysHeading}</strong><span>{t.keysNote}</span></div></div>
            <div className="credential-grid">
              {usedProviders.map((item) => (
                /* Yerel sunucuda gizlenecek bir sır yok: istenen şey adres.
                   Onu yıldızlarla göstermek, kullanıcıyı yazdığını kontrol
                   edemez hâle getirmekten başka bir işe yaramaz. */
                item.local ? (
                  <label className="key-input" key={item.id}>
                    <span>{item.label}</span>
                    <input type="text" value={apiKeys[item.id] ?? ""} onChange={(event) => setApiKeys((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={DEFAULT_LOCAL_ENDPOINT} autoComplete="off" spellCheck={false} />
                  </label>
                ) : (
                <label className="key-input" key={item.id}>
                  <span>{item.label}</span>
                  <input type={visibleKeys[item.id] ? "text" : "password"} value={apiKeys[item.id] ?? ""} onChange={(event) => setApiKeys((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={item.keyLabel} autoComplete="off" />
                  <button type="button" onClick={() => setVisibleKeys((current) => ({ ...current, [item.id]: !current[item.id] }))} aria-label={t.toggleKey(item.label)}>{visibleKeys[item.id] ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                </label>
                )
              ))}
            </div>
            {usedProviders.filter((item) => item.hint).map((item) => (
              <p className="provider-hint" key={item.id}><strong>{item.label}.</strong> {item.hint}</p>
            ))}
            {usedProviders.some((item) => item.id === "openrouter") && <div className="openrouter-catalog-row"><span>{t.catalogueBefore}<code>{t.catalogueFilter}</code>{t.catalogueAfter}</span><button onClick={loadOpenRouterModels} disabled={modelsLoading}>{modelsLoading ? messages.common.loading : t.loadModels}</button></div>}
            <TeamProbe assignments={assignments} apiKeys={apiKeys} depth={depth} template={template} />
            <p className="key-note">{t.keyNote}</p>
          </section>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-action" onClick={submit}>{t.analyse} <ArrowRight size={17} /></button>
        </div>
      </section>

      {editing && (
        <TemplateEditor
          initial={editing.copy ? { ...editing.template, description: templateText(editing.template, messages.studio.templates).description } : editing.template}
          initialName={editing.copy ? t.copyName(templateText(editing.template, messages.studio.templates).name) : editing.template.name}
          mode={editing.copy ? "create" : "edit"}
          heading={editing.copy ? t.customizeHeading(templateText(editing.template, messages.studio.templates).name) : t.editHeading(editing.template.name)}
          intro={editing.copy ? t.copyIntro : t.editIntro}
          onSaved={(saved) => {
            setTemplates((current) => [...current.filter((item) => item.id !== saved.id), saved]);
            setTemplateId(saved.id);
          }}
          onClose={() => setEditing(undefined)}
        />
      )}

      <section className="landing-proof"><span>PDF</span><i /><span>{t.proof.evidenceGraph}</span><i /><span>{t.proof.storySpec}</span><i /><span>{t.proof.interactiveWeb}</span></section>
    </main>
  );
}

function ModelPicker({
  assignment,
  onChange,
  openRouterModels,
  inputId,
  compact = false,
}: {
  assignment: ModelAssignment;
  onChange: (assignment: ModelAssignment) => void;
  openRouterModels: Array<{ id: string; label: string; contextLength?: number }>;
  inputId: string;
  compact?: boolean;
}) {
  const messages = useUiLanguage().t;
  const t = messages.studio.onboarding;
  const provider = localizedProvider(getProvider(assignment.provider)!, messages.studio.models.providers);
  if (assignment.provider === "openrouter") {
    const listId = `openrouter-models-${inputId}`;
    return (
      <div className={`model-select openrouter-model-select ${compact ? "compact" : ""}`}>
        <input aria-label={t.openRouterModelId} list={listId} value={assignment.model} onChange={(event) => onChange({ ...assignment, model: event.target.value })} placeholder={t.openRouterPlaceholder} />
        <datalist id={listId}>{openRouterModels.map((item) => <option key={item.id} value={item.id}>{item.label}{item.contextLength ? ` · ${Math.round(item.contextLength / 1000)}k` : ""}</option>)}</datalist>
      </div>
    );
  }
  if (provider.freeformModel) {
    /* Kullanıcının makinesinde hangi modellerin yüklü olduğunu bilemeyiz:
       adı serbest yazılıyor, katalogdaki isimler yalnızca öneri. Yanlış ad
       yazılırsa sunucu isteğin başında yüklü modelleri listeleyerek söylüyor. */
    const listId = `${provider.id}-models-${inputId}`;
    return (
      <div className={`model-select openrouter-model-select ${compact ? "compact" : ""}`}>
        <input aria-label={t.modelName(provider.label)} list={listId} value={assignment.model} onChange={(event) => onChange({ ...assignment, model: event.target.value })} placeholder={t.modelNamePlaceholder} spellCheck={false} />
        <datalist id={listId}>{provider.models.map((item) => <option key={item.id} value={item.id}>{item.note}</option>)}</datalist>
      </div>
    );
  }
  return (
    <div className={`model-select ${compact ? "compact" : ""}`}>
      <select aria-label={t.modelSelect(provider.label)} value={assignment.model} onChange={(event) => onChange({ ...assignment, model: event.target.value })}>{provider.models.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.note}</option>)}</select>
    </div>
  );
}
