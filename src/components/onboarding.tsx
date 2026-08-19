"use client";

import { useRef, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, FileText, Link2, LockKeyhole, Plus, Sparkles, Upload, X } from "lucide-react";

export type GenerationOptions = {
  file: File;
  sources: string[];
  apiKey: string;
  language: "tr" | "en";
  audience: "general" | "student" | "expert";
  depth: "concise" | "standard" | "deep";
  model: string;
};

type OnboardingProps = {
  onGenerate: (options: GenerationOptions) => void;
  onSample: () => void;
};

export function Onboarding({ onGenerate, onSample }: OnboardingProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [dragging, setDragging] = useState(false);
  const [sourceInput, setSourceInput] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [language, setLanguage] = useState<"tr" | "en">("tr");
  const [audience, setAudience] = useState<"general" | "student" | "expert">("student");
  const [depth, setDepth] = useState<"concise" | "standard" | "deep">("standard");
  const [model, setModel] = useState("gemini-3.7-flash");
  const [error, setError] = useState<string>();

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
    if (!apiKey.trim()) return setError("Analiz için Gemini API key gerekli.");
    setError(undefined);
    onGenerate({ file, sources, apiKey: apiKey.trim(), language, audience, depth, model });
  }

  return (
    <main className="onboarding-page">
      <header className="landing-header">
        <a className="brand" href="#top" aria-label="Trace ana sayfa">
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>research studio</small></span>
        </a>
        <button className="text-button" onClick={onSample}>Örnek projeyi aç <ArrowRight size={15} /></button>
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

          <div className="model-row">
            <div className="model-select"><Sparkles size={15} /><select value={model} onChange={(event) => setModel(event.target.value)}><option value="gemini-3.7-flash">Gemini 3.7 Flash</option><option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option><option value="gemini-2.5-flash">Gemini 2.5 Flash</option></select></div>
            <div className="key-input"><LockKeyhole size={15} /><input type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Gemini API key" autoComplete="off" /><button onClick={() => setShowKey((current) => !current)} aria-label="API key görünürlüğü">{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>
          </div>
          <p className="key-note">Key yalnızca bu üretim isteğinde backend proxy’ye gönderilir; tarayıcıda kaydedilmez.</p>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-action" onClick={submit}>Paper’ı incele <ArrowRight size={17} /></button>
        </div>
      </section>

      <section className="landing-proof"><span>PDF</span><i /><span>Evidence graph</span><i /><span>StorySpec</span><i /><span>Interactive web</span></section>
    </main>
  );
}

