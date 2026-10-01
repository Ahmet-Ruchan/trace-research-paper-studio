"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pause, Play, SkipForward, Square, Volume2 } from "lucide-react";
import { READ_RATES, readingQueue, type SpeechSection } from "@/lib/read-aloud";
import { sectionMark, type NotePlace } from "@/lib/reader-notes";

/**
 * Sesli okuma (`read-aloud.ts`): bölümün "Listen" düğmesi o bölümden başlayıp
 * sona kadar okuyor; alttaki çubuk duraklatıyor, bölüm atlıyor, durduruyor ve
 * hızı değiştiriyor. Okunan bölüm işaretleniyor ve ekrana getiriliyor.
 * Tarayıcıda konuşma sentezi yoksa düğmeler hiç görünmüyor.
 */

type Status = "idle" | "playing" | "paused";
type ReadAloudValue = {
  status: Status;
  sectionId?: string;
  start: (sectionId: string) => void;
};

const ReadAloudContext = createContext<ReadAloudValue | undefined>(undefined);
const RATE_KEY = "trace-read-rate";

function synth(): SpeechSynthesis | undefined {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function" ? window.speechSynthesis : undefined;
}

function storedRate() {
  try {
    const value = Number(window.localStorage.getItem(RATE_KEY));
    return READ_RATES.find((rate) => rate === value) ?? 1;
  } catch {
    return 1;
  }
}

export function ReadAloudProvider({ place, language, sections, children }: { place: NotePlace; language: string; sections: readonly SpeechSection[]; children: ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [sectionId, setSectionId] = useState<string>();
  const [rate, setRate] = useState(1);
  const queue = useRef<Array<{ sectionId: string; text: string }>>([]);
  const position = useRef(0);
  // Her başlatma yeni bir sıra: eski parçanın geç gelen "bitti"si yenisini ilerletmesin.
  const run = useRef(0);
  const rateRef = useRef(1);

  useEffect(() => {
    const ready = setTimeout(() => {
      setAvailable(Boolean(synth()));
      const saved = storedRate();
      rateRef.current = saved;
      setRate(saved);
    }, 0);
    return () => {
      clearTimeout(ready);
      synth()?.cancel();
    };
  }, []);

  // Bir parça bitince sonrakini okuyan fonksiyon kendini çağırıyor; ref üzerinden.
  const speakRef = useRef<(index: number, token: number) => void>(() => undefined);
  useEffect(() => {
    speakRef.current = (index, token) => {
      const speech = synth();
      const item = queue.current[index];
      if (!speech || token !== run.current) return;
      if (!item) {
        setStatus("idle");
        setSectionId(undefined);
        return;
      }
      position.current = index;
      setSectionId(item.sectionId);
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.lang = language;
      utterance.rate = rateRef.current;
      const voice = speech.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith(language.toLowerCase().slice(0, 2)));
      if (voice) utterance.voice = voice;
      utterance.onend = () => speakRef.current(index + 1, token);
      utterance.onerror = (event) => {
        // "interrupted"/"canceled": durdurma ya da atlama; başka bir hata okumayı bitiriyor.
        if (event.error === "interrupted" || event.error === "canceled") return;
        if (token === run.current) {
          setStatus("idle");
          setSectionId(undefined);
        }
      };
      speech.speak(utterance);
    };
  }, [language]);

  const startAt = useCallback((index: number) => {
    const speech = synth();
    if (!speech) return;
    run.current += 1;
    speech.cancel();
    setStatus("playing");
    speakRef.current(index, run.current);
  }, []);

  const value = useMemo<ReadAloudValue>(() => ({
    status,
    sectionId,
    start: (id) => {
      queue.current = readingQueue(sections, id);
      startAt(0);
    },
  }), [sectionId, sections, startAt, status]);

  // Okunan bölüm işaretli ve görünür.
  useEffect(() => {
    if (!sectionId) return;
    const element = document.querySelector<HTMLElement>(`[data-note-section="${CSS.escape(sectionMark(place, sectionId))}"]`);
    if (!element) return;
    element.classList.add("is-reading");
    element.style.scrollMarginTop = "90px";
    element.scrollIntoView({ block: "start", behavior: "smooth" });
    return () => element.classList.remove("is-reading");
  }, [place, sectionId]);

  const current = sections.findIndex((section) => section.id === sectionId);

  function stop() {
    run.current += 1;
    synth()?.cancel();
    setStatus("idle");
    setSectionId(undefined);
  }

  function next() {
    const following = queue.current.findIndex((item, index) => index > position.current && item.sectionId !== sectionId);
    if (following === -1) return stop();
    startAt(following);
  }

  return (
    <ReadAloudContext.Provider value={available ? value : undefined}>
      {children}
      {available && status !== "idle" && current >= 0 ? (
        <section className="read-aloud-bar" role="region" aria-label="Read aloud">
          <Volume2 size={16} aria-hidden="true" />
          <p role="status">
            <span>Reading {current + 1} of {sections.length}</span>
            <strong>{sections[current].title}</strong>
          </p>
          {status === "playing" ? (
            <button type="button" onClick={() => { synth()?.pause(); setStatus("paused"); }} aria-label="Pause"><Pause size={15} /></button>
          ) : (
            <button type="button" onClick={() => { synth()?.resume(); setStatus("playing"); }} aria-label="Resume"><Play size={15} /></button>
          )}
          <button type="button" onClick={next} aria-label="Next section"><SkipForward size={15} /></button>
          <button type="button" onClick={stop} aria-label="Stop reading"><Square size={14} /></button>
          <select
              aria-label="Speed"
              value={rate}
              onChange={(event) => {
                const value = Number(event.target.value);
                rateRef.current = value;
                setRate(value);
                try {
                  window.localStorage.setItem(RATE_KEY, String(value));
                } catch {
                  // Hız yalnızca bu oturum için kalıyor.
                }
              }}
            >
              {READ_RATES.map((option) => <option key={option} value={option}>{option}×</option>)}
            </select>
        </section>
      ) : null}
    </ReadAloudContext.Provider>
  );
}

/** Bölümün başında: buradan itibaren dinle. Konuşma sentezi yoksa görünmüyor. */
export function ListenButton({ sectionId, title }: { sectionId: string; title: string }) {
  const context = useContext(ReadAloudContext);
  if (!context) return null;
  const reading = context.status !== "idle" && context.sectionId === sectionId;
  return (
    <button type="button" className={`listen-button${reading ? " is-on" : ""}`} onClick={() => context.start(sectionId)} aria-label={`Listen from “${title}”`} title="Read aloud from here">
      <Volume2 size={13} aria-hidden="true" /> {reading ? "Reading" : "Listen"}
    </button>
  );
}
