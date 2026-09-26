/**
 * Öğrenme katmanının kuralları, model istemleri için.
 *
 * Hem katmanı ilk kez üreten istemde (learning-generation.ts) hem de tek bir
 * öğeyi yeniden yazan istemde (section-regeneration.ts) kullanılıyor. Ayrı
 * yazılsalardı ikisi zamanla ayrışır ve yeniden yazılan bir soru, ilk
 * üretimin asla kabul etmeyeceği bir biçim taşıyabilirdi. Kaynak: eklentinin
 * sözleşmesindeki "Learning layer" bölümü (project-contract.md).
 */

/** Katmanın her bloğu için geçerli kanıt kuralı. */
export const LEARNING_EVIDENCE_RULES = [
  "Every claim ID you cite must exist in the evidence JSON. Never invent a number, result, setting, dataset, page or quotation.",
  "Numbers come from the evidence metrics or from a claim. When a teaching device needs illustrative numbers the paper never published, say so plainly in that item's own description or setup.",
  "A needs-review claim must be presented as uncertain, never as an established fact.",
  "Teach, do not summarise: explain why things are the way they are, in the order a learner needs them.",
] as const;

export const PRIMER_RULES = [
  "A concept explains prior knowledge the paper assumes but does not explain. It is not a summary of the paper.",
  "intuition gives the plain-language idea first; formal (optional) is the precise definition in LaTeX; whyItMatters connects the concept to this paper.",
  "level is one of temel (basic), orta (intermediate) or ileri (advanced).",
  "prerequisiteIds may only name other concept IDs from the outline, never this concept itself.",
  "claimIds may be empty for general background; when present, each must be a claim ID from the evidence JSON.",
] as const;

export const QUIZ_RULES = [
  "Test understanding of the paper, not recall of trivia. The correct answer must follow from the cited claims.",
  "single and true-false questions have exactly one correct option; multi questions have at least two. A true-false question has exactly two options.",
  "Every option carries an explanation of why it is right or wrong, grounded in the evidence.",
  "page is optional; give it only when it is a page one of the cited claims comes from.",
] as const;

export const DERIVATION_RULES = [
  "Derive the result step by step. Each step has latex, a plain-language reading and a rationale that says why it follows from the previous step.",
  "Step IDs are unique within the derivation.",
  "numericExample is optional and may only use numbers from the evidence metrics or the paper's stated settings; never invent values.",
  "Use standard LaTeX math only; no macros defined elsewhere.",
] as const;

/** Formüller çalıştırılabilir kod değil: formula.ts'teki kısıtlı dilbilgisi. */
export const INTERACTIVE_RULES = [
  "Formulas are parsed by a restricted grammar, never executed as code. Allowed: numbers, declared parameter names, + - * / % ^, parentheses, unary minus, the constants pi and e, and the functions abs sqrt exp ln log2 log10 log floor ceil round sign sin cos tan tanh pow min max clamp sigmoid. Nothing else.",
  "formula-playground: 1–4 parameters and 1–4 outputs. A parameter name is a valid identifier used by the formulas. paperValue is the paper's own configuration and lies inside [min, max]; every output must give a finite value at the paper values. chart.xParam is a declared parameter and every series names a declared output.",
  "Choose ranges that make a real point: the strongest playground shows a crossover or a saturation the paper argues for but never plots. paperAnchor says what configuration the paper actually used and what it did NOT verify.",
  "mechanism-simulation: 2–10 stageNodes and 2–12 frames. Every activeNodeIds entry names a declared node. A grid's values have exactly one row per rowLabel and one cell per columnLabel, all finite; say in the description when the grid values are illustrative.",
  "dataset-explorer: 2–8 columns and 2–40 rows, each row with exactly one cell per column. A number column holds only numbers, never \"n/a\" or \"—\"; drop rows or columns rather than inventing placeholders. Values come from the evidence metrics or claims. sourceRef points at the paper's table: sourceId \"paper\", its page and a short excerpt.",
] as const;

export const APPLICATION_GUIDE_RULES = [
  "recipe has 2–8 steps a practitioner would follow. A step may carry code { language, source }; code is explanatory, never presented as the authors' or a runnable library's code. Showing the wrong way beside the right way teaches the most.",
  "hyperparameters (at most 8): paperValue and range come from the paper. If a parameter was never ablated, say so in guidance instead of recommending a range.",
  "pitfalls (at most 6) each give a symptom, its cause and the fix, tied to claims.",
  "whenNotToUse (1–5 items) draws on the paper's own limitations. A guide that only says when the method works is advocacy, not teaching.",
] as const;
