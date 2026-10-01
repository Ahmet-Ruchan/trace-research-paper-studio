"use client";

import { useEffect, useRef } from "react";
import { claimHash, parseDeepLink, sectionHash } from "@/lib/deep-link";
import { handoffAddress, parseTraceProject } from "@/lib/project-import";
import { listLibraryProjects, saveLibraryProject } from "@/lib/project-library";
import { loadSampleProject } from "@/lib/sample-project";
import { researchProjectSchema, type ResearchProject } from "@/lib/schema";
import { STORAGE_KEY, type AppScreen, type WorkspaceMode } from "./screens";
import { CHECKPOINT_KEY } from "./use-generation";

/**
 * Stüdyo ile adres çubuğu: açılışta adresi okumak, sonra adresin her zaman
 * açık olanı göstermesi.
 */

const SCREEN_PARAMS: Array<[string, AppScreen]> = [["library", "library"], ["review", "review"], ["exam", "exam"], ["progress", "progress"], ["focus", "focus"], ["profile", "profile"]];

export type StartupActions = {
  setMode: (mode: WorkspaceMode) => void;
  setScreen: (screen: AppScreen) => void;
  /** Bir projeyi makale ekranında açmak (örnek, ajan devri, kalıcı bağlantı). */
  show: (project: ResearchProject) => void;
  /** Ajanın devrettiği proje kütüphaneye kaydedildi. */
  adopted: (project: ResearchProject) => void;
  importFailed: (message: string) => void;
  setInitialTeam: (team: boolean) => void;
  selectClaim: (claimId: string) => void;
  /** Adres okundu: bundan sonra adresi yazan efekt çalışabilir. */
  hydrated: () => void;
  setProjects: (projects: ResearchProject[]) => void;
};

/** Ajanın devri: `deliver` tarayıcıyı `?import=<adres>` ile açıyor (`project-import.ts`). */
async function adoptHandoff(rawUrl: string) {
  window.history.replaceState(null, "", window.location.pathname);
  const url = handoffAddress(rawUrl, window.location.origin);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`The project could not be downloaded (HTTP ${response.status}).`);
  const project = parseTraceProject(await response.text());
  await saveLibraryProject(project, { reason: "agent" });
  return project;
}

/** Açılışta bir kez: adresteki ekran, proje, kip, çapa ve ajanın devri; sonra kütüphane. */
export function useStudioStartup(actions: StartupActions) {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const act = latest.current;
        const search = new URLSearchParams(window.location.search);
        const requestedMode = search.get("mode");
        if (requestedMode === "story" || requestedMode === "preview" || requestedMode === "lab") act.setMode(requestedMode);
        if (search.get("new") === "1") window.localStorage.removeItem(CHECKPOINT_KEY);
        if (search.get("sample") === "1") {
          const sample = await loadSampleProject().catch(() => undefined);
          if (sample) act.show(sample);
        }
        const handoff = search.get("import");
        if (handoff) {
          await adoptHandoff(handoff).then(act.adopted, (caught: unknown) => {
            act.importFailed(caught instanceof Error ? caught.message : "The project could not be imported.");
          });
        }
        for (const [param, screen] of SCREEN_PARAMS) if (search.get(param) === "1") act.setScreen(screen);
        if (search.get("team") === "1") act.setInitialTeam(true);

        /**
         * Kalıcı bağlantı. `?project=` hangi projenin açılacağını, hash ise
         * onun neresine gidileceğini söylüyor. İkisi ayrı: hash tek başına
         * hangi projeye ait olduğunu bilemez, sorgu dizesi ise `#` sonrasını
         * sunucuya hiç göndermeyen tarayıcı davranışına takılmaz.
         *
         * Bu iş `hydrated` bayrağından ÖNCE bitmeli: adresi yazan efekt
         * bayrağa bakıyor ve proje henüz yüklenmemişken çalışırsa
         * `?project=` parametresini kendi eliyle silerdi.
         */
        const wantedProject = search.get("project");
        if (wantedProject) {
          const saved = (await listLibraryProjects().catch(() => [])).find((item) => item.id === wantedProject);
          if (saved) act.show(saved);
        }
        const link = parseDeepLink(window.location.hash);
        if (link?.kind === "claim") act.selectClaim(link.id);
        if (link?.kind === "section") act.setMode("preview");

        act.hydrated();
        // Eski tek-proje localStorage kaydını kütüphaneye taşı.
        // Taşıma BİR KEZ olmalı: anahtar silinmezse her açılışta tekrar
        // yazılıyor ve kullanıcının daha yeni içe aktardığı sürümü sessizce
        // eskisiyle değiştiriyordu. Ayrıca kütüphanedeki kayıt daha yeniyse
        // hiç dokunmuyoruz.
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            const legacy = researchProjectSchema.parse(JSON.parse(stored));
            const existing = (await listLibraryProjects().catch(() => [])).find((item) => item.id === legacy.id);
            if (!existing || existing.updatedAt < legacy.updatedAt) {
              await saveLibraryProject(legacy, { reason: "import" });
            }
          } catch {
            // yoksayılır; anahtar aşağıda zaten temizleniyor
          }
          window.localStorage.removeItem(STORAGE_KEY);
        }
        act.setProjects(await listLibraryProjects().catch(() => []));
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
}

