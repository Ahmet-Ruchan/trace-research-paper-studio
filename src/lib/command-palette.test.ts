import { describe, expect, it } from "vitest";
import { messagesFor } from "@/i18n/messages";
import { buildPaletteCommands, ENGLISH_PALETTE_WORDS, foldPalette, hasPractice, MAX_PALETTE_RESULTS, PALETTE_GROUPS, rankPaletteCommands, type PaletteCommand } from "./command-palette";
import { loadExampleProject } from "./example-fixture";
import type { ResearchProject } from "./schema";

const attention = loadExampleProject("attention-is-all-you-need.en.trace.json");
const other: ResearchProject = {
  ...attention,
  id: "turkish",
  evidence: { ...attention.evidence, paper: { ...attention.evidence.paper, title: "Çayır Ölçümleri Üzerine", authors: ["Ayşe Yılmaz", "Can Demir"], year: "2021" } },
};
const exports = [
  { format: "slides", label: "Slides", description: "One slide per section." },
  { format: "anki", label: "Anki deck", description: "Cards.", unavailable: "This project has no quiz." },
];

const labels = (commands: PaletteCommand[]) => commands.map((command) => command.label);

describe("the command palette", () => {
  it("lists the open paper's sections and actions, the screens and the papers", () => {
    const commands = buildPaletteCommands({ projects: [attention, other], current: attention, screen: "workspace", exports });
    const groups = [...new Set(commands.map((command) => command.group))];
    expect(groups).toEqual(["In this paper", "Actions", "Go to", "Papers"]);
    expect(commands.find((command) => command.id === "lab:claims")?.target).toEqual({ type: "lab", section: "claims" });
    const report = attention.deepReport!.sections[0];
    expect(commands.find((command) => command.id === `report:${report.id}`)?.target).toEqual({ type: "lab", section: "report", reportSectionId: report.id });
    const story = attention.story.sections[0];
    expect(commands.find((command) => command.id === `story:${story.id}`)).toMatchObject({ label: story.title, target: { type: "story", sectionId: story.id } });
    const concept = attention.primer!.concepts[0];
    expect(commands.find((command) => command.id === `concept:${concept.id}`)?.target).toEqual({ type: "lab", section: "primer", conceptId: concept.id });
    // Kullanılamayan dışa aktarım listede yok.
    expect(labels(commands)).toContain("Export: Slides");
    expect(labels(commands)).not.toContain("Export: Anki deck");
    expect(commands.find((command) => command.id === `paper:${attention.id}`)?.detail).toContain("open now");
    expect(commands.find((command) => command.id === "paper:turkish")?.detail).toBe("Ayşe Yılmaz et al., 2021");
  });

  it("leaves out the paper's own commands without an open paper, and the screen the reader is on", () => {
    const commands = buildPaletteCommands({ projects: [attention], screen: "library" });
    expect(commands.some((command) => command.group === "In this paper" || command.group === "Actions")).toBe(false);
    expect(labels(commands)).not.toContain("Library");
    expect(labels(commands)).toContain("Review");
  });

  it("offers Lab sections only when the project has them", () => {
    const bare: ResearchProject = { ...attention, primer: undefined, deepReport: undefined, technicalAppendix: undefined };
    const ids = buildPaletteCommands({ projects: [], current: bare }).map((command) => command.id);
    expect(ids).not.toContain("lab:primer");
    expect(ids).not.toContain("lab:report");
    expect(ids).not.toContain("lab:technical");
    expect(ids).toContain("lab:claims");
    expect(hasPractice(attention)).toBe(true);
  });

  it("ranks the start of a title first, then a word, then inside, then the details, then letters in order", () => {
    const commands = buildPaletteCommands({ projects: [attention, other], current: attention, exports });
    expect(rankPaletteCommands(commands, "rev")[0].label).toBe("Review");
    expect(rankPaletteCommands(commands, "deep")[0].label).toBe("Deep report");
    // Harfler sırayla: "dprt" → "Deep report".
    expect(labels(rankPaletteCommands(commands, "dprt"))).toContain("Deep report");
    // Açıklamadan ve anahtar kelimeden: "pomodoro" → Focus timer.
    expect(rankPaletteCommands(commands, "pomodoro")[0].label).toBe("Focus timer");
    // Her kelime bir yerde geçmeli; makale açıkken yalnızca "bu makalede ara" kalıyor.
    expect(rankPaletteCommands(commands, "deep zzzz").map((command) => command.target)).toEqual([{ type: "lab", section: "search", query: "deep zzzz" }]);
    expect(rankPaletteCommands(buildPaletteCommands({ projects: [attention] }), "deep zzzz")).toEqual([]);
    // Eylemler makale başlığıyla eşleşmiyor: "attention" yazınca bütün eylemler gelmesin.
    expect(rankPaletteCommands(commands, "attention").filter((command) => command.group === "Actions").map((command) => command.id)).toEqual(["action:search-query"]);
    // Yazarla makale.
    expect(rankPaletteCommands(commands, "vaswani")[0].target).toEqual({ type: "paper", projectId: attention.id });
  });

  it("ignores case and accents, in Turkish too", () => {
    expect(foldPalette("Çayır İzmir")).toBe("cayir izmir");
    const commands = buildPaletteCommands({ projects: [attention, other] });
    expect(rankPaletteCommands(commands, "cayir olcum")[0].label).toBe("Çayır Ölçümleri Üzerine");
    expect(rankPaletteCommands(commands, "AYSE")[0].target).toEqual({ type: "paper", projectId: "turkish" });
  });

  it("keeps the empty list short: Lab tabs, actions, screens and papers, not every section", () => {
    const commands = buildPaletteCommands({ projects: [attention], current: attention, exports });
    const empty = rankPaletteCommands(commands, "  ");
    expect(empty.some((command) => command.id.startsWith("story:") || command.id.startsWith("report:") || command.id.startsWith("term:"))).toBe(false);
    expect(empty[0].id).toBe("lab:overview");
    expect(empty.length).toBeLessThanOrEqual(MAX_PALETTE_RESULTS);
    // Bir sorguda bölümler de geliyor.
    const section = attention.deepReport!.sections[0];
    expect(rankPaletteCommands(commands, section.title).some((command) => command.id === `report:${section.id}`)).toBe(true);
  });
});

