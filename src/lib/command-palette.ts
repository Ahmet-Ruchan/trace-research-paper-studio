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
  | { type: "export"; format: string }
  /** Arayüzün dilini değiştirmek; stüdyonun kendisi yapıyor (`useUiLanguage().toggle`). */
  | { type: "language" };

/** Grupların kimliği; ekranda görünen adı `PaletteWords.groups`ta. */
export const PALETTE_GROUPS = ["In this paper", "Actions", "Go to", "Settings", "Papers"] as const;
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

type LabSection = "overview" | "study" | "primer" | "practice" | "report" | "claims" | "notes" | "health" | "ask" | "method" | "technical" | "metrics" | "limits" | "glossary";
type PaletteActionId = "lab" | "story" | "preview" | "search" | "publish" | "citations" | "history" | "json" | "site";
type Entry = { label: string; detail: string; keywords: string };

/**
 * Paletin ekranda görünen metinleri. Sözlük (`src/i18n/messages`) kendi
 * dilindekini veriyor; verilmezse İngilizce. İngilizce adlar ve anahtar
 * kelimeler her dilde aranabilir kalıyor (`withEnglish`): kısayolu
 * İngilizce öğrenmiş biri Türkçe arayüzde de "library" yazabilmeli.
 */
export type PaletteWords = {
  groups: Record<PaletteGroup, string>;
  screens: Record<PaletteScreen, Entry>;
  labSections: Record<LabSection, { label: string; keywords: string }>;
  actions: Record<PaletteActionId, Entry>;
  /** Satırın soluk kısmı: Lab sekmesi, hikâye bölümü, rapor, ön bilgi, sözlük. */
  lab: string;
  storySection: (kicker: string) => string;
  deepReport: string;
  primerConcept: string;
  glossary: string;
  exportLabel: (label: string) => string;
  exportKeywords: string;
  openNow: string;
  /** Birden çok yazarlı makalede ilk yazarın ardından ("et al."). */
  etAl: string;
  searchFor: (text: string) => string;
  searchDetail: string;
};

export const ENGLISH_PALETTE_WORDS: PaletteWords = {
  groups: { "In this paper": "In this paper", Actions: "Actions", "Go to": "Go to", Settings: "Settings", Papers: "Papers" },
  screens: {
    library: { label: "Library", detail: "Your papers, tags and notes", keywords: "papers collection search notes tags" },
    review: { label: "Review", detail: "The cards due today", keywords: "cards spaced repetition due flashcards" },
    exam: { label: "Practice exam", detail: "A timed exam across the library", keywords: "test quiz exam timed" },
    progress: { label: "Progress", detail: "What you have learned, paper by paper", keywords: "learning statistics stats" },
    concepts: { label: "Concepts", detail: "Concepts shared across your papers", keywords: "concept map graph shared terms" },
    "reading-order": { label: "Reading order", detail: "What to read first, and the reading list", keywords: "reading list read later order next" },
    models: { label: "Model record", detail: "How each model's quotes held up", keywords: "models providers quotes accuracy" },
    focus: { label: "Focus timer", detail: "Focus rounds, timer, stopwatch and alarms", keywords: "pomodoro timer stopwatch alarm work" },
    profile: { label: "Profile", detail: "Your work calendar and weekly report", keywords: "calendar hours week report backup obsidian settings" },
    home: { label: "Analyse a paper", detail: "Start from a PDF, a title or a DOI", keywords: "home new upload pdf arxiv doi" },
  },
  labSections: {
    overview: { label: "Overview", keywords: "summary thesis" },
    study: { label: "Study", keywords: "study path steps learn" },
    primer: { label: "Primer", keywords: "concepts background" },
    practice: { label: "Practice", keywords: "quiz derivations interactive drill" },
    report: { label: "Deep report", keywords: "report sections" },
    claims: { label: "Claims", keywords: "evidence quotes pages" },
    notes: { label: "Notes", keywords: "highlights my notes" },
    health: { label: "Health", keywords: "quality checks evidence health" },
    ask: { label: "Ask", keywords: "question answer" },
    method: { label: "Method", keywords: "methodology approach" },
    technical: { label: "Technical appendix", keywords: "technical equations code" },
    metrics: { label: "Metrics", keywords: "numbers results values" },
    limits: { label: "Limitations", keywords: "limits caveats" },
    glossary: { label: "Glossary", keywords: "terms definitions" },
  },
  actions: {
    lab: { label: "Lab", detail: "Evidence, study and the report", keywords: "workspace" },
    story: { label: "Edit the story", detail: "Story editor", keywords: "write editor sections" },
    preview: { label: "Preview the story", detail: "As readers see it", keywords: "read view" },
    search: { label: "Search this paper", detail: "Claims, sections, terms and your notes", keywords: "find" },
    publish: { label: "Publish a link", detail: "Share this story", keywords: "share url public" },
    citations: { label: "Citation graph", detail: "What it builds on and what cites it", keywords: "references cited by graph" },
    history: { label: "Version history", detail: "Earlier versions of this project", keywords: "versions restore undo revisions" },
    json: { label: "Download the project JSON", detail: "The .trace.json file", keywords: "export save file" },
    site: { label: "Export the interactive site", detail: "The whole story as one page", keywords: "export html download" },
  },
  lab: "Lab",
  storySection: (kicker) => `Story · ${kicker}`,
  deepReport: "Deep report",
  primerConcept: "Primer concept",
  glossary: "Glossary",
  exportLabel: (label) => `Export: ${label}`,
  exportKeywords: "export download",
  openNow: "open now",
  etAl: "et al.",
  searchFor: (text) => `Search this paper for “${text}”`,
  searchDetail: "Claims, sections, terms and your notes",
};

