import { readingDrillFor } from "./reading-drill";
import type { ResearchProject } from "./schema";
import { foldForSearch } from "./search-text";

/**
 * Komut paleti (Ctrl+K): bir makaleye, makalenin bir bölümüne ya da bir
 * eyleme yazarak gitmek.
 *
 * Komutlar veri: neyi açacakları (`PaletteTarget`) bir tanım, çalıştırmak
 * stüdyonun işi. Sıralama yerel ve modelsiz: başlığın başı, bir kelimenin
 * başı, başlığın içi, sonra açıklama ve anahtar kelimeler, en son harflerin
 * sırayla geçmesi ("dprt" → "Deep report").
 */

export type PaletteScreen = "home" | "library" | "review" | "exam" | "progress" | "concepts" | "reading-order" | "models" | "focus" | "profile";
export type PaletteAction = "publish" | "citations" | "history" | "json" | "site";

export type PaletteTarget =
  | { type: "screen"; screen: PaletteScreen }
  | { type: "paper"; projectId: string }
  | { type: "mode"; mode: "lab" | "story" | "preview" }
  | { type: "lab"; section: string; reportSectionId?: string; conceptId?: string; term?: string; query?: string }
  | { type: "story"; sectionId: string }
  | { type: "action"; action: PaletteAction }
  | { type: "export"; format: string };

export const PALETTE_GROUPS = ["In this paper", "Actions", "Go to", "Papers"] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

export type PaletteCommand = {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Satırın ikinci, soluk kısmı: nerede olduğu ya da ne yaptığı. */
  detail?: string;
  /** Aranan ama gösterilmeyen sözcükler (eş anlamlılar, yazarlar). */
  keywords?: string;
  target: PaletteTarget;
};

export type PaletteExport = { format: string; label: string; description: string; unavailable?: string };

export const MAX_PALETTE_RESULTS = 40;

/** Lab'de "Practice" sekmesi: türetmeler, etkileşimliler, quiz ya da okuma alıştırması varsa. */
export function hasPractice(project: ResearchProject) {
  return Boolean(project.derivations?.length || project.interactives?.length || project.quiz || project.misreadings || project.applicationGuide || readingDrillFor(project));
}

const SCREENS: Array<{ screen: PaletteScreen; label: string; detail: string; keywords: string }> = [
  { screen: "library", label: "Library", detail: "Your papers, tags and notes", keywords: "papers collection search notes tags" },
  { screen: "review", label: "Review", detail: "The cards due today", keywords: "cards spaced repetition due flashcards" },
  { screen: "exam", label: "Practice exam", detail: "A timed exam across the library", keywords: "test quiz exam timed" },
  { screen: "progress", label: "Progress", detail: "What you have learned, paper by paper", keywords: "learning statistics stats" },
  { screen: "concepts", label: "Concepts", detail: "Concepts shared across your papers", keywords: "concept map graph shared terms" },
  { screen: "reading-order", label: "Reading order", detail: "What to read first, and the reading list", keywords: "reading list read later order next" },
  { screen: "models", label: "Model record", detail: "How each model's quotes held up", keywords: "models providers quotes accuracy" },
  { screen: "focus", label: "Focus timer", detail: "Focus rounds, timer, stopwatch and alarms", keywords: "pomodoro timer stopwatch alarm work" },
  { screen: "profile", label: "Profile", detail: "Your work calendar and weekly report", keywords: "calendar hours week report backup obsidian settings" },
  { screen: "home", label: "Analyse a paper", detail: "Start from a PDF, a title or a DOI", keywords: "home new upload pdf arxiv doi" },
];

