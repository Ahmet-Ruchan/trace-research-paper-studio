# Trace project contract

Produce one JSON object. Do not wrap it in Markdown.

## Project root

Required fields:

- `version`: exactly `1`
- `id`: stable kebab-case or UUID string
- `createdAt`, `updatedAt`: ISO-8601 strings
- `language`: BCP-47 tag, copied from `options.language` in `job.json` (`en`, `tr`, `de`, `pt-BR`, …)
- `audience`: `general`, `student`, or `expert`
- `depth`: `concise`, `standard`, or `deep`
- `evidence`: required evidence graph
- `story`: required StorySpec
- `deepReport`: recommended
- `technicalAppendix`: recommended
- `generation`: `{ "provider": "native-agent", "model": "<host/model>" }`
- `template`: only when `job.json` has a `template`. Copy that object without its `storyInstructions`, `reportInstructions` and `note` fields.

### Language

`language` is not a label on the file — it is a binding instruction. **Write every word a reader will see in that language**: titles, summaries, story bodies, report analysis, glossary definitions, equation explanations, derivation rationale, quiz questions and their explanations, interactive captions, and the application guide. Copy the value from `options.language` in `job.json`; never override it because the paper is written in another language.

Any BCP-47 tag is valid — there is no list of supported languages. A regional tag means what it says: `pt-BR` is Brazilian Portuguese, not European Portuguese, and `zh-Hans` is Simplified. Honour the distinction rather than flattening it to the base language.

Three things stay untouched whatever `language` says:

- **JSON keys and enum values** — always `en`-style identifiers (`storySections`, `verified`, `needs-review`). They are protocol, not prose.
- **Quoted evidence excerpts** — an excerpt is a verbatim quotation from the source. Reproduce it exactly as printed, in the source's own language. Never translate one. The claim *statement* around it is prose and follows `language`.
- **Proper nouns and established technical terms** — author names, model names, dataset names, metric names. Keep "Transformer", "BLEU", "WMT 2014" as they are; do not invent local translations for them.

Depth controls exact output size:

| Depth | Story sections | Report sections |
| --- | ---: | ---: |
| `concise` | 5 | 6 |
| `standard` | 6 | 7 |
| `deep` | 8 | 9 |

## Evidence

`evidence` contains:

- `paper`: `{ title, authors: string[], year, venue, doi? }`
- `sources`: at least `{ "id": "paper", "type": "paper", "title": "...", "fileName": "..." }`
- `thesis`, `plainSummary`, `researchQuestion`: strings
- `methods`, `findings`, `limitations`: non-empty string arrays
- `claims`: at least four claims
- `metrics`: array; use an empty array when no numeric result is verified
- `glossary`: array

Each claim:

```json
{
  "id": "claim-method-01",
  "statement": "A narrowly supported statement.",
  "kind": "method",
  "confidence": "verified",
  "sourceRefs": [
    {
      "sourceId": "paper",
      "page": 3,
      "excerpt": "A short exact excerpt from page 3.",
      "locator": "Section 2"
    }
  ]
}
```

Allowed claim kinds: `reported-result`, `author-interpretation`, `method`, `background`, `limitation`. Include at least one `method`, one `limitation`, and one `verified` claim.

Each metric:

```json
{
  "id": "metric-01",
  "label": "BLEU",
  "value": 28.4,
  "displayValue": "28.4",
  "unit": "BLEU",
  "context": "Test set and model context",
  "sourceRef": { "sourceId": "paper", "page": 8, "excerpt": "Exact result excerpt." }
}
```

Never convert a qualitative adjective into a numeric metric.

## StorySpec

`story` contains `title`, `dek`, `readingTime`, a six-digit hex `accent`, `sections`, and `closing: { title, body }`. For a prepared native-agent job, `accent` must exactly equal `presentation.accent` in `job.json`. Trace assigns that value from a shuffled, persistent 20-color cycle; never replace it with a model-selected color.

Each section contains:

- `id`, `indexLabel` (`01`, `02`, ...), `kicker`, `title`, `body`
- `claimIds`: one or more existing evidence claim IDs
- `visual`: one of the visual objects below

Every visual starts with `type`, `eyebrow`, and `caption`.

Supported visual shapes:

- `metric`: `items: [{ label, value, note }]`
- `flow`: `items: [{ label, detail }]`
- `comparison`: `items: [{ label, value: number, displayValue, highlight: boolean }]`; every numeric value must exist in evidence metrics
- `concept`: `center`, `items: [{ label, detail }]`
- `layers`: `items: [{ label, detail, tone }]`, where tone is `paper`, `accent`, or `ink`
- `quote`: `quote`, `attribution`
- `architecture`: 3–8 `nodes: [{ id, label, detail, group }]` and 2–12 `edges: [{ from, to, label }]`; group is `input`, `core`, `output`, or `evidence`
- `equation`: `formula`, 2–7 `terms: [{ symbol, label, detail }]`, and 2–5 `steps`
- `timeline`: 3–7 `items: [{ label, detail, tone }]`
- `matrix`: 2–5 `columns` and 2–6 `rows: [{ label, cells }]`; each cell is `{ label, tone }`, tone is `low`, `medium`, `high`, or `neutral`; cell count must match column count
- `infographic`: 3–6 `items: [{ label, detail, badge }]`