/** Ekranlar listede bu sırayla. */
const SCREENS: PaletteScreen[] = ["library", "review", "exam", "progress", "concepts", "reading-order", "models", "focus", "profile", "home"];

/** Lab sekmeleri; bazıları yalnızca projede o bölüm varsa. */
const LAB_SECTIONS: Array<{ section: LabSection; when?: (project: ResearchProject) => boolean }> = [
  { section: "overview" },
  { section: "study" },
  { section: "primer", when: (project) => Boolean(project.primer) },
  { section: "practice", when: hasPractice },
  { section: "report", when: (project) => Boolean(project.deepReport) },
  { section: "claims" },
  { section: "notes" },
  { section: "health" },
  { section: "ask" },
  { section: "method" },
  { section: "technical", when: (project) => Boolean(project.technicalAppendix) },
  { section: "metrics" },
  { section: "limits" },
  { section: "glossary" },
];

const ACTIONS: Array<{ id: PaletteActionId; commandId: string; target: PaletteTarget }> = [
  { id: "lab", commandId: "mode:lab", target: { type: "mode", mode: "lab" } },
  { id: "story", commandId: "mode:story", target: { type: "mode", mode: "story" } },
  { id: "preview", commandId: "mode:preview", target: { type: "mode", mode: "preview" } },
  { id: "search", commandId: "action:search", target: { type: "lab", section: "search", query: "" } },
  { id: "publish", commandId: "action:publish", target: { type: "action", action: "publish" } },
  { id: "citations", commandId: "action:citations", target: { type: "action", action: "citations" } },
  { id: "history", commandId: "action:history", target: { type: "action", action: "history" } },
  { id: "json", commandId: "action:json", target: { type: "action", action: "json" } },
  { id: "site", commandId: "action:site", target: { type: "action", action: "site" } },
];

/** Başka bir dilde İngilizce ad ve anahtar kelimeler de aranıyor; İngilizcede tekrar yok. */
function withEnglish(keywords: string, english: readonly string[], words: PaletteWords) {
  return words === ENGLISH_PALETTE_WORDS ? keywords : [keywords, ...english].join(" ");
}

const authorsLine = (project: ResearchProject, words: PaletteWords) => {
  const { authors, year } = project.evidence.paper;
  const who = authors.length ? `${authors[0]}${authors.length > 1 ? ` ${words.etAl}` : ""}` : "";
  return [who, year].filter(Boolean).join(", ");
};

