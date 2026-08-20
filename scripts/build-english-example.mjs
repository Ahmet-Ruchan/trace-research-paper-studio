/**
 * Amiral gemisi örneğin İngilizce sürümünü üretir.
 *
 * Türkçe projeyi taban alır ve YALNIZCA yazılmış düzyazıyı değiştirir. Şu
 * alanlar dokunulmadan geçer: id'ler, sayılar, formüller, claim bağları ve
 * `sourceRefs.excerpt` — alıntılar makalenin kendi İngilizce metnidir ve
 * çevrilmesi kanıt zincirini bozar.
 *
 * Bir alan haritada eksikse betik durur: sessizce Türkçe metin bırakmak,
 * İngilizce README'de fark edilmeden yayınlanır.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const MAPS = process.env.TRACE_EN_MAPS ?? join(root, ".trace-en-maps");

const source = JSON.parse(readFileSync(join(root, "examples/attention-is-all-you-need.trace.json"), "utf8"));
const ev = JSON.parse(readFileSync(join(MAPS, "en-evidence.json"), "utf8"));
const st = JSON.parse(readFileSync(join(MAPS, "en-story.json"), "utf8"));
const ln = JSON.parse(readFileSync(join(MAPS, "en-learning.json"), "utf8"));
const rp = JSON.parse(readFileSync(join(MAPS, "en-report.json"), "utf8"));

const missing = [];
const need = (value, where) => {
  if (value === undefined || value === null) missing.push(where);
  return value;
};

const p = structuredClone(source);
p.id = "attention-is-all-you-need-en";
p.language = "en";
p.updatedAt = new Date().toISOString();

/* --- evidence --- */
p.evidence.thesis = ev.thesis;
p.evidence.plainSummary = ev.plainSummary;
p.evidence.researchQuestion = ev.researchQuestion;
p.evidence.methods = ev.methods;
p.evidence.findings = ev.findings;
p.evidence.limitations = ev.limitations;
p.evidence.claims.forEach((claim) => {
  claim.statement = need(ev.claimStatements[claim.id], `claim ${claim.id}`) ?? claim.statement;
  claim.sourceRefs.forEach((ref) => {
    // locator çevrilir, excerpt ASLA — o makalenin kendi metni.
    if (ref.locator) ref.locator = ref.locator.replace(/^Bölüm/, "Section").replace(/^Tablo/, "Table").replace(/sayfa/, "page");
  });
});
p.evidence.metrics.forEach((metric) => {
  const entry = need(ev.metricLabels[metric.id], `metric ${metric.id}`);
  if (entry) [metric.label, metric.context] = entry;
  if (metric.sourceRef.locator) {
    metric.sourceRef.locator = metric.sourceRef.locator.replace(/^Bölüm/, "Section").replace(/^Tablo/, "Table");
  }
});
p.evidence.glossary = p.evidence.glossary.map((item, index) => ({
  ...item,
  term: need(ev.glossary[index], `glossary ${index}`)?.term ?? item.term,
  definition: ev.glossary[index]?.definition ?? item.definition,
}));

/* --- story --- */
p.story.title = st.title;
p.story.dek = st.dek;
p.story.readingTime = st.readingTime;
p.story.closing = st.closing;
p.story.sections.forEach((section) => {
  const map = need(st.sections[section.id], `story ${section.id}`);
  if (!map) return;
  section.kicker = map.kicker;
  section.title = map.title;
  section.body = map.body;
  const v = section.visual;
  const mv = map.visual;
  v.eyebrow = mv.eyebrow;
  v.caption = mv.caption;
  if (v.type === "concept") {
    v.center = mv.center;
    v.items.forEach((item, i) => { [item.label, item.detail] = mv.items[i]; });
  }
  if (v.type === "architecture") {
    v.nodes.forEach((node) => { [node.label, node.detail] = mv.nodes[node.id]; });
    v.edges.forEach((edge) => { edge.label = mv.edges[`${edge.from}>${edge.to}`] ?? edge.label; });
  }
  if (v.type === "equation") {
    v.terms.forEach((term) => { [term.label, term.detail] = mv.terms[term.symbol]; });
    v.steps = mv.steps;
  }
  if (v.type === "matrix") {
    v.columns = mv.columns;
    v.rows.forEach((row, i) => {
      const key = Object.keys(mv.rows)[i];
      row.label = key;
      row.cells.forEach((cell, j) => { cell.label = mv.rows[key][j]; });
    });
  }
  if (v.type === "comparison") {
    v.items.forEach((item, i) => { item.label = Object.keys(mv.items)[i]; });
  }
  if (v.type === "timeline") {
    v.items.forEach((item, i) => {
      const key = Object.keys(mv.items)[i];
      item.label = key; item.detail = mv.items[key];
    });
  }
  if (v.type === "infographic") {
    v.items.forEach((item, i) => {
      const key = Object.keys(mv.items)[i];
      item.label = key; [item.detail, item.badge] = mv.items[key];
    });
  }
  if (v.type === "layers") {
    v.items.forEach((item, i) => {
      const key = Object.keys(mv.items)[i];
      item.label = key; item.detail = mv.items[key];
    });
  }
});

