"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseStudyProgress, type StudyProgress } from "@/lib/study-path";

export type StudyState =
  | { status: "loading" }
  | { status: "ready"; progress?: StudyProgress }
  | { status: "failed"; message: string };

const endpoint = (projectId: string) => `/api/library/study?id=${encodeURIComponent(projectId)}`;

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

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint(projectId), { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => undefined)) as { progress?: unknown; error?: string } | undefined;
        if (!response.ok) throw new Error(data?.error ?? "Your study progress could not be read.");
        if (!cancelled) setLoaded({ projectId, state: { status: "ready", progress: parseStudyProgress(data?.progress) } });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoaded({ projectId, state: { status: "failed", message: error instanceof Error ? error.message : "Your study progress could not be read." } });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
          throw new Error(data?.error ?? "Your study progress could not be saved.");
        }
        setSaveError(undefined);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Your study progress could not be saved.");
      }
    });
  }, [projectId]);

  const save = useCallback((progress: StudyProgress | undefined) => {
    setLoaded({ projectId, state: { status: "ready", progress } });
    pending.current = { progress };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 400);
  }, [flush, projectId]);

  useEffect(() => () => flush(true), [flush]);

  return { state, save, saveError };
}