Use at least three distinct visual types and at least one of `architecture`, `equation`, `timeline`, `matrix`, or `infographic`.

### Narrative template

When the project has a `template`, it fixes the structure and `validate` enforces it:

- The story has exactly as many sections as `template.story`, in the same order.
- Each section's `visual.type` equals its slot's `visual`. A `comparison` or `metric` slot may use another visual only when `evidence.metrics` is empty.
- Each section cites at least one claim of a kind listed in its slot's `claimKinds`, when the evidence has claims of that kind.
- When `template.report` is present, the deep report has exactly those section kinds, in that order.

The slot's `purpose` describes the section's job. Every fact still comes from the evidence.

## Deep report

`deepReport` contains `title`, `dek`, `readingTime`, `sections`, and 3–8 `openQuestions`.

Each section is `{ id, kind, title, summary, analysis, claimIds }`. `analysis` has 2–5 paragraphs. Across the report, include every kind: `contribution`, `mechanism`, `experiment`, `critique`, `reproduction`, `implication`. Additional sections may repeat a kind for deep mode.

## Technical appendix

`technicalAppendix` contains `title`, `overview`, and:

- `equations`: up to eight `{ id, label, expression, explanation, variables, claimIds }`
- `algorithmSteps`: 2–10 `{ label, detail, claimIds }`
- `codeSketches`: up to three `{ title, language, code, explanation, claimIds }`
- `complexity`: up to six `{ operation, cost, context, claimIds }`
- `implementationNotes`: 2–10 strings

Every technical item must cite existing claim IDs. Omit unsupported equations or code rather than inventing them. At least one technical item must exist.

## `figures` — the paper's own pictures

Optional, up to six. Everything else in this contract *redraws* the paper in Trace's own grammar. This block does the opposite: some figures cannot be redrawn, because the drawing itself is the thing people remember — the Transformer's architecture diagram, ResNet's residual block, ViT's patch pipeline.

`prepare` extracts candidates into the job directory and lists them in `job.json` under `figures`, each with its label, its own caption, its page and a PNG path. **Choosing is your job.** A paper yields up to ten candidates and most are tables or appendix plots; picking all of them buries the two that matter.

```json
{
  "id": "figure-p3-1",
  "label": "Figure 1",
  "caption": "Figure 1: The Transformer - model architecture.",
  "whyItMatters": "The whole argument in one picture: the stacks contain no recurrence and no convolution.",
  "page": 3,
  "image": "data:image/png;base64,…",
  "claimIds": ["claim-method-01"]
}
```

- **Include a figure only when it carries an argument.** An architecture, a mechanism, a topology, a curve whose shape is the finding. Skip decorative plots and sample grids.
- **Prefer a table over a picture of a table.** A `matrix` visual is searchable, themeable and readable on a phone; a screenshot of the same table is none of those. Use a figure image only when the layout itself cannot be reconstructed.
- `caption` is the paper's own sentence. Copy it, do not rewrite or translate it — like an excerpt, it is a quotation.
- `whyItMatters` is **yours**, written in the project's `language`. Say what the reader should see in it and what the paper argues from it. Repeating the caption is rejected by validation.
- `image` must be the embedded data URI produced by `prepare`. A remote URL is rejected: the standalone viewer runs under `default-src 'none'`, so it would never load, and a shared file must not depend on a host staying up.
- **`claimIds` decides where the figure appears.** A figure is shown beside the story section built on the same claims, so a figure that shares no claim with any section never reaches the narrative — it stays in the overview alone. Link it to the claims it actually supports, and the placement follows.
- Six figures at most, and roughly 1.4 MB of images in total. Both are enforced.

Never source a picture from the web. A web image cannot be shown to depict *this* paper, and an unverifiable diagram is worse than an unverifiable number: it looks authoritative. Every figure here is anchored to a page in the PDF you were given.

---

## `excerptCheck` — written by `verify`, never by hand

Optional. `node scripts/trace-agent.mjs verify --project <path>` searches for every paper excerpt on the page it cites, in the text extracted from the PDF, and writes this record:

```json
{ "checkedAt": "2026-09-21T22:45:45.120Z", "method": "pdftotext", "pageCount": 15, "checked": 67,
  "unlocated": [{ "owner": "claim", "id": "result-bleu-en-de", "page": 8 }] }
```

