import { MAX_REGENERATION_INSTRUCTION, type SectionKind } from "./section-regeneration";

/**
 * "Farklı anlat" için hazır istekler.
 *
 * Okuyucu çoğu zaman ne istediğini biliyor ("daha basit", "bir benzetmeyle")
 * ama bunu modele nasıl söyleyeceğini bilmiyor; boş bir metin kutusu bu
 * yüzden çoğunlukla boş gönderiliyordu. Her hazır istek kutuya bir satır
 * olarak ekleniyor: okuyucu ne gönderileceğini görüyor, birleştirebiliyor ve
 * düzenleyebiliyor. İstekler kanıt kilidini gevşetmiyor; sayı isteyenler
 * sayının kanıttan gelmesini ya da açıkça temsilî olduğunu söylüyor.
 *
 * Model istemi İngilizce; model okuyucuya yine projenin dilinde yazıyor.
 */
export type RewritePresetId =
  | "simpler" | "analogy" | "example" | "technical" | "shorter" | "separate" | "connect"
  | "harder" | "easier" | "misconception" | "explain" | "smaller" | "intuition" | "symbols" | "why";

/**
 * Düğmelerde görünen adlar. Varsayılan İngilizce; stüdyo arayüzün dilindekini
 * veriyor (`rewritePresets(kind, labels)`). Modele giden `instruction` hiç
 * çevrilmiyor.
 */
export type RewritePresetLabels = Record<RewritePresetId, string>;

export const REWRITE_PRESET_LABELS: RewritePresetLabels = {
  simpler: "Simpler",
  analogy: "With an analogy",
  example: "With a worked example",
  technical: "More technical",
  shorter: "Shorter",
  separate: "Measured vs. interpreted",
  connect: "Tie it to the paper",
  harder: "Harder",
  easier: "Easier",
  misconception: "Test a misconception",
  explain: "Better explanations",
  smaller: "Smaller steps",
  intuition: "Intuition first",
  symbols: "Explain each symbol",
  why: "Why each term",
};

export type RewritePreset = {
  id: RewritePresetId;
  label: string;
  instruction: string;
  /** Birlikte anlamsız olan istekler ("daha basit" ile "daha teknik"). */
  excludes?: readonly string[];
};

const simpler = (excludes: string[] = ["technical"]): RewritePreset => ({
  id: "simpler",
  label: REWRITE_PRESET_LABELS.simpler,
  instruction: "Explain it more simply: shorter sentences, everyday words, and define each technical term where it first appears.",
  excludes,
});

const analogy: RewritePreset = {
  id: "analogy",
  label: REWRITE_PRESET_LABELS.analogy,
  instruction: "Open with one everyday analogy for the core idea, then say plainly where the analogy stops matching the paper.",
};

const evidenceExample: RewritePreset = {
  id: "example",
  label: REWRITE_PRESET_LABELS.example,
  instruction: "Walk through one concrete example, step by step. Use only numbers the evidence reports; if none fit, keep the example qualitative.",
};

const technical: RewritePreset = {
  id: "technical",
  label: REWRITE_PRESET_LABELS.technical,
  instruction: "Be more technical: name the mechanism precisely, keep the paper's own terms and notation, and drop the introductory framing.",
  excludes: ["simpler"],
};

const shorter: RewritePreset = {
  id: "shorter",
  label: REWRITE_PRESET_LABELS.shorter,
  instruction: "Make it about a third shorter; keep the central point and its place in the argument.",
};

