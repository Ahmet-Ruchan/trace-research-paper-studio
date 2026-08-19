# Trace project contract

Produce one JSON object. Do not wrap it in Markdown.

## Project root

Required fields:

- `version`: exactly `1`
- `id`: stable kebab-case or UUID string
- `createdAt`, `updatedAt`: ISO-8601 strings
- `language`: `tr` or `en`
- `audience`: `general`, `student`, or `expert`
- `depth`: `concise`, `standard`, or `deep`
- `evidence`: required evidence graph
- `story`: required StorySpec
- `deepReport`: recommended
- `technicalAppendix`: recommended
- `generation`: `{ "provider": "native-agent", "model": "<host/model>" }`

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

`story` contains `title`, `dek`, `readingTime`, a six-digit hex `accent`, `sections`, and `closing: { title, body }`.

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
