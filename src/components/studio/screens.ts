/** Stüdyonun ekranları ve makale ekranının durumları; `app-shell.tsx` ve `studio/` paylaşıyor. */

export type AppScreen = "home" | "library" | "workspace" | "compare" | "models" | "review" | "exam" | "concepts" | "progress" | "focus" | "profile";
export type WorkspaceMode = "lab" | "story" | "preview";
/** Lab'de bir yere gitmek: kaldığın yer, not araması, komut paleti. */
export type LabJump = { section: string; reportSectionId?: string; conceptId?: string; term?: string; query?: string; nonce: number };
/** Makale ekranında açık olabilecek tek panel. */
export type WorkspacePanel = "publish" | "citations" | "history";

/** Eski tek-proje kaydı: ilk açılışta kütüphaneye taşınıyor, sonra son açılan proje burada. */
export const STORAGE_KEY = "trace-research-project-v1";

export const returnLabels: Partial<Record<AppScreen, string>> = { home: "Home", library: "Library", workspace: "Back to the paper", progress: "Progress", concepts: "Concepts", models: "Model record", review: "Review", focus: "Focus", profile: "Profile" };