- `unlocated` lists only what was **not** found (`owner` is `claim`, `metric` or `glossary`). An empty list means every quote was found.
- A `verified` claim none of whose paper excerpts were found is changed to `needs-review` by the same command. Nothing is upgraded.
- Do not author or edit this block, and do not set a claim back to `verified` after `verify` lowered it. Fix the excerpt (copy the exact words from `paper.pages.txt`) and run `verify` again.
- A project without this block is shown as "quotes not checked", not as passing.

## `claimReviews` — written by a person, never by an agent

Optional. A map from claim id to a human reviewer's decision, made in the studio's Review queue:

```json
{ "result-bleu-en-de": { "status": "approved", "by": "Ada", "at": "2026-09-22T10:00:00.000Z", "note": "Checked Table 2." } }
```

`status` is `approved` or `rejected`. It lives at the project root, not inside the claim, so that a model can never produce "approved" claims. It does not change `confidence`. Leave the block exactly as you found it. A section rewritten with `--claims open` may not cite a rejected claim.

# Learning layer

Five optional root blocks turn a summary into something the reader can learn from and experiment with. Which ones are **required** depends on `depth`:

| `depth` | Required blocks |
| --- | --- |
| `concise` | `primer` |
| `standard` | `primer`, `derivations`, `quiz` |
| `deep` | `primer`, `derivations`, `quiz`, `interactives`, `applicationGuide` |

`validate --strict` enforces this. Plain `validate` does not, so projects authored before this layer still pass.

Everything here obeys the same evidence rule as the rest of the contract: **every block links to existing claim IDs, and no numeric value may be invented.** Slider ranges, table cells, and hyperparameter defaults must trace to `evidence.metrics` or to an explicit claim. When a teaching device needs illustrative numbers the paper never published (a worked attention matrix, for example), say so in that block's own `description`.

## `primer`

`{ title, overview, concepts }` with 3–12 concepts. This is the background the paper *assumes and never explains*.

```json
{
  "id": "softmax",
  "term": "Softmax",
  "level": "temel",
  "intuition": "Plain-language explanation, no jargon, no formula.",
  "formal": "\\operatorname{softmax}(x)_i = \\frac{e^{x_i}}{\\sum_j e^{x_j}}",
  "whyItMatters": "Why THIS paper needs it — not a generic definition.",
  "prerequisiteIds": ["dot-product"],
  "claimIds": ["claim-method-05"]
}
```

`level` is `temel` | `orta` | `ileri`. `prerequisiteIds` must reference other concepts in the same primer and may not be self-referential; the renderer topologically sorts on them. `formal` is optional LaTeX.

## `derivations`

Up to six. Each is `{ id, title, goal, steps, numericExample?, claimIds }` with 2–10 steps.

```json
{
  "id": "s4",
  "latex": "\\sigma(q \\cdot k) = \\sqrt{d_k}",
  "plain": "σ(q · k) = √d_k",
  "rationale": "WHY this step follows — the reasoning, not a restatement of the formula.",
  "shapes": "q: (d_k,) · k: (d_k,) → skaler"
}
```

`plain` is mandatory: it is the fallback when MathML cannot render and the screen-reader label. `rationale` carries the teaching value — a step that only restates its own formula is wasted. `numericExample` is `{ setup, walkthrough (1–6 lines), result }` and should end somewhere the reader can verify against the paper's own numbers.

## `interactives`

Up to eight. Three kinds, discriminated by `kind`.

**Formulas are never executable code.** They are parsed by a restricted grammar and evaluated on a pure AST — there is no `eval`, no `new Function`, and no property access. Available: `+ - * / % ^`, parentheses, unary minus, the constants `pi` and `e`, and the functions `abs sqrt exp ln log2 log10 log floor ceil round sign sin cos tan tanh pow min max clamp sigmoid`. Anything else fails validation.

### `formula-playground`

```json
{
  "kind": "formula-playground",
  "id": "play-scaling",
  "title": "...", "description": "...",
  "parameters": [
    { "name": "d_k", "label": "Anahtar boyutu d_k",
      "min": 1, "max": 512, "step": 1, "paperValue": 64, "unit": "" }
  ],
  "outputs": [
    { "id": "scale", "label": "1/√d_k", "formula": "1 / sqrt(d_k)", "precision": 4 }
  ],
  "chart": { "xParam": "d_k", "series": [{ "outputId": "scale", "label": "..." }],
             "samples": 120, "yScale": "linear" },
  "paperAnchor": "What configuration the paper actually used, and what it did NOT verify.",
  "claimIds": ["claim-method-05"]
}
```

