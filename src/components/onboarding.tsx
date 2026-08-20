"use client";

import { useRef, useState } from "react";
import { ArrowRight, BookOpen, Check, Eye, EyeOff, FileText, Link2, LockKeyhole, Plus, Sparkles, Upload, Users, X } from "lucide-react";
import {
  createSingleModelTeam,
  defaultModelByProvider,
  generationTaskCatalog,
  getProvider,
  providerCatalog,
  recommendedModelTeam,
  type GenerationTaskRole,
  type ModelAssignment,
  type ModelTeam,
  type ProviderId,
} from "@/lib/model-providers";

export type GenerationOptions = {
  file: File;
  sources: string[];
  apiKeys: Partial<Record<ProviderId, string>>;
  assignments: ModelTeam;
  language: "tr" | "en";
  audience: "general" | "student" | "expert";
  depth: "concise" | "standard" | "deep";
};

type OnboardingProps = {
  onGenerate: (options: GenerationOptions) => void;
  onSample: () => void;
  sampleBusy?: boolean;
  onLibrary: () => void;
  libraryCount: number;
  initialTeam?: boolean;
};

export function Onboarding({ onGenerate, onSample, onLibrary, libraryCount, initialTeam = false, sampleBusy = false }: OnboardingProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [dragging, setDragging] = useState(false);
  const [sourceInput, setSourceInput] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [apiKeys, setApiKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [visibleKeys, setVisibleKeys] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [language, setLanguage] = useState<"tr" | "en">("tr");
  const [audience, setAudience] = useState<"general" | "student" | "expert">("student");
  const [depth, setDepth] = useState<"concise" | "standard" | "deep">("standard");
  const [provider, setProvider] = useState<ProviderId>("gemini");
  const [model, setModel] = useState(defaultModelByProvider.gemini);
  const [orchestration, setOrchestration] = useState<"single" | "team">(initialTeam ? "team" : "single");
  const [team, setTeam] = useState<ModelTeam>(() => structuredClone(recommendedModelTeam));
  const [openRouterModels, setOpenRouterModels] = useState<Array<{ id: string; label: string; contextLength?: number }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const assignments = orchestration === "single"
    ? createSingleModelTeam({ provider, model })
    : team;
  const usedProviders = providerCatalog.filter((item) =>
    Object.values(assignments).some((assignment) => assignment.provider === item.id),
  );

  function acceptFile(nextFile?: File) {
    setError(undefined);
    if (!nextFile) return;
    if (nextFile.type !== "application/pdf") {
      setError("Yalnızca PDF dosyası yükleyebilirsin.");
      return;
    }
    if (nextFile.size > 35 * 1024 * 1024) {
      setError("PDF 35 MB sınırını aşıyor.");
      return;
    }
    setFile(nextFile);
  }

  function addSource() {
    const value = sourceInput.trim();
    if (!value) return;
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      if (sources.length >= 3) {
        setError("MVP’de en fazla 3 yardımcı kaynak ekleyebilirsin.");
        return;
      }
      setSources((current) => [...current, url.toString()]);
      setSourceInput("");
      setError(undefined);
    } catch {
      setError("Geçerli bir HTTP veya HTTPS adresi gir.");
    }
  }

  function submit() {
    if (!file) return setError("Önce bir paper PDF’i yükle.");
    const missingProvider = usedProviders.find((item) => !apiKeys[item.id]?.trim());
    if (missingProvider) return setError(`${missingProvider.label} için ${missingProvider.keyLabel} gerekli.`);
    const invalidAssignment = Object.entries(assignments).find(([, assignment]) => !assignment.model.trim());
    if (invalidAssignment) return setError(`${generationTaskCatalog.find((task) => task.id === invalidAssignment[0])?.label ?? "Görev"} için model seç.`);
    setError(undefined);
    onGenerate({
      file,
      sources,
      apiKeys: Object.fromEntries(Object.entries(apiKeys).map(([id, key]) => [id, key?.trim()])),
      assignments,
      language,
      audience,
      depth,
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
    if (!openRouterKey) return setError("Model kataloğu için önce OpenRouter API key’ini gir.");
    setModelsLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/models/openrouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: openRouterKey }),
      });
      const data = await response.json() as { models?: typeof openRouterModels; error?: string };
      if (!response.ok || !data.models) throw new Error(data.error ?? "Model kataloğu alınamadı.");
      setOpenRouterModels(data.models);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Model kataloğu alınamadı.");
    } finally {
      setModelsLoading(false);
    }
  }

  return (
    <main className="onboarding-page">
      <header className="landing-header">
        <a className="brand" href="#top" aria-label="Trace ana sayfa">
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>research studio</small></span>
        </a>
        <div className="landing-header-actions">
          <button className="text-button" onClick={onLibrary}><BookOpen size={15} /> Kütüphane <span className="nav-count">{libraryCount}</span></button>
          <button className="text-button" onClick={onSample} disabled={sampleBusy}>{sampleBusy ? "Örnek yükleniyor…" : "Örnek projeyi aç"} <ArrowRight size={15} /></button>
        </div>
      </header>

      <section className="landing-hero" id="top">
        <div className="landing-copy">
          <p className="landing-eyebrow"><span /> Evidence-first paper studio</p>
          <h1>Bir paper’ı okumak başka, <em>gerçekten görmek</em> başka.</h1>
          <p className="landing-lead">
            PDF’ini kanıtlarına ayır, yöntemini incele ve her iddiası kaynağına bağlı interaktif bir web anlatısına dönüştür.
          </p>
          <div className="principle-row">
            <span><Check size={14} /> Kaynak bağlı</span>
            <span><Check size={14} /> Düzenlenebilir</span>
            <span><Check size={14} /> Statik export</span>
          </div>
        </div>

        <div className="ingest-panel">
          <div className="panel-heading">
            <div><span>01</span><strong>Paper’ını ekle</strong></div>
            <small>PDF · maks. 35 MB</small>
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
                <div className="file-copy"><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB · PDF hazır</small></div>
                <button className="icon-button" onClick={() => setFile(undefined)} aria-label="PDF’i kaldır"><X size={17} /></button>
              </>
            ) : (
              <>
                <span className="upload-icon"><Upload size={21} /></span>
                <div><strong>PDF’i buraya bırak</strong><small>veya bilgisayarından seç</small></div>
                <button onClick={() => inputRef.current?.click()}>Dosya seç</button>
              </>
            )}
          </div>

          <div className="source-entry">
            <div className="input-with-icon">
              <Link2 size={16} />
              <input value={sourceInput} onChange={(event) => setSourceInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addSource()} placeholder="Opsiyonel kaynak URL’si" />
              <button onClick={addSource} aria-label="Kaynak ekle"><Plus size={16} /></button>
            </div>
            {sources.map((source) => (
              <div className="source-chip" key={source}>
                <span>{new URL(source).hostname}</span>
                <button onClick={() => setSources((current) => current.filter((item) => item !== source))}><X size={13} /></button>
              </div>
            ))}
          </div>

          <div className="config-grid">
            <label>Okuyucu<select value={audience} onChange={(event) => setAudience(event.target.value as typeof audience)}><option value="general">Genel okuyucu</option><option value="student">Öğrenci</option><option value="expert">Uzman</option></select></label>
            <label>Derinlik<select value={depth} onChange={(event) => setDepth(event.target.value as typeof depth)}><option value="concise">Kısa · 5 bölüm</option><option value="standard">Standart · 6 bölüm</option><option value="deep">Derin · 8 bölüm</option></select></label>
            <label>Dil<select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}><option value="tr">Türkçe</option><option value="en">English</option></select></label>
          </div>

          <section className="orchestration-config">
            <div className="orchestration-heading">
              <div><Sparkles size={15} /><span>Model orchestration</span></div>
              <div className="orchestration-toggle">
                <button className={orchestration === "single" ? "active" : ""} onClick={() => setOrchestration("single")}>Tek model</button>
                <button className={orchestration === "team" ? "active" : ""} onClick={() => setOrchestration("team")}><Users size={13} /> Model ekibi</button>
              </div>
            </div>

            {orchestration === "single" ? (
              <div className="single-model-row">
                <div className="model-select provider-select"><select aria-label="Model sağlayıcısı" value={provider} onChange={(event) => changeProvider(event.target.value as ProviderId)}>{providerCatalog.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
                <ModelPicker assignment={{ provider, model }} onChange={(assignment) => { setProvider(assignment.provider); setModel(assignment.model); }} openRouterModels={openRouterModels} inputId="single" />
                <p>Bu model dört görevin tamamını yürütür.</p>
              </div>
            ) : (
              <>
                <div className="team-preset-row">
                  <div><strong>Görev dağılımı</strong><span>Her uzman yalnızca kendine atanan structured görevi üretir.</span></div>
                  <button onClick={() => setTeam(structuredClone(recommendedModelTeam))}>Önerilen 4-model ekip</button>
                </div>
                <div className="task-assignment-grid">
                  {generationTaskCatalog.map((task, index) => (
                    <article className="task-assignment-card" key={task.id}>
                      <header><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{task.label}</strong><small>{task.recommendation}</small></div></header>
                      <p>{task.description}</p>
                      <div className="task-model-controls">
                        <select aria-label={`${task.label} sağlayıcısı`} value={team[task.id].provider} onChange={(event) => {
                          const nextProvider = event.target.value as ProviderId;
                          updateTeamAssignment(task.id, { provider: nextProvider, model: defaultModelByProvider[nextProvider] });
                        }}>{providerCatalog.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                        <ModelPicker assignment={team[task.id]} onChange={(assignment) => updateTeamAssignment(task.id, assignment)} openRouterModels={openRouterModels} inputId={task.id} compact />
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}

            <div className="credential-heading"><LockKeyhole size={14} /><div><strong>Kullanılan provider key’leri</strong><span>Yalnızca seçili provider’lar için gerekli.</span></div></div>
            <div className="credential-grid">
              {usedProviders.map((item) => (
                <label className="key-input" key={item.id}>
                  <span>{item.label}</span>
                  <input type={visibleKeys[item.id] ? "text" : "password"} value={apiKeys[item.id] ?? ""} onChange={(event) => setApiKeys((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={item.keyLabel} autoComplete="off" />
                  <button type="button" onClick={() => setVisibleKeys((current) => ({ ...current, [item.id]: !current[item.id] }))} aria-label={`${item.label} API key görünürlüğü`}>{visibleKeys[item.id] ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                </label>
              ))}
            </div>
            {usedProviders.some((item) => item.id === "openrouter") && <div className="openrouter-catalog-row"><span>Katalog yalnızca Trace canvas’ı için güvenli <code>text-only output + structured output</code> modellerini gösterir. Görsel girdi desteklenebilir; görsel çıktı modelleri StorySpec üretiminden elenir.</span><button onClick={loadOpenRouterModels} disabled={modelsLoading}>{modelsLoading ? "Yükleniyor…" : "Uyumlu modelleri yükle"}</button></div>}
            <p className="key-note">Key’ler yalnızca bu üretim isteğinde backend proxy’ye gönderilir; tarayıcıda veya projede kaydedilmez.</p>
          </section>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-action" onClick={submit}>Paper’ı incele <ArrowRight size={17} /></button>
        </div>
      </section>

      <section className="landing-proof"><span>PDF</span><i /><span>Evidence graph</span><i /><span>StorySpec</span><i /><span>Interactive web</span></section>
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
  const provider = getProvider(assignment.provider)!;
  if (assignment.provider === "openrouter") {
    const listId = `openrouter-models-${inputId}`;
    return (
      <div className={`model-select openrouter-model-select ${compact ? "compact" : ""}`}>
        <input aria-label="OpenRouter model kimliği" list={listId} value={assignment.model} onChange={(event) => onChange({ ...assignment, model: event.target.value })} placeholder="provider/model" />
        <datalist id={listId}>{openRouterModels.map((item) => <option key={item.id} value={item.id}>{item.label}{item.contextLength ? ` · ${Math.round(item.contextLength / 1000)}k` : ""}</option>)}</datalist>
      </div>
    );
  }
  return (
    <div className={`model-select ${compact ? "compact" : ""}`}>
      <select aria-label={`${provider.label} modeli`} value={assignment.model} onChange={(event) => onChange({ ...assignment, model: event.target.value })}>{provider.models.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.note}</option>)}</select>
    </div>
  );
}