export const REWRITE_PRESETS: Record<SectionKind, readonly RewritePreset[]> = {
  story: [simpler(), analogy, evidenceExample, technical, shorter],
  report: [
    simpler(),
    {
      id: "separate",
      label: REWRITE_PRESET_LABELS.separate,
      instruction: "Separate clearly what the authors measured from how they interpret it, and say what the evidence does not show.",
    },
    evidenceExample,
    technical,
    shorter,
  ],
  primer: [
    simpler([]),
    analogy,
    {
      id: "example",
      label: REWRITE_PRESET_LABELS.example,
      instruction: "Add one small worked example with concrete numbers; take them from the evidence where possible and say when a number is only for illustration.",
    },
    {
      id: "connect",
      label: REWRITE_PRESET_LABELS.connect,
      instruction: "Say exactly where this paper relies on the concept, and what a reader who skipped it would misunderstand.",
    },
  ],
  quiz: [
    {
      id: "harder",
      label: REWRITE_PRESET_LABELS.harder,
      instruction: "Make it harder: test reasoning about why the result holds, not recall of a number or a phrase.",
      excludes: ["easier"],
    },
    {
      id: "easier",
      label: REWRITE_PRESET_LABELS.easier,
      instruction: "Make it easier: ask about the paper's central point in plain words, with one clearly right option.",
      excludes: ["harder"],
    },
    {
      id: "misconception",
      label: REWRITE_PRESET_LABELS.misconception,
      instruction: "Build the wrong options from plausible misreadings of the paper, such as taking the authors' interpretation for a measured result.",
    },
    {
      id: "explain",
      label: REWRITE_PRESET_LABELS.explain,
      instruction: "Make every option's explanation say why it is right or wrong, pointing at the evidence it rests on.",
    },
  ],
  derivation: [
    {
      id: "smaller",
      label: REWRITE_PRESET_LABELS.smaller,
      instruction: "Use smaller steps: one operation per step, and say which assumption each step uses.",
    },
    {
      id: "intuition",
      label: REWRITE_PRESET_LABELS.intuition,
      instruction: "Before the steps, say in one or two sentences what the derivation shows and why the paper needs it.",
    },
    {
      id: "example",
      label: REWRITE_PRESET_LABELS.example,
      instruction: "Add a numeric example that follows the steps. Take its numbers from the evidence metrics, or mark the example as illustrative.",
    },
  ],
  equation: [
    {
      id: "symbols",
      label: REWRITE_PRESET_LABELS.symbols,
      instruction: "Explain every symbol in plain words, with its unit or shape where it has one.",
    },
    {
      id: "why",
      label: REWRITE_PRESET_LABELS.why,
      instruction: "Say what would change without each term, and why the authors need it.",
    },
    simpler([]),
  ],
};

/** Bir türün hazır istekleri; `labels` verilirse düğme adları o dilde. */
export function rewritePresets(kind: SectionKind, labels: RewritePresetLabels = REWRITE_PRESET_LABELS): readonly RewritePreset[] {
  if (labels === REWRITE_PRESET_LABELS) return REWRITE_PRESETS[kind];
  return REWRITE_PRESETS[kind].map((preset) => ({ ...preset, label: labels[preset.id] }));
}

export function isPresetActive(instruction: string, preset: RewritePreset) {
  return instruction.includes(preset.instruction);
}

function withoutPreset(instruction: string, preset: RewritePreset) {
  if (!isPresetActive(instruction, preset)) return instruction;
  // Kutuya eklenen satır kendi satırında duruyor; okuyucu onu bir cümlenin
  // içine taşıdıysa yalnızca o parça çıkıyor.
  const lines = instruction.split("\n").filter((line) => line.trim() !== preset.instruction);
  return lines.join("\n").split(preset.instruction).join("").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Hazır isteği kutuya ekler ya da kutudan çıkarır. Okuyucunun kendi yazdığı
 * metin yerinde kalıyor; çelişen istek (daha basit ↔ daha teknik) çıkıyor.
 * Sonuç sınırı aşacaksa `undefined`: arayüz o düğmeyi kapatıyor.
 */
export function togglePreset(kind: SectionKind, instruction: string, id: string): string | undefined {
  const presets = REWRITE_PRESETS[kind];
  const preset = presets.find((item) => item.id === id);
  if (!preset) return instruction;
  if (isPresetActive(instruction, preset)) return withoutPreset(instruction, preset);
  const cleared = presets
    .filter((item) => preset.excludes?.includes(item.id))
    .reduce((text, item) => withoutPreset(text, item), instruction)
    .trim();
  const next = cleared ? `${cleared}\n${preset.instruction}` : preset.instruction;
  return next.length > MAX_REGENERATION_INSTRUCTION ? undefined : next;
}