/**
 * Adres çubuğu her zaman açık olan şeyi göstersin — kullanıcı bağlantıyı
 * kopyalamak için hiçbir düğmeye basmak zorunda kalmasın.
 *
 * `replaceState` kullanılıyor, `pushState` değil: bir iddiaya tıklamak
 * gezinme değil seçim. `pushState` olsaydı geri tuşu kullanıcıyı önceki
 * iddiaya götürürdü ve projeden çıkmak için onlarca kez basmak gerekirdi.
 *
 * Sayfa içindeki bir kalıcı bağlantıya tıklamak belgeyi yeniden yüklemez;
 * hash değişir ve durum olduğu yerde kalırdı. Yapıştırılan bir bağlantı da
 * aynı sayfada açıksa aynı sorunu yaşar: `hashchange` onları da açıyor.
 */
export function useStudioUrl(
  state: { hydrated: boolean; screen: AppScreen; project?: ResearchProject; mode: WorkspaceMode; selectedClaimId?: string; reviewScope?: string },
  onLink: { selectClaim: (claimId: string) => void; showPreview: () => void },
) {
  const { hydrated, screen, project, mode, selectedClaimId, reviewScope } = state;
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    for (const key of ["sample", "new", "library", "team", "mode", "import", "review", "exam", "progress", "focus", "profile"]) url.searchParams.delete(key);
    if (screen === "review" && !reviewScope) url.searchParams.set("review", "1");
    if (screen === "exam" && !reviewScope) url.searchParams.set("exam", "1");
    if (screen === "progress") url.searchParams.set("progress", "1");
    if (screen === "focus") url.searchParams.set("focus", "1");
    if (screen === "profile") url.searchParams.set("profile", "1");
    if (screen === "workspace" && project) {
      url.searchParams.set("project", project.id);
      if (mode !== "lab") url.searchParams.set("mode", mode);
      /**
       * Seçili iddia varsa çapa odur. Yoksa adreste zaten duran bir bölüm
       * çapası KORUNUR: onu silmek, bağlantıyı açan kişinin adres çubuğundan
       * aynı bağlantıyı bir daha kopyalayamaması demek olurdu.
       */
      const existing = parseDeepLink(url.hash);
      url.hash = selectedClaimId ? claimHash(selectedClaimId) : existing?.kind === "section" ? sectionHash(existing.id) : "";
    } else {
      url.searchParams.delete("project");
      url.hash = "";
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [hydrated, screen, project, mode, selectedClaimId, reviewScope]);

  const linkRef = useRef(onLink);
  useEffect(() => {
    linkRef.current = onLink;
  });
  useEffect(() => {
    const onHashChange = () => {
      const link = parseDeepLink(window.location.hash);
      if (link?.kind === "claim") linkRef.current.selectClaim(link.id);
      if (link?.kind === "section") linkRef.current.showPreview();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
}