describe("the command palette in the reader's language", () => {
  const english = messagesFor("en");
  const turkish = messagesFor("tr");
  /** Stüdyonun kurduğu gibi: dil komutu dahil, metinler arayüzün dilinde. */
  const build = (messages: typeof english, screen?: string) =>
    buildPaletteCommands({
      projects: [attention, other],
      current: attention,
      screen,
      exports,
      words: messages.studio.commandPalette.words,
      switchLanguage: {
        label: messages.common.switchLanguageAction,
        detail: messages.studio.appShell.languageDetail,
        keywords: messages.studio.appShell.languageKeywords,
      },
    });

  it("keeps the English palette exactly as it was", () => {
    expect(english.studio.commandPalette.words).toBe(ENGLISH_PALETTE_WORDS);
    const plain = buildPaletteCommands({ projects: [attention, other], current: attention, exports });
    const worded = buildPaletteCommands({ projects: [attention, other], current: attention, exports, words: ENGLISH_PALETTE_WORDS });
    expect(worded).toEqual(plain);
  });

  it("names the commands in Turkish and finds them by their Turkish names", () => {
    const words = turkish.studio.commandPalette.words;
    const commands = build(turkish);
    expect(labels(commands)).toContain("Kütüphane");
    expect(labels(commands)).toContain("Ayrıntılı rapor");
    expect(labels(commands)).toContain("Dışa aktar: Slides");
    expect(commands.find((command) => command.id === "paper:turkish")?.detail).toBe("Ayşe Yılmaz vd., 2021");
    expect(commands.find((command) => command.id === `paper:${attention.id}`)?.detail).toContain("şu an açık");
    expect(rankPaletteCommands(commands, "kütüp", undefined, words)[0].label).toBe("Kütüphane");
    // Aksansız da: "kutuphane", "ayrintili".
    expect(rankPaletteCommands(commands, "kutuphane", undefined, words)[0].label).toBe("Kütüphane");
    expect(rankPaletteCommands(commands, "ayrintili", undefined, words)[0].label).toBe("Ayrıntılı rapor");
    // Türkçe anahtar kelime: "pomodoro" iki dilde de, "kronometre" Türkçede.
    expect(rankPaletteCommands(commands, "kronometre", undefined, words)[0].label).toBe("Odak zamanlayıcısı");
    // Bu makalede arama satırı da Türkçe.
    expect(rankPaletteCommands(commands, "zzzz", undefined, words).map((command) => command.label)).toEqual(["Bu makalede “zzzz” ara"]);
  });

  it("still finds commands by their English names in the Turkish interface", () => {
    const words = turkish.studio.commandPalette.words;
    const commands = build(turkish);
    expect(rankPaletteCommands(commands, "library", undefined, words)[0].label).toBe("Kütüphane");
    expect(rankPaletteCommands(commands, "deep report", undefined, words)[0].label).toBe("Ayrıntılı rapor");
    expect(rankPaletteCommands(commands, "pomodoro", undefined, words)[0].label).toBe("Odak zamanlayıcısı");
    // Grup adı da iki dilde aranıyor.
    expect(rankPaletteCommands(commands, "eylemler", undefined, words).some((command) => command.group === "Actions")).toBe(true);
  });

  it("switches the interface language from either language, by either language's words", () => {
    for (const messages of [english, turkish]) {
      const words = messages.studio.commandPalette.words;
      const commands = build(messages, "library");
      const command = commands.find((item) => item.id === "ui:language");
      expect(command).toMatchObject({ label: messages.common.switchLanguageAction, group: "Settings", target: { type: "language" } });
      for (const query of ["language", "dil", "Türkçe", "turkce", "English", "Turkish", "İngilizce", "ingilizce"]) {
        expect(rankPaletteCommands(commands, query, undefined, words).map((item) => item.id), query).toContain("ui:language");
      }
      // Boş sorguda da listede: makalelerden önce geliyor.
      expect(rankPaletteCommands(commands, "", undefined, words).map((item) => item.id)).toContain("ui:language");
    }
    expect(PALETTE_GROUPS).toContain("Settings");
    expect(turkish.studio.commandPalette.words.groups.Settings).toBe("Ayarlar");
  });
});