1–4 parameters, 1–4 outputs. `name` must be a valid identifier, because the formulas reference it. `paperValue` is the paper's own configuration — it is marked on the slider and the chart, and the reader is warned when they leave it. It must lie inside `[min, max]`.

Validation rejects a formula that fails to parse, references an undeclared parameter, or does not produce a finite value **at `paperValue`**. That last rule matters: an interactive that is broken before the reader touches anything is worse than no interactive.

Choose ranges that make a real point. The strongest playgrounds show a *crossover* or a *saturation* the paper argues for but never plots.

### `mechanism-simulation`

`{ kind, id, title, description, stageNodes (2–10), frames (2–12), claimIds }`.

```json
{ "label": "√d_k ile ölçekle", "caption": "What changes at this step and why.",
  "activeNodeIds": ["scores", "scale"],
  "grid": { "rowLabels": ["kedi"], "columnLabels": ["kedi"], "values": [[1.01]] } }
```

`activeNodeIds` must reference declared `stageNodes`. `grid` is optional per frame; when present, `values` must be exactly `rowLabels.length × columnLabels.length` and every cell finite. The renderer shades cells by relative magnitude, so a grid is the right way to show attention weights evolving.

### `dataset-explorer`

`{ kind, id, title, description, columns (2–8), rows (2–40), defaultSort?, sourceRef, claimIds }`.

Every row's `cells` array must match the column count, and a `number` column may not contain a string — no `"n/a"`, no `"—"`. If the paper's table has gaps, drop those rows or restrict the columns rather than inventing placeholders. `sourceRef` points at the table in the paper and is shown to the reader.

## `quiz`

`{ title, intro, questions }` with 3–12 questions.

```json
{
  "id": "q-complexity",
  "prompt": "...",
  "kind": "single",
  "options": [{ "label": "O(n² · d)", "correct": true, "explanation": "Why — cite the table and page." }],
  "claimIds": ["claim-result-04"],
  "page": 6
}
```

`kind` is `single` | `multi` | `true-false`. `single` and `true-false` need exactly one correct option; `multi` needs at least two; `true-false` needs exactly two options. Every option needs an `explanation`, including the correct one — the reader who guessed right still needs to know why.

Answers are visible in the JSON. That is deliberate: the project must stay portable and inspectable. This is a self-check, not a proctored exam.

## `applicationGuide`

`{ title, overview, recipe (2–8), hyperparameters (≤8), pitfalls (≤6), whenNotToUse (1–5) }`.

`recipe` steps may carry `code: { language, source }`. **Code is explanatory — Trace never executes it and must not imply it is runnable library code.** Prefer showing the wrong way beside the right way; that is where the teaching value is.

`hyperparameters` entries are `{ name, paperValue, range, guidance, claimIds }`. `paperValue` and `range` must come from the paper; if a parameter was never ablated, say so in `guidance` rather than inventing a recommended range.

`whenNotToUse` should cite the paper's own limitation claims. A guide that only says when the method works is advocacy, not teaching.

---

# Context sources

When `prepare` resolved the paper from a name (`--title` / `--arxiv`), the job directory also holds `context.json`: arXiv metadata, and — when reachable — the venue the paper was published in and its citation counts.

This is background *about* the paper. It is not the paper, and it must never be presented as one.

Register each reachable source alongside the PDF:

```json
{ "id": "arxiv", "type": "web", "title": "arXiv:1706.03762v7",
  "url": "https://arxiv.org/abs/1706.03762" }
{ "id": "semantic-scholar", "type": "web", "title": "Semantic Scholar kaydı",
  "url": "https://api.semanticscholar.org/graph/v1/paper/arXiv:1706.03762" }
```

Claims drawn from context cite that source id and carry the retrieved value as the excerpt. They take no `page` — only `sourceId: "paper"` requires one.

```json
{
  "id": "claim-reception-01",
  "statement": "Makale NeurIPS 2017'de yayımlandı ve 20 Ağustos 2026 itibarıyla 189.343 atıf aldı.",
  "kind": "background",
  "confidence": "verified",
  "sourceRefs": [{ "sourceId": "semantic-scholar",
                   "excerpt": "venue: Neural Information Processing Systems · citationCount: 189343",
                   "locator": "2026-08-20 tarihinde alındı" }]
}
```

Rules:

- A source with `ok: false` was unreachable or was skipped as unreliable. **Omit it.** Never guess a citation count, a venue, or a publication date.
- Citation counts are a snapshot. State when they were retrieved, in the statement or the locator.
- Context belongs in the deep report's `contribution` or `implication` sections, and in `plainSummary` framing. It does not belong in claims about what the paper argues.
- Version history is genuinely useful: `published` versus `updated` shows how long a preprint kept moving, and `journalRef` shows where it landed. Both are worth a sentence when they say something.
- Do not let context crowd out the paper. It is framing, not findings.