const LAB_SECTIONS: Array<{ section: string; label: string; keywords: string; when?: (project: ResearchProject) => boolean }> = [
  { section: "overview", label: "Overview", keywords: "summary thesis" },
  { section: "study", label: "Study", keywords: "study path steps learn" },
  { section: "primer", label: "Primer", keywords: "concepts background", when: (project) => Boolean(project.primer) },
  { section: "practice", label: "Practice", keywords: "quiz derivations interactive drill", when: hasPractice },
  { section: "report", label: "Deep report", keywords: "report sections", when: (project) => Boolean(project.deepReport) },
  { section: "claims", label: "Claims", keywords: "evidence quotes pages" },
  { section: "notes", label: "Notes", keywords: "highlights my notes" },
  { section: "health", label: "Health", keywords: "quality checks evidence health" },
  { section: "ask", label: "Ask", keywords: "question answer" },
  { section: "method", label: "Method", keywords: "methodology approach" },
  { section: "technical", label: "Technical appendix", keywords: "technical equations code", when: (project) => Boolean(project.technicalAppendix) },
  { section: "metrics", label: "Metrics", keywords: "numbers results values" },
  { section: "limits", label: "Limitations", keywords: "limits caveats" },
  { section: "glossary", label: "Glossary", keywords: "terms definitions" },
];

const authorsLine = (project: ResearchProject) => {
  const { authors, year } = project.evidence.paper;
  const who = authors.length ? `${authors[0]}${authors.length > 1 ? " et al." : ""}` : "";
  return [who, year].filter(Boolean).join(", ");
};

export function buildPaletteCommands(input: {
  projects: readonly ResearchProject[];
  /** Açık makale: varsa onun bölümleri ve eylemleri de listede. */
  current?: ResearchProject;
  /** Okuyucunun bulunduğu ekran; listede kendisine gitme yok. */
  screen?: string;
  exports?: readonly PaletteExport[];
}): PaletteCommand[] {
  const { current } = input;
  const commands: PaletteCommand[] = [];
  if (current) {
    for (const item of LAB_SECTIONS) {
      if (item.when && !item.when(current)) continue;
      commands.push({ id: `lab:${item.section}`, group: "In this paper", label: item.label, detail: "Lab", keywords: item.keywords, target: { type: "lab", section: item.section } });
    }
    for (const section of current.story.sections) {
      commands.push({ id: `story:${section.id}`, group: "In this paper", label: section.title, detail: `Story · ${section.kicker}`, target: { type: "story", sectionId: section.id } });
    }
    for (const section of current.deepReport?.sections ?? []) {
      commands.push({ id: `report:${section.id}`, group: "In this paper", label: section.title, detail: "Deep report", target: { type: "lab", section: "report", reportSectionId: section.id } });
    }
    for (const concept of current.primer?.concepts ?? []) {
      commands.push({ id: `concept:${concept.id}`, group: "In this paper", label: concept.term, detail: "Primer concept", target: { type: "lab", section: "primer", conceptId: concept.id } });
    }
    for (const item of current.evidence.glossary) {
      commands.push({ id: `term:${item.term}`, group: "In this paper", label: item.term, detail: "Glossary", keywords: item.definition.slice(0, 160), target: { type: "lab", section: "glossary", term: item.term } });
    }
    const actions: Array<Omit<PaletteCommand, "group">> = [
      { id: "mode:lab", label: "Lab", detail: "Evidence, study and the report", keywords: "workspace", target: { type: "mode", mode: "lab" } },
      { id: "mode:story", label: "Edit the story", detail: "Story editor", keywords: "write editor sections", target: { type: "mode", mode: "story" } },
      { id: "mode:preview", label: "Preview the story", detail: "As readers see it", keywords: "read view", target: { type: "mode", mode: "preview" } },
      { id: "action:search", label: "Search this paper", detail: "Claims, sections, terms and your notes", keywords: "find", target: { type: "lab", section: "search", query: "" } },
      { id: "action:publish", label: "Publish a link", detail: "Share this story", keywords: "share url public", target: { type: "action", action: "publish" } },
      { id: "action:citations", label: "Citation graph", detail: "What it builds on and what cites it", keywords: "references cited by graph", target: { type: "action", action: "citations" } },
      { id: "action:history", label: "Version history", detail: "Earlier versions of this project", keywords: "versions restore undo revisions", target: { type: "action", action: "history" } },
      { id: "action:json", label: "Download the project JSON", detail: "The .trace.json file", keywords: "export save file", target: { type: "action", action: "json" } },
      { id: "action:site", label: "Export the interactive site", detail: "The whole story as one page", keywords: "export html download", target: { type: "action", action: "site" } },
      ...(input.exports ?? [])
        .filter((item) => !item.unavailable)
        .map((item) => ({ id: `export:${item.format}`, label: `Export: ${item.label}`, detail: item.description, keywords: `export download ${item.format}`, target: { type: "export" as const, format: item.format } })),
    ];
    for (const action of actions) commands.push({ ...action, group: "Actions" });
  }
  for (const item of SCREENS) {
    if (item.screen === input.screen) continue;
    commands.push({ id: `screen:${item.screen}`, group: "Go to", label: item.label, detail: item.detail, keywords: item.keywords, target: { type: "screen", screen: item.screen } });
  }
  for (const project of input.projects) {
    const { paper } = project.evidence;
    commands.push({
      id: `paper:${project.id}`,
      group: "Papers",
      label: paper.title,
      detail: [authorsLine(project), project.id === current?.id ? "open now" : ""].filter(Boolean).join(" · "),
      keywords: [paper.authors.join(" "), paper.venue, paper.doi].filter(Boolean).join(" "),
      target: { type: "paper", projectId: project.id },
    });
  }
  return commands;
}

