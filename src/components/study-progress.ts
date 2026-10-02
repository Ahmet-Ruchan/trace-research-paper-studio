"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { messagesFor, type Messages } from "@/i18n/messages";
import { reviewCards, reviewForecast } from "@/lib/review-queue";
import type { ResearchProject } from "@/lib/schema";
import { parseStudyFile, parseStudyProgress, type StudyProgress } from "@/lib/study-path";
import { aliasMap, parseAliasFile, type AliasFile } from "@/lib/concept-aliases";

export type StudyState =
  | { status: "loading" }
  | { status: "ready"; progress?: StudyProgress }
  | { status: "failed"; message: string };

const endpoint = (projectId: string) => `/api/library/study?id=${encodeURIComponent(projectId)}`;

/** Sunucu bir hata yazmadığında gösterilen metinler; çağıran arayüzün dilinde verir. */
export type StudyProgressText = Messages["learning"]["studyProgress"];
const ENGLISH_TEXT: StudyProgressText = messagesFor("en").learning.studyProgress;

/**
 * Hata metinleri bir ref'te: okuma açılışta bir kez yapılıyor ve dil
 * değişince yeniden yapılmamalı; hata anında seçili dil kullanılıyor.
 */
export function useStudyProgressText() {
  const t = useT().learning.studyProgress;
  const text = useRef(t);
  useEffect(() => {
    text.current = t;
  }, [t]);
  return text;
}

/**
 * Stüdyoda çalışma ilerlemesi kütüphanede (`/api/library/study`). Okuma
 * başarısızsa hiçbir şey yazılmıyor: boş bir ilerleme kaydedilseydi geçici
 * bir ağ hatası okuyucunun bütün yanıtlarını silerdi.
 *
 * Yazmalar kısa bir gecikmeyle toplanıyor ve sırayla gidiyor; yavaş kalan
 * eski bir istek yenisinin üzerine yazamıyor. Sayfadan çıkarken bekleyen
 * yazma `keepalive` ile gönderiliyor.
 */
export function useStudyProgress(projectId: string) {
  // Durum hangi projeye aitse onunla birlikte tutuluyor: proje değişince
  // yeni okuma bitene kadar "loading", eski projenin ilerlemesi değil.
  const [loaded, setLoaded] = useState<{ projectId: string; state: StudyState }>();
  const state: StudyState = loaded?.projectId === projectId ? loaded.state : { status: "loading" };
  const [saveError, setSaveError] = useState<string>();
  const pending = useRef<{ progress?: StudyProgress } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const text = useStudyProgressText();

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint(projectId), { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => undefined)) as { progress?: unknown; error?: string } | undefined;
        if (!response.ok) throw new Error(data?.error ?? text.current.readFailed);
        if (!cancelled) setLoaded({ projectId, state: { status: "ready", progress: parseStudyProgress(data?.progress) } });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoaded({ projectId, state: { status: "failed", message: error instanceof Error ? error.message : text.current.readFailed } });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, text]);

  const flush = useCallback((keepalive = false) => {
    const item = pending.current;
    if (!item) return;
    pending.current = undefined;
    clearTimeout(timer.current);
    const body = JSON.stringify({ progress: item.progress ?? null });
    queue.current = queue.current.then(async () => {
      try {
        const response = await fetch(endpoint(projectId), { method: "PUT", keepalive, headers: { "Content-Type": "application/json" }, body });
        if (!response.ok) {
          const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
          throw new Error(data?.error ?? text.current.saveFailed);
        }
        setSaveError(undefined);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : text.current.saveFailed);
      }
    });
  }, [projectId, text]);

  const save = useCallback((progress: StudyProgress | undefined) => {
    setLoaded({ projectId, state: { status: "ready", progress } });
    pending.current = { progress };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 400);
  }, [flush, projectId]);

  useEffect(() => () => flush(true), [flush]);

  return { state, save, saveError };
}

/**
 * Bir makalenin çalışma kaydını yazar; tekrar ekranı ve moladaki tekrar için.
 * Hata olursa fırlatıyor. `text`: `useT().learning.studyProgress`.
 */
