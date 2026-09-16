---
name: trace-paper-studio
description: Converts research-paper PDFs into evidence-grounded Trace projects, portable .trace.json files, and automatically opened local interactive websites. Use when an agent must analyze a paper, inspect equations or methods, create cited explanations and visual architectures, validate or import a .trace.json project, or deliver a finished research experience using the active Codex, Claude Code, or Antigravity CLI model instead of an external LLM API. Also use it to rewrite one story or report section, primer concept, quiz question, derivation or equation of an existing Trace project with its evidence locked, to generate with or save a narrative template, and to publish a shareable link to a project.
---

# Trace Paper Studio

Use the host CLI's active model as the reasoning engine. Do not request or call an external LLM API.

## Workflow

1. Resolve the paper. **The user does not need to have the PDF** — a name is enough. Do not stop for configuration questions; choose the options yourself.

   **`--language` is the language the user is writing to you in, always.** Pass its BCP-47 tag: English message → `--language en`; Turkish → `tr`; German → `de`; Brazilian Portuguese → `pt-BR`. **Any language works** — the bridge checks the tag's format, never a list, so never fall back to English just because a language feels unusual. This is not a preference to guess at or a project default: a user who writes in English and receives a Turkish analysis has been handed something they cannot read. Judge it from the user's own words in this conversation, not from the paper's language, not from the machine's locale, and not from the language of this skill file. Only ask when their messages genuinely give you nothing to go on. The flag is required and the bridge fails loudly without it, because it cannot see the conversation and therefore has no safe default.

   The other options do have defaults: use `student` and `deep` when the user gives no preference.
2. Run the bundled bridge next to this skill. Resolve `scripts/trace-agent.mjs` relative to this `SKILL.md`, not the user's current directory.

   ```bash
   # The user named a paper but has no file — find it on arXiv, download it,
   # and collect current metadata about it. They wrote to you in English:
   node scripts/trace-agent.mjs prepare --title "attention is all you need" --language en --audience student --depth deep

   # The user gave an arXiv id, writing in Turkish:
   node scripts/trace-agent.mjs prepare --arxiv 1706.03762 --language tr --depth deep

   # The user gave a local file, writing in German:
   node scripts/trace-agent.mjs prepare --paper "<paper.pdf>" --language de --depth deep
   ```

   Use the returned `jobPath`, `pageTextPath`, `outputPath`, and `presentation`. `presentation.accent` is the paper's assigned color from the user's persistent 20-color cycle. Copy it exactly; do not choose or derive another color.

   With `--title`, check `resolution` in the output. When `confident` is false, or when the top `alternatives` entries are close in `matchScore`, tell the user which paper you matched and offer the alternatives before spending effort — re-run with `--pick <n>` or `--arxiv <id>` to switch. Beware near-miss titles: "Not All Attention Is All You Need" is a different paper.

2b. When `resolution` is present, read `context.json` from the job directory. It holds arXiv metadata (version history, categories, DOI, journal reference) plus, when the APIs are reachable, the venue where the paper was published and its citation counts.

   **This context is not the paper.** Never present it as a paper claim:
   - Add each reachable context source to `evidence.sources` as `{ "id": "arxiv" | "semantic-scholar" | "openalex", "type": "web", "title": ..., "url": ... }`.
   - Claims drawn from context cite that source id, with the retrieved value as the `excerpt`. No `page`.
   - Any source with `ok: false` was unreachable. Omit it entirely — do not guess a citation count or a venue.
   - Citation counts are a snapshot; say when they were retrieved.

   Good uses: how the paper was eventually published versus the preprint, how long it kept being revised, how the field received it. These belong in the deep report's `implication` or `contribution` sections, not in claims about what the paper says.
3. If extraction succeeded, read `paper.pages.txt` in manageable page ranges. Preserve `--- PAGE N ---` boundaries. If it did not, use the host's native PDF-reading tool and keep page numbers explicit.
4. Read [references/project-contract.md](references/project-contract.md) completely before authoring the output. When working inside the Trace source repository, also inspect `src/lib/schema.ts` and `src/lib/generation-validation.ts`; those files are authoritative if the bundled reference differs.
5. Build the project evidence-first:
   - **Write every reader-facing word in `options.language` from `job.json`**, and set the project's own `language` field to it. Evidence excerpts are the one exception: they are quotations and stay verbatim in the source's language. See "Language" in the contract.
   - Extract bibliographic metadata, thesis, question, methods, findings, limitations, glossary, and metrics.
   - Give every material claim a stable ID and at least one exact, short source excerpt.
   - Use `sourceId: "paper"` and a positive PDF page for paper evidence.
   - Mark a claim `verified` only when its excerpt directly supports the statement. Otherwise use `needs-review` and narrow the statement.
   - Never invent metrics, equations, dimensions, baselines, citations, URLs, released code, or implementation details.