export function buildPaletteCommands(input: {
  projects: readonly ResearchProject[];
  /** Açık makale: varsa onun bölümleri ve eylemleri de listede. */
  current?: ResearchProject;
  /** Okuyucunun bulunduğu ekran; listede kendisine gitme yok. */
  screen?: string;
  exports?: readonly PaletteExport[];
  /** Arayüzün dilinde metinler; verilmezse İngilizce. */
  words?: PaletteWords;
  /** Arayüzün dilini değiştiren komut; metni ve anahtar kelimeleri sözlükten. */
  switchLanguage?: { label: string; detail: string; keywords: string };
}): PaletteCommand[] {
  const { current } = input;
  const words = input.words ?? ENGLISH_PALETTE_WORDS;
  const english = ENGLISH_PALETTE_WORDS;
  const commands: PaletteCommand[] = [];
  if (current) {
    for (const item of LAB_SECTIONS) {
      if (item.when && !item.when(current)) continue;
      const text = words.labSections[item.section];
      const fallback = english.labSections[item.section];
      commands.push({ id: `lab:${item.section}`, group: "In this paper", label: text.label, detail: words.lab, keywords: withEnglish(text.keywords, [fallback.label, fallback.keywords], words), target: { type: "lab", section: item.section } });
    }
    for (const section of current.story.sections) {
      commands.push({ id: `story:${section.id}`, group: "In this paper", label: section.title, detail: words.storySection(section.kicker), target: { type: "story", sectionId: section.id } });
    }
    for (const section of current.deepReport?.sections ?? []) {
      commands.push({ id: `report:${section.id}`, group: "In this paper", label: section.title, detail: words.deepReport, target: { type: "lab", section: "report", reportSectionId: section.id } });
    }
    for (const concept of current.primer?.concepts ?? []) {
      commands.push({ id: `concept:${concept.id}`, group: "In this paper", label: concept.term, detail: words.primerConcept, target: { type: "lab", section: "primer", conceptId: concept.id } });
    }
    for (const item of current.evidence.glossary) {
      commands.push({ id: `term:${item.term}`, group: "In this paper", label: item.term, detail: words.glossary, keywords: item.definition.slice(0, 160), target: { type: "lab", section: "glossary", term: item.term } });
    }
    const actions: Array<Omit<PaletteCommand, "group">> = [
      ...ACTIONS.map(({ id, commandId, target }) => {
        const text = words.actions[id];
        const fallback = english.actions[id];
        return { id: commandId, label: text.label, detail: text.detail, keywords: withEnglish(text.keywords, [fallback.label, fallback.keywords], words), target };
      }),
      ...(input.exports ?? [])
        .filter((item) => !item.unavailable)
        .map((item) => ({ id: `export:${item.format}`, label: words.exportLabel(item.label), detail: item.description, keywords: `${withEnglish(words.exportKeywords, [english.exportKeywords], words)} ${item.format}`, target: { type: "export" as const, format: item.format } })),
    ];
    for (const action of actions) commands.push({ ...action, group: "Actions" });
  }
  for (const screen of SCREENS) {
    if (screen === input.screen) continue;
    const text = words.screens[screen];
    const fallback = english.screens[screen];
    commands.push({ id: `screen:${screen}`, group: "Go to", label: text.label, detail: text.detail, keywords: withEnglish(text.keywords, [fallback.label, fallback.keywords], words), target: { type: "screen", screen } });
  }
  // Makalelerden önce: boş sorgudaki liste kısaltılırken makale kalabalığına kurban gitmesin.
  if (input.switchLanguage) {
    commands.push({ id: "ui:language", group: "Settings", ...input.switchLanguage, target: { type: "language" } });
  }
  for (const project of input.projects) {
    const { paper } = project.evidence;
    commands.push({
      id: `paper:${project.id}`,
      group: "Papers",
      label: paper.title,
      detail: [authorsLine(project, words), project.id === current?.id ? words.openNow : ""].filter(Boolean).join(" · "),
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
export function rankPaletteCommands(commands: readonly PaletteCommand[], query: string, limit = MAX_PALETTE_RESULTS, words: PaletteWords = ENGLISH_PALETTE_WORDS): PaletteCommand[] {
  const folded = foldPalette(query).trim();
  if (!folded) {
    // Boşken bir makalenin bütün bölüm başlıkları listeyi doldurmasın: Lab sekmeleri, eylemler, ekranlar, makaleler.
    return commands.filter((command) => command.group !== "In this paper" || command.id.startsWith("lab:")).slice(0, limit);
  }
  const tokens = folded.split(/\s+/);
  const scored: Array<{ command: PaletteCommand; score: number; index: number }> = [];
  commands.forEach((command, index) => {
    const label = foldPalette(command.label);
    const group = words.groups[command.group];
    const extra = foldPalette([command.detail, command.keywords, command.group, group === command.group ? "" : group].filter(Boolean).join(" "));
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
  const search: PaletteCommand = { id: "action:search-query", group: "Actions", label: words.searchFor(text), detail: words.searchDetail, target: { type: "lab", section: "search", query: text } };
  return [...ranked.filter((command) => command.id !== "action:search").slice(0, limit - 1), search];
}