export async function putStudyProgress(projectId: string, progress: StudyProgress, text: StudyProgressText = ENGLISH_TEXT) {
  const response = await fetch(endpoint(projectId), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ progress }) });
  if (!response.ok) {
    const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(data?.error ?? text.reviewSaveFailed);
  }
}

/** Kütüphanenin bütün çalışma kayıtları; tekrar kuyruğu ve kütüphane özeti için. */
export async function readLibraryStudy(text: StudyProgressText = ENGLISH_TEXT): Promise<Map<string, StudyProgress>> {
  const response = await fetch("/api/library/study", { cache: "no-store" });
  const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  if (!response.ok) throw new Error(data?.error ?? text.cardsReadFailed);
  return parseStudyFile(data);
}

/**
 * Bütün kütüphanenin çalışma kayıtları, bir kez okunmuş. Okunamazsa
 * `undefined` kalıyor: tekrar özeti ve kavram bağları birer ek, sayfanın
 * çalışması onlara bağlı değil.
 */
export function useLibraryStudy() {
  const [study, setStudy] = useState<Map<string, StudyProgress>>();
  useEffect(() => {
    let cancelled = false;
    readLibraryStudy().then((entries) => {
      if (!cancelled) setStudy(entries);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return study;
}

/** Kütüphanenin çalışma kaydı, okuma durumuyla: okunamazsa bunu söyleyebilmek için. */
export function useLibraryStudyState() {
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; study: Map<string, StudyProgress> } | { status: "failed"; message: string }>({ status: "loading" });
  const text = useStudyProgressText();
  useEffect(() => {
    let cancelled = false;
    readLibraryStudy(text.current)
      .then((study) => {
        if (!cancelled) setState({ status: "ready", study });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "failed", message: error instanceof Error ? error.message : text.current.readFailed });
      });
    return () => {
      cancelled = true;
    };
  }, [text]);
  return state;
}

/** Kütüphane başlığındaki tekrar özeti. */
export function useReviewForecast(projects: readonly ResearchProject[]) {
  const study = useLibraryStudy();
  // Zaman açılışta bir kez alınıyor; çizim sırasında saat okunmuyor.
  const [now] = useState(() => new Date().toISOString());
  return useMemo(() => (study ? { ...reviewForecast(reviewCards(projects, study), now), now } : undefined), [projects, study, now]);
}

export type ConceptAliasesState =
  | { status: "loading" }
  | { status: "ready"; file: AliasFile; names: string[] }
  | { status: "failed"; message: string };

/**
 * Okuyucunun kavram eşleri (`concept-aliases.ts`) ve eşlenebilecek adlar.
 * Okunamazsa eşleşme yalnızca ada göre kalıyor; sayfalar ona bağlı değil.
 */
export function useConceptAliases() {
  const [state, setState] = useState<ConceptAliasesState>({ status: "loading" });
  const text = useStudyProgressText();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/library/aliases", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => undefined)) as (AliasFile & { names?: string[]; error?: string }) | undefined;
        if (!response.ok || !data) throw new Error(data?.error ?? text.current.aliasesReadFailed);
        if (!cancelled) setState({ status: "ready", file: parseAliasFile(data), names: data.names ?? [] });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "failed", message: error instanceof Error ? error.message : text.current.aliasesReadFailed });
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  const decide = useCallback(async (a: string, b: string, decision: "same" | "different" | "forget", proposedBy: "reader" | "model" = "reader", reason?: string) => {
    const response = await fetch("/api/library/aliases", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a, b, decision, proposedBy, reason }),
    });
    const data = (await response.json().catch(() => undefined)) as (AliasFile & { error?: string }) | undefined;
    if (!response.ok || !data) throw new Error(data?.error ?? text.current.aliasSaveFailed);
    setState((current) => (current.status === "ready" ? { ...current, file: parseAliasFile(data) } : current));
  }, [text]);

  const map = useMemo(() => (state.status === "ready" ? aliasMap(state.file) : undefined), [state]);
  return { state, map, decide };
}