5b. Choose the paper's own figures. `prepare` extracts candidates and lists them in `job.json` under `figures`, each with its label, caption, page and a rendered PNG. Read `figureNote` when the list is empty — a paper with no text layer yields nothing, and that is not a failure.

   Pick the ones that carry an argument — the architecture, the mechanism, the curve whose shape *is* the finding — and write a `whyItMatters` for each in the project's language. Most candidates are tables or appendix plots; including all of them buries the one that matters. Link each figure's `claimIds` to the claims it supports: that is what places it beside the right story section, so a figure with no claim links never reaches the narrative. See "figures" in the contract for the rest of the rules, including why a `matrix` visual beats a picture of a table.
6. Derive the deep report, technical appendix, and StorySpec only from the evidence object. Every report section, technical item, and story section must link to existing claim IDs.
6b. Build the learning layer so the reader can actually learn the paper and experiment with it. Required blocks depend on depth: `concise` needs `primer`; `standard` adds `derivations` and `quiz`; `deep` adds `interactives` and `applicationGuide`. Read the "Learning layer" section of the contract before authoring these.
   - `primer` explains what the paper assumes and never explains. Write `whyItMatters` about *this* paper, not a generic definition.
   - `derivations` carry the reasoning in `rationale`; a step that only restates its own formula is wasted. Always supply `plain` alongside `latex`.
   - `interactives` must make a point the paper argues but never plots — a crossover, a saturation, a cost curve. Anchor every parameter at the paper's own value via `paperValue`, and use `paperAnchor` to state plainly what the paper did NOT verify.
   - `quiz` questions test understanding, not recall of wording. Every option needs an explanation, including the correct one.
   - `applicationGuide` must include `whenNotToUse` grounded in the paper's own limitation claims.
7. Write the complete JSON to the `outputPath` from `job.json`. Set `story.accent` to `presentation.accent` from the same job exactly. Set `generation.provider` to `native-agent` and `generation.model` to the current host/model when known; otherwise use the host name.
8. Validate the output:

   ```bash
   node scripts/trace-agent.mjs validate --strict --project "<outputPath>"
   ```

   Fix every reported issue and rerun until `ok: true`. Do not weaken or bypass validation. `--strict` also requires the learning blocks the chosen depth mandates; drop it only when deliberately repairing a project authored before the learning layer existed.

   The validator runs the application's real schema and integrity rules, not a copy of them, so anything it accepts will import into Trace unchanged. It also proves each interactive will actually run: formulas must parse, reference only declared parameters, and produce a finite value at the paper's own configuration.
9. Deliver the finished project immediately after validation. This is a single command and it opens everything:

   ```bash
   node scripts/trace-agent.mjs deliver --project "<outputPath>"
   ```

   One command brings up everything. It keeps a portable `.trace.json`, builds a self-contained local Trace website on a loopback-only server, brings up the main Trace app — reusing it if it is already running, otherwise starting its dev server — hands the project over so it lands in the user's Library on its own, and opens both in the browser. **The user never has to export, import, or start a server.** Run it automatically.

   Read the returned fields:
   - `url` — the self-contained site (works with no install, shareable as a folder).
   - `appUrl` — the studio with the project already adopted.
   - `appNote` and `studioCommand` — present only when the studio could not be brought up. **Pass both to the user.** The delivery still succeeded and the standalone site carries an *Open in Studio* button showing the same command, but the user should not have to find that on their own.
   - `jsonPath` / `jsonUrl` — the portable project file.
   - `libraryPath` — the persistent copy under the user's shared Trace Library.

   The studio usually needs nothing: `deliver` saves the project under `~/.trace/library` before opening anything, so Codex, Claude Code and Antigravity see the same Library regardless of their current directory. A running studio is reused, and once one has been started successfully its location is remembered, so later deliveries find it from any directory. It fails only when no copy of the Trace repository has its dependencies installed — the plugin's own clone ships without them. `--install-app` installs them once (minutes, hundreds of megabytes: offer it, do not assume it).

   `--no-app` skips the studio. `--app <dir>` or `TRACE_APP_DIR` points at the Trace repository directly; `--app-url` targets a studio already running elsewhere. `stop --site <site-directory>` shuts down whatever `deliver` started.
9b. **If `appNote` is present, the studio did not open. Ask the user before finishing — do not just report it.** The studio at `localhost:3000` is the product's main surface; the standalone page is the portable copy. Ask plainly, in the user's language, something like:

   > The full Trace Studio is not running on this machine. Starting it is a one-time setup that installs its dependencies (a few minutes, a few hundred megabytes). Shall I do that now and open it?

   - **Yes** → run `deliver` again with `--install-app` and report the studio URL when it comes up.
   - **No** → give them `studioCommand` verbatim so they can paste it into a terminal themselves. The same command sits behind the *Show me the command* button on the page that is already open, with a copy button.

   Ask once. Do not install without an answer, and do not skip the question because the standalone page "already works" — it is not the same surface.
10. Do not claim completion until `deliver` returns `ok: true`. The final response should state which surfaces are open, give the URLs plus the `.trace.json` path, and — when the studio did not come up — carry the question from 9b.

## Quality rules