/* --- learning --- */
p.primer.title = ln.primer.title;
p.primer.overview = ln.primer.overview;
p.primer.concepts.forEach((concept) => {
  const map = need(ln.primer.concepts[concept.id], `primer ${concept.id}`);
  if (!map) return;
  concept.term = map.term;
  concept.intuition = map.intuition;
  concept.whyItMatters = map.whyItMatters;
});

p.derivations.forEach((derivation) => {
  const map = need(ln.derivations[derivation.id], `derivation ${derivation.id}`);
  if (!map) return;
  derivation.title = map.title;
  derivation.goal = map.goal;
  derivation.steps.forEach((step) => {
    const s = need(map.steps[step.id], `derivation ${derivation.id}.${step.id}`);
    if (!s) return;
    step.rationale = s[0];
    if (s[1]) step.shapes = s[1]; else delete step.shapes;
  });
  if (map.numericExample) derivation.numericExample = map.numericExample;
});

p.interactives.forEach((item) => {
  const map = need(ln.interactives[item.id], `interactive ${item.id}`);
  if (!map) return;
  item.title = map.title;
  item.description = map.description;
  if (item.kind === "formula-playground") {
    item.parameters.forEach((parameter) => {
      parameter.label = map.parameters[parameter.name];
      if (map.unit && parameter.unit) parameter.unit = map.unit;
    });
    item.outputs.forEach((output) => { output.label = map.outputs[output.id]; });
    if (item.chart) item.chart.series.forEach((s) => { s.label = map.series[s.outputId]; });
    item.paperAnchor = map.paperAnchor;
  }
  if (item.kind === "mechanism-simulation") {
    item.stageNodes.forEach((node) => { [node.label, node.detail] = map.stageNodes[node.id]; });
    item.frames.forEach((frame, i) => {
      [frame.label, frame.caption] = map.frames[i];
      if (frame.grid && map.gridLabels) {
        frame.grid.rowLabels = [...map.gridLabels];
        frame.grid.columnLabels = [...map.gridLabels];
      }
    });
  }
  if (item.kind === "dataset-explorer") {
    item.columns.forEach((column) => { column.label = map.columns[column.id]; });
  }
});

p.quiz.title = ln.quiz.title;
p.quiz.intro = ln.quiz.intro;
p.quiz.questions.forEach((question) => {
  const map = need(ln.quiz.questions[question.id], `quiz ${question.id}`);
  if (!map) return;
  question.prompt = map.prompt;
  question.options.forEach((option, i) => { [option.label, option.explanation] = map.options[i]; });
});

p.applicationGuide.title = ln.applicationGuide.title;
p.applicationGuide.overview = ln.applicationGuide.overview;
p.applicationGuide.recipe.forEach((item, i) => { [item.step, item.detail] = ln.applicationGuide.recipe[i]; });
// Sıraya göre eşlenir: parametre ADI da çevriliyor, anahtar olarak kullanılamaz.
p.applicationGuide.hyperparameters.forEach((item, i) => {
  const map = need(ln.applicationGuide.hyperparameters[i], `hyperparameter ${i}`);
  if (map) [item.name, item.paperValue, item.range, item.guidance] = map;
});
p.applicationGuide.pitfalls.forEach((item, i) => {
  [item.symptom, item.cause, item.fix] = ln.applicationGuide.pitfalls[i];
});
p.applicationGuide.whenNotToUse = ln.applicationGuide.whenNotToUse;

/* --- report + appendix --- */
p.deepReport.title = rp.deepReport.title;
p.deepReport.dek = rp.deepReport.dek;
p.deepReport.readingTime = rp.deepReport.readingTime;
p.deepReport.sections.forEach((section) => {
  const map = need(rp.deepReport.sections[section.id], `report ${section.id}`);
  if (!map) return;
  section.title = map.title;
  section.summary = map.summary;
  section.analysis = map.analysis;
});
p.deepReport.openQuestions = rp.deepReport.openQuestions;