/** Aksan ve büyük harf fark etmesin ("cayir" → "Çayır"). */
export function foldPalette(value: string) {
  return foldForSearch(value).normalize("NFD").replace(/\p{M}/gu, "");
}

/** Sorgunun harfleri başlıkta sırayla geçiyor mu ("dprt" → "deep report"). */
function inOrder(text: string, token: string) {
  let at = 0;
  for (const character of token) {
    at = text.indexOf(character, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

function tokenScore(label: string, extra: string, token: string) {
  if (label.startsWith(token)) return 0;
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(label)) return 1;
  if (label.includes(token)) return 2;
  if (extra.includes(token)) return 4;
  if (token.length >= 2 && inOrder(label, token)) return 7;
  return undefined;
}

/**
 * Sorguya uyan komutlar, en iyi eşleşme önce. Her kelime başlıkta,
 * açıklamada ya da anahtar kelimelerde geçmeli. Boş sorguda liste olduğu
 * gibi: açık makalenin bölümleri ve eylemleri, ekranlar, makaleler.
 *
 * Bir makale açıkken listenin sonunda her zaman "bu makalede ara": palet
 * bir başlık bulamadığında aranan söz iddialarda, metinde ve notlarda olabilir.
 */
export function rankPaletteCommands(commands: readonly PaletteCommand[], query: string, limit = MAX_PALETTE_RESULTS): PaletteCommand[] {
  const folded = foldPalette(query).trim();
  if (!folded) {
    // Boşken bir makalenin bütün bölüm başlıkları listeyi doldurmasın: Lab sekmeleri, eylemler, ekranlar, makaleler.
    return commands.filter((command) => command.group !== "In this paper" || command.id.startsWith("lab:")).slice(0, limit);
  }
  const tokens = folded.split(/\s+/);
  const scored: Array<{ command: PaletteCommand; score: number; index: number }> = [];
  commands.forEach((command, index) => {
    const label = foldPalette(command.label);
    const extra = foldPalette([command.detail, command.keywords, command.group].filter(Boolean).join(" "));
    let score = 0;
    for (const token of tokens) {
      const part = tokenScore(label, extra, token);
      if (part === undefined) return;
      score += part;
    }
    if (label === folded) score -= 6;
    else if (label.startsWith(folded)) score -= 3;
    scored.push({ command, score, index });
  });
  const ranked = scored.sort((left, right) => left.score - right.score || left.index - right.index).map((entry) => entry.command);
  if (!commands.some((command) => command.id === "action:search")) return ranked.slice(0, limit);
  const text = query.trim().replace(/\s+/g, " ").slice(0, 120);
  const search: PaletteCommand = { id: "action:search-query", group: "Actions", label: `Search this paper for “${text}”`, detail: "Claims, sections, terms and your notes", target: { type: "lab", section: "search", query: text } };
  return [...ranked.filter((command) => command.id !== "action:search").slice(0, limit - 1), search];
}