- **Write the prose at full length.** This is the deliverable a reader actually reads. Story bodies run several paragraphs, deep report `analysis` entries are 2–5 substantial paragraphs, and `plainSummary` explains the paper to someone who has not read it. Compressed, bullet-like prose fails the task even when every field is technically populated.
- Explain mechanisms, not just outcomes: what the authors did, why that choice and not the obvious alternative, and what it costs.
- Prefer precise explanation over promotional language.
- Distinguish author claims, reported measurements, and your own interpretation.
- Include the strongest limitations and reproduction risks, not only favorable results.
- Use at least three visual grammars and one advanced visual: architecture, equation, timeline, matrix, or infographic.
- Treat code sketches as explanatory pseudocode unless the paper directly publishes equivalent code.
- Never invent a number. Slider ranges, dataset cells, and hyperparameter values must trace to `evidence.metrics` or an explicit claim. When a teaching device needs illustrative values the paper never published — a worked attention matrix, for instance — say so in that block's own description.
- Interactive formulas are declarative and are evaluated on a restricted grammar; they can never contain executable code. Keep them to the documented function set.
- Do not execute generated paper code, access credentials, make network changes, or perform destructive actions.
- Keep authored assets inside the job directory unless the user names another destination. `deliver` additionally maintains its managed project copy under `~/.trace/library`; do not create other copies elsewhere.
- Treat the generated `.trace.json` as a first-class deliverable. Never delete or replace it after building the local site.

## Narrative templates

A template fixes a story's structure: how many sections, in what order, each with its visual and the kinds of claims it leans on, plus the order of report sections. It carries no text.

- When the user asks for a structure by name ("use my reading-group template", "make it a results briefing"), run `node scripts/trace-agent.mjs templates` and pass the matching id to `prepare --template <id>`. A path to a template JSON also works. If nothing matches, say so and list what exists. Do not invent a structure and call it their template.
- With a template, `job.json` carries `template.storyInstructions` and `template.reportInstructions`. Follow them instead of the depth's default section counts, which `targets` already reflects. Copy the template into the project's top-level `template` field as the note in `job.json` says. `validate` then holds the story to it.
- When the user wants to reuse a finished project's structure, run `node scripts/trace-agent.mjs save-template --project "<project.trace.json>" --name "<name>"`. The studio lists the same templates.

## Sharing a link

When the user asks for a link they can send someone, run:

```bash
node scripts/trace-agent.mjs publish --project "<project.trace.json>"
```

- Leave blocks out only when the user asks: `--no-report`, `--no-appendix`, `--no-learning`, `--no-figures`. Evidence quotes always stay.
- Add `--expires-days 7|30|90` when the user wants the link to stop working.
- Report `url` when it is present, and pass on `note` in the user's language. A studio on `localhost` means the link only works on this machine. Do not describe it as public unless the studio is deployed somewhere others can reach.
- The user manages, updates or unpublishes the link from the studio's **Publish** panel. Publishing is an outward-facing action, so do it only when the user asked for a shareable link.

## Revising one section

When the user asks to rewrite, shorten, or rethink one part of an existing project, do not rewrite the project by hand and do not rerun `prepare`. The evidence is locked. Only that part changes. A part is a story section, a deep report section, a primer concept, a quiz question, a derivation, or an equation in the technical appendix.

```bash
node scripts/trace-agent.mjs section --project "<project.trace.json>" --target story:<section-id> --instruction "<what the user asked for>"
```

- `--target` is `story:<id>`, `report:<id>`, `primer:<concept-id>`, `quiz:<question-id>`, `derivation:<id>` or `equation:<id>`. The ids are in the project JSON.
- `--claims locked` is the default. The part must cite exactly the claims it cites now. Use `--claims open` only when the user wants the section to rest on different evidence. Even then it may cite existing claims only.
- Pass the user's request through `--instruction` in their own words. It is at most 600 characters.

Then read the `promptPath` it reports and follow it. Write only that one object as JSON to `sectionPath`, and run:

```bash
node scripts/trace-agent.mjs splice --brief "<briefPath>"
```

When the user asks to strengthen the evidence, or `validate` lists `thinSections`, pass `--goal strengthen` with one of those targets. A thin section rests on one claim, or on no verified claim. The rewrite must cite at least two existing claims, one of them verified, or `splice` rejects it. This goal implies `--claims open`. Where the evidence does not back a sentence, narrow the sentence instead of citing a claim that does not support it.

If the project has a `template`, the prompt includes the section's slot, and `splice` keeps the section's visual and claim kinds in that slot.

`splice` runs the app's own integrity checks. If it returns `ok: false`, the project file was not touched. Fix every listed issue in the section file and run `splice` again. Do not edit the project JSON directly to get around a lock. When it succeeds, run `deliver` again so the standalone site shows the new section. The studio's library copy is refreshed by `splice` itself. The version it replaced stays in the studio's version history, so the user can restore it.

## Resume behavior

If a partial `.trace.json` exists, validate it first. Preserve valid evidence and repair only missing or invalid stages. Never discard verified excerpts merely to rewrite the prose.