const ap = p.technicalAppendix;
ap.title = rp.technicalAppendix.title;
ap.overview = rp.technicalAppendix.overview;
ap.equations.forEach((equation) => {
  const map = need(rp.technicalAppendix.equations[equation.id], `equation ${equation.id}`);
  if (!map) return;
  [equation.label, equation.explanation] = map;
  equation.variables.forEach((variable) => { variable.meaning = map[2][variable.symbol] ?? variable.meaning; });
});
ap.algorithmSteps.forEach((step, i) => { [step.label, step.detail] = rp.technicalAppendix.algorithmSteps[i]; });
ap.codeSketches.forEach((sketch, i) => { [sketch.title, sketch.explanation] = rp.technicalAppendix.codeSketches[i]; });
ap.complexity.forEach((item, i) => { [item.operation, item.cost, item.context] = rp.technicalAppendix.complexity[i]; });
ap.implementationNotes = rp.technicalAppendix.implementationNotes;


/**
 * Kalan küçük dize çevirileri: konum etiketleri, birimler ve türetim
 * adımlarındaki metin parçaları. Tablo dışında kalan her Türkçe dize aşağıdaki
 * tarama tarafından yakalanır ve betik durur.
 */
const PHRASES = new Map(Object.entries({
  "Bölüm 2": "Section 2",
  "Bölüm 3": "Section 3",
  "Bölüm 3.2": "Section 3.2",
  "Bölüm 3.2.2": "Section 3.2.2",
  "Bölüm 3.5": "Section 3.5",
  "Bölüm 4": "Section 4",
  "Bölüm 5.4": "Section 5.4",
  "Section 4 (page 7 devamı)": "Section 4 (continued on page 7)",
  "Section 6.2, Tablo 3 satır (A)": "Section 6.2, Table 3 row (A)",
  "Section 6.2, Tablo 3 satır (E)": "Section 6.2, Table 3 row (E)",
  "3.5 gün": "3.5 days",
  "12 saat": "12 hours",
  "gün": "days",
  "saat": "hours",
  "adım": "steps",
  "başlık": "heads",
  "boyut": "dimension",
  "soru": "questions",
  "token": "tokens",
  "milyon parametre": "million parameters",
  "% doğruluk": "% accuracy",
  "PPL (word-piece başına)": "PPL (per word-piece)",
  "|x| büyüdükçe softmax tek bir pozisyona yığılır": "as |x| grows, softmax collapses onto a single position",
  "step << warmup iken ikinci kol küçüktür": "while step << warmup the second branch is smaller",
  "step = warmup noktasında iki kol eşitlenir": "at step = warmup the two branches are equal",
  "\\operatorname{softmax}(x)_i = \\frac{e^{x_i}}{\\sum_j e^{x_j}} \\;\\xrightarrow[\\;|x| \\to \\infty\\;]{}\\; \\text{tek noktaya yığılma}":
    "\\operatorname{softmax}(x)_i = \\frac{e^{x_i}}{\\sum_j e^{x_j}} \\;\\xrightarrow[\\;|x| \\to \\infty\\;]{}\\; \\text{collapse onto one position}",
  "\\text{step} \\ll \\text{warmup} \\;\\Rightarrow\\; \\text{step} \\cdot \\text{warmup}^{-1.5} \\text{ küçüktür}":
    "\\text{step} \\ll \\text{warmup} \\;\\Rightarrow\\; \\text{step} \\cdot \\text{warmup}^{-1.5} \\text{ is smaller}",
}));

const translatePhrases = (node) => {
  if (typeof node === "string") return PHRASES.get(node) ?? node;
  if (Array.isArray(node)) return node.map(translatePhrases);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === "excerpt" ? v : translatePhrases(v)]));
  }
  return node;
};

const translated = translatePhrases(p);

if (missing.length) {
  console.error(JSON.stringify({ ok: false, missing }, null, 2));
  process.exit(1);
}

/* Kalan Türkçe düzyazı var mı? Alıntılar hariç tutulur. */
const turkish = [];
const scan = (node, path) => {
  if (typeof node === "string") {
    if (/[çğışöüÇĞİŞÖÜ]/.test(node) && !/excerpt$/.test(path)) turkish.push({ path, sample: node.slice(0, 70) });
    return;
  }
  if (Array.isArray(node)) return node.forEach((item, i) => scan(item, `${path}[${i}]`));
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) scan(value, `${path}.${key}`);
  }
};
scan(translated, "root");

const out = join(root, "examples/attention-is-all-you-need.en.trace.json");
if (turkish.length) {
  console.error(JSON.stringify({ ok: false, remainingTurkish: turkish.slice(0, 20) }, null, 2));
  process.exit(1);
}

writeFileSync(out, `${JSON.stringify(translated, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, out }, null, 2));
