"use client";

import { useEffect, useRef, useState } from "react";
import { PendingDeletion } from "@/lib/pending-deletion";
import type { ResearchProject } from "@/lib/schema";

/**
 * Geri alınabilir silme (`pending-deletion.ts`): kart hemen kayboluyor,
 * sunucudaki silme geri alma süresi dolunca yapılıyor.
 *
 * Geri alma yalnızca kütüphanedeyken sunuluyor. Başka bir ekrana geçmek ya
 * da sayfayı kapatmak bekleyen silmeyi hemen tamamlıyor: kullanıcı silmek
 * istedi, bildirimi göremediği bir yerde sessizce vazgeçilmemeli.
 */
export function useProjectDeletion({
  projects,
  setProjects,
  inLibrary,
  remove,
}: {
  projects: readonly ResearchProject[];
  setProjects: (update: (current: ResearchProject[]) => ResearchProject[]) => void;
  inLibrary: boolean;
  /** Sunucudan silmek; `keepalive` sayfa kapanırken giden istek için. */
  remove: (projectId: string, keepalive: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState<ResearchProject>();
  const [error, setError] = useState<string>();
  const queue = useRef<PendingDeletion<ResearchProject> | undefined>(undefined);
  // Silme süre dolunca, eski bir çizimin kapanışından çalışıyor; en son `remove` kullanılsın.
  const removeRef = useRef(remove);
  useEffect(() => {
    removeRef.current = remove;
  });

  /** Silinen proje listedeki yerine, güncellenme sırasına göre geri konuyor. */
  function restore(restored: ResearchProject) {
    setProjects((current) =>
      [...current.filter((item) => item.id !== restored.id), restored].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  function deletionQueue() {
    queue.current ??= new PendingDeletion<ResearchProject>(
      (target, reason) => {
        void removeRef.current(target.id, reason === "pagehide").catch((caught: unknown) => {
          setError(caught instanceof Error ? caught.message : "Could not delete the Trace project.");
          restore(target);
        });
      },
      setPending,
    );
    return queue.current;
  }

  function request(projectId: string) {
    const target = projects.find((item) => item.id === projectId);
    if (!target) return;
    setError(undefined);
    deletionQueue().schedule(target);
    setProjects((current) => current.filter((item) => item.id !== projectId));
  }

  function undo() {
    const restored = queue.current?.undo();
    if (restored) restore(restored);
  }

  useEffect(() => {
    if (!inLibrary) queue.current?.flush("left");
  }, [inLibrary]);

  useEffect(() => {
    const onPageHide = () => queue.current?.flush("pagehide");
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  return {
    pending,
    error,
    request,
    undo,
    confirm: () => queue.current?.flush("left"),
    dismissError: () => setError(undefined),
  };
}
