import { describe, expect, it } from "vitest";
import { DIFFERENCE_WORDS, formatDifference } from "@/lib/compare-projects";
import { loadExampleProject } from "@/lib/example-fixture";
import { EXPORT_MENU_WORDS, exportDefinitions, exportMenuText } from "@/lib/exports";
import { MODEL_LABEL_WORDS, exclusionDescriptions, modelLabel } from "@/lib/model-record";
import { REVISION_WORDS, describeProjectChanges, revisionFieldLabel } from "@/lib/project-revisions";
import { PUBLISHED_NOTES_WORDS, publishedNotesHtml } from "@/lib/publications";
import { REWRITE_PRESETS, REWRITE_PRESET_LABELS, rewritePresets } from "@/lib/rewrite-presets";
import type { ResearchProject } from "@/lib/schema";
import { sectionKinds } from "@/lib/section-regeneration";
import paper from "./paper";

const fresh = (): ResearchProject => structuredClone(loadExampleProject());
const { en, tr } = paper;

describe("paper: lib modüllerinin sözcükleri", () => {
  it("İngilizcesi modülün kendi varsayılanı; çağıranın çıktısı değişmiyor", () => {
    expect(en.history.changes).toBe(REVISION_WORDS);
    expect(en.regenerator.presets).toBe(REWRITE_PRESET_LABELS);
    expect(en.compare.difference).toBe(DIFFERENCE_WORDS);
    expect(en.modelRecord.modelLabel).toBe(MODEL_LABEL_WORDS);
    expect(en.modelRecord.exclusions).toBe(exclusionDescriptions);
    expect(en.sharedNotes).toBe(PUBLISHED_NOTES_WORDS);
    expect(en.exportMenu).toBe(EXPORT_MENU_WORDS);
    for (const kind of sectionKinds) expect(rewritePresets(kind, en.regenerator.presets)).toBe(REWRITE_PRESETS[kind]);
  });

  it("sürüm farkını Türkçe anlatıyor; alan anahtarları değişmiyor", () => {
    const from = fresh();
    const to = fresh();
    to.story.sections[3] = { ...to.story.sections[3], body: "Yeni metin", claimIds: ["claim-result-04"] };
    const removed = to.evidence.claims.pop()!;
    to.evidence.claims.push({ ...removed, id: "claim-new-01" }, { ...removed, id: "claim-new-02" });
    to.evidence.claims[0] = { ...to.evidence.claims[0], statement: "Düzenlenmiş iddia" };
    delete to.quiz;
    to.story.sections = [to.story.sections[1], to.story.sections[0], ...to.story.sections.slice(2)];
    to.depth = from.depth === "deep" ? "standard" : "deep";

    const changes = describeProjectChanges(from, to, tr.history.changes);
    const summaries = changes.map((change) => change.summary);
    expect(summaries).toContain("Kanıt: 2 iddia eklendi, 1 kaldırıldı, 1 düzenlendi");
    expect(summaries).toContain("Derinlik değişti");
    expect(summaries).toContain("Test kaldırıldı");
    expect(summaries).toContain("Hikâye bölümü sırası değişti");
    const section = changes.find((change) => change.summary === "Hikâye bölümü: metin ve iddialar değişti");
    expect(section?.texts).toEqual([{ field: "text", before: from.story.sections[3].body, after: "Yeni metin" }]);
    expect(revisionFieldLabel("whyItMatters", tr.history.changes)).toBe("neden önemli");
    expect(revisionFieldLabel("whyItMatters")).toBe("whyItMatters");
    expect(revisionFieldLabel("bilinmeyen", tr.history.changes)).toBe("bilinmeyen");
  });

  it("hazır isteklerin yalnızca adı çevriliyor; modele giden istek aynı", () => {
    for (const kind of sectionKinds) {
      const translated = rewritePresets(kind, tr.regenerator.presets);
      expect(translated.map((preset) => preset.instruction)).toEqual(REWRITE_PRESETS[kind].map((preset) => preset.instruction));
      expect(translated.map((preset) => preset.id)).toEqual(REWRITE_PRESETS[kind].map((preset) => preset.id));
    }
    expect(rewritePresets("quiz", tr.regenerator.presets).map((preset) => preset.label)).toEqual(["Daha zor", "Daha kolay", "Bir yanılgıyı sına", "Daha iyi açıklamalar"]);
  });

  it("karşılaştırma farkı Türkçede Türkçe kısaltmayla", () => {
    expect(formatDifference(0, tr.compare.difference)).toBe("eşit");
    // Intl sayı ile kısaltma arasına bölünmez boşluk koyuyor.
    expect(formatDifference(-2.31e9, tr.compare.difference)).toMatch(/^-2,31\sMr$/);
    // Küçük farklar yanlarındaki makale değerleri gibi noktalı.
    expect(formatDifference(1.1, tr.compare.difference)).toBe("+1.1");
    expect(formatDifference(-2.31e9)).toBe("-2.31B");
  });

  it("ajanın yazdığı projede sağlayıcının adı Türkçe", () => {
    expect(modelLabel({ provider: "native-agent", model: "claude-code" }, tr.modelRecord.modelLabel)).toBe("Ajan · claude-code");
    expect(modelLabel({ provider: "native-agent", model: "claude-code" })).toBe("Agent · claude-code");
    expect(Object.keys(tr.modelRecord.exclusions).sort()).toEqual(Object.keys(exclusionDescriptions).sort());
  });

  it("yayındaki yazar notları Türkçe; kayıttaki İngilizce yer adı çevriliyor", () => {
    const notes = [{ place: "Deep report", heading: "Yöntem", text: "Bir not.", page: 4 }];
    const html = publishedNotesHtml(notes, tr.sharedNotes);
    expect(html).toContain("<h2>Yazarın notları</h2>");
    expect(html).toContain('aria-label="Yazarın notları"');
    expect(html).toContain("Ayrıntılı rapor · Yöntem · s. 4");
    expect(publishedNotesHtml(notes)).toContain("Deep report · Yöntem · p. 4");
    // Lab'deki analiz metnine bağlı not: kayıtta İngilizce başlık, sayfada sayfanın dili.
    const onThesis = [{ place: "Lab", heading: "Core thesis", quote: "Bir satır.", text: "" }];
    expect(publishedNotesHtml(onThesis, tr.sharedNotes)).toContain("Lab · Ana tez");
    expect(publishedNotesHtml(onThesis)).toContain("Lab · Core thesis");
  });

  it("dışa aktarma menüsü Türkçe; köprünün İngilizce nedeni yerinde", () => {
    const project = fresh();
    delete project.interactives;
    const notebook = exportDefinitions.find((definition) => definition.format === "ipynb")!;
    expect(exportMenuText(notebook, project, tr.exportMenu)).toEqual({
      label: "Jupyter not defteri",
      description: tr.exportMenu.ipynb.description,
      unavailable: "Bu projede koda dönüştürülecek bir formül oyun alanı yok.",
    });
    expect(notebook.unavailable?.(project)).toBe("This project has no formula playground to turn into code.");
    for (const definition of exportDefinitions) {
      expect(exportMenuText(definition, fresh())).toEqual({ label: definition.label, description: definition.description, unavailable: definition.unavailable?.(fresh()) });
    }
  });

  it("öğrenme bloklarının listesi Türkçe bağlaçla", () => {
    expect(en.learningBlockList(["primer", "quiz", "derivations"])).toBe("the primer, the quiz and the derivations");
    expect(tr.learningBlockList(["primer", "quiz", "derivations"])).toBe("ön bilgi, test ve türetimler");
    expect(tr.learningBlockList(["quiz"])).toBe("test");
  });
});
