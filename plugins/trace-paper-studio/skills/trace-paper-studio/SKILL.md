---
name: trace-paper-studio
description: Turns a research paper (a PDF, title, DOI or repository link) into an evidence-grounded Trace project (.trace.json) and a local interactive site, using the active Codex, Claude Code or Antigravity CLI model instead of an external LLM API. Use it to analyze a paper, explain its equations and methods with cited claims, and validate, import or deliver a .trace.json project. Also use it to rewrite a section, primer concept, quiz question, derivation or equation with the evidence locked; to use or save a narrative template; to publish a shareable link; to check quotes against the PDF text; to export a report, slides, a notebook, BibTeX/RIS or Anki cards; to show the citation graph; to report how each model's quotes held up; to check a reader's explanation of a section; to tell a reader which concepts they studied in other papers and which cited works teach the rest, to order a library for reading, to report a reader's day, study progress, work time, notes and reading list, and to quiz them on due review cards.
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

   # The user gave a DOI, or a bioRxiv / medRxiv / PubMed Central / ACL Anthology /
   # OpenReview link or id:
   node scripts/trace-agent.mjs prepare --doi 10.1101/2021.10.04.463034 --language en
   node scripts/trace-agent.mjs prepare --source "https://aclanthology.org/2020.acl-main.1" --language en

   # The user gave a local file, writing in German:
   node scripts/trace-agent.mjs prepare --paper "<paper.pdf>" --language de --depth deep
   ```

   Use the returned `jobPath`, `pageTextPath`, `outputPath`, and `presentation`. `presentation.accent` is the paper's assigned color from the user's persistent 20-color cycle. Copy it exactly; do not choose or derive another color.

   With `--title`, check `resolution` in the output. When `confident` is false, or when the top `alternatives` entries are close in `matchScore`, tell the user which paper you matched and offer the alternatives before spending effort — re-run with `--pick <n>` or `--arxiv <id>` to switch. Beware near-miss titles: "Not All Attention Is All You Need" is a different paper.

   A title that arXiv cannot match with certainty is also searched on OpenAlex; each alternative carries its `origin` and `pdfAvailable`. The bridge downloads only from arXiv and a short list of open-access repositories. When it reports that no open-access PDF could be downloaded, do not fetch the file from a publisher or any other site yourself: pass the message on, including the link it names, and ask the user for the PDF (`--paper`). The same goes for an OpenReview browser check — ask for the PDF or the paper's title. `resolution.pdfAttempts` lists copies that were tried first and failed.

2b. When `resolution` is present, read `context.json` from the job directory. `source` says where the paper was resolved from; for an arXiv paper `arxiv` adds its metadata (version history, categories, DOI, journal reference). When the APIs are reachable it also holds the venue where the paper was published, its citation counts, and `citationGraph`: the most-cited works the paper references and the most-cited works that cite it.

   **This context is not the paper.** Never present it as a paper claim:
   - Add each reachable context source to `evidence.sources` as `{ "id": "arxiv" | "semantic-scholar" | "openalex", "type": "web", "title": ..., "url": ... }`.
   - Claims drawn from context cite that source id, with the retrieved value as the `excerpt`. No `page`.
   - Any source with `ok: false` was unreachable. Omit it entirely — do not guess a citation count or a venue.
   - Citation counts are a snapshot; say when they were retrieved.

   - `citationGraph` follows the same rules (source id `openalex`). It lists only the most-cited works on each side, so never write that the paper "cites only" or "is cited only by" them. `node scripts/trace-agent.mjs graph --project <project.trace.json>` prints the graph for an existing project; each node's `identifier` can be passed to `prepare --source` when the user wants that paper analysed next.

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
6b. Build the learning layer so the reader can actually learn the paper and experiment with it. Required blocks depend on depth: `concise` needs `primer`; `standard` adds `derivations`, `quiz` and `misreadings`; `deep` adds `interactives` and `applicationGuide`. Read the "Learning layer" section of the contract before authoring these.
   - `primer` explains what the paper assumes and never explains. Write `whyItMatters` about *this* paper, not a generic definition.
   - `derivations` carry the reasoning in `rationale`; a step that only restates its own formula is wasted. Always supply `plain` alongside `latex`.
   - `interactives` must make a point the paper argues but never plots — a crossover, a saturation, a cost curve. Anchor every parameter at the paper's own value via `paperValue`, and use `paperAnchor` to state plainly what the paper did NOT verify.
   - `quiz` questions test understanding, not recall of wording. Every option needs an explanation, including the correct one.
   - `misreadings` are the conclusions a hurried reader would plausibly draw that the evidence does not support, each with a `trap` (`interpretation-as-result`, `beyond-tested`, `number`, `mechanism`) and a `correction` from the cited claims. Real traps of this paper, never strawmen.
   - `applicationGuide` must include `whenNotToUse` grounded in the paper's own limitation claims.
   - Numbers a reader would take for the paper's own (a playground's `paperValue`, table cells, a hyperparameter's `paperValue`, the numbers a worked example starts from, simulation grid values) must appear in the evidence; `validate --strict` lists any that do not. Add the number to `evidence.metrics` with its quote, drop it, or, for values made up to show a mechanism, set `illustrative: true` on the simulation or the `numericExample`.
7. Write the complete JSON to the `outputPath` from `job.json`. Set `story.accent` to `presentation.accent` from the same job exactly. Set `generation.provider` to `native-agent` and `generation.model` to the current host/model when known; otherwise use the host name.
8. Check the quotes, then validate the output:

   ```bash
   node scripts/trace-agent.mjs verify --project "<outputPath>"
   node scripts/trace-agent.mjs validate --strict --project "<outputPath>"
   ```

   `verify` looks for every excerpt on the page it cites, in the text extracted from the PDF, and writes the result into the project (`excerptCheck`). A `verified` claim none of whose excerpts can be found becomes `needs-review`; nothing is ever upgraded. For each `notFound` item, open that page: if you paraphrased, replace the excerpt with the exact words and run `verify` again. If the support really is a table, a figure or an equation that text extraction cannot read, leave the claim `needs-review` and describe it as uncertain in the prose. Never edit `excerptCheck` by hand and never restore `verified` yourself. It needs `pdftotext`; when that is missing, say so to the user instead of skipping the step silently.

   Fix every reported issue and rerun until `ok: true`. Do not weaken or bypass validation. `--strict` also requires the learning blocks the chosen depth mandates; drop it only when deliberately repairing a project authored before the learning layer existed.

   The validator runs the application's real schema and integrity rules, not a copy of them, so anything it accepts will import into Trace unchanged. It also proves each interactive will actually run: formulas must parse, reference only declared parameters, and produce a finite value at the paper's own configuration.
   **Two blocks belong to people and programs, never to you.** `excerptCheck` is written by `verify`. `claimReviews` holds a human reviewer's decision on a claim (approved or rejected, with their name); never create, change or remove an entry, and never approve a claim on the user's behalf. When you rewrite a section with `--claims open`, `splice` refuses a section that cites a claim a reviewer rejected.

   When the user asks a question about a finished project, answer only from its `evidence.claims`, `metrics` and `glossary`, name the claim ids and pages you used, and say so plainly when the collected evidence does not cover the question. Do not fill the gap from what you know about the paper. `node scripts/trace-agent.mjs export --project "<outputPath>" --format <md|html|slides|ipynb|bib|ris|anki>` writes the project in another form when the user asks for one: a Markdown report (Obsidian, Notion), a printable report (the user prints it to PDF), a slide deck, a Jupyter notebook of the paper's equations, a BibTeX or RIS citation (Zotero), or Anki flashcards. Do not write these files by hand; the command keeps every claim's quote and page and translates formulas from their parsed form.
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

## Checking a reader's own explanation

When the user explains a section of a project in their own words and asks whether they got it right, check it against the evidence, not against what you know about the paper:

```bash
node scripts/trace-agent.mjs explain --project "<project.trace.json>" --target story:<section-id> --text "<the user's explanation, verbatim>"
```

- `--target` is `story:<id>` or `report:<id>`. Pass the user's words exactly; use `--text-file <file>` for a long explanation (40–3000 characters).
- Read the `promptPath` it reports and follow it. It holds only the evidence ledger, the section and the user's text: judge from those alone. Write the feedback object as JSON to `feedbackPath`, then run:

```bash
node scripts/trace-agent.mjs explain-check --brief "<briefPath>"
```

`explain-check` applies the studio's own rules: every claim id must exist, "left out" may only name the claims the section rests on, and every quoted phrase must be the user's exact words. If it returns `ok: false`, fix the feedback file and run it again. When it succeeds, tell the user what they conveyed, what they left out and where the evidence says otherwise, each with the claim and its page, and say plainly that this is a model's reading of their text against the collected evidence, not a grade. Nothing is written to the project.

When the project is in the Trace library, `explain-check` also keeps the explanation with the user's study progress (`history.saved`), where the studio shows it under "Your earlier explanations". Pass `--model <name>` with the model you are running. If `history.sinceLast` is set, the user explained the same section before: tell them what they conveyed this time and not last time, what they conveyed before and left out now, and what they left out both times, with the count (`before` → `after`). Checking the same text twice records it once. Pass `--no-save` when the user does not want the explanation kept.

## Concepts across the library

When the user asks what they already know from other papers, which concepts of a project are new to them, or what to read next, run:

```bash
node scripts/trace-agent.mjs concepts --project "<project.trace.json>" --suggest
```

For each primer concept of the project it lists `studiedHere`, `studiedIn` (another paper of the library where the user studied it, from the studio's study progress) and `alsoIn` (other papers that explain it). `--suggest` adds `suggestions`: works among the paper's references (the 50 most-cited, from OpenAlex) whose title (`where: "title"`) or, failing that, abstract (`where: "abstract"`, with the sentence as `excerpt`) names a concept the user has not studied anywhere. Without network, pass `--references <file>` instead: a JSON array of titles or `{ "title", "year", "abstract" }` objects, or one title per line, read from the paper's bibliography. Without `--project` it prints the library's concept map, the concepts more than one paper explains, and `readingOrder`: each paper after the papers that define (in their glossary) a concept it assumes (in its primer), with `next`, the first paper the user has not finished. With `--project`, `readFirst` lists the library papers that define what this one assumes, and whether the user studied them.

- Say where each concept was studied, with the paper's title, and suggest skimming those parts. Concepts are matched by name, never by meaning: do not claim that two differently named concepts are the same, and do not add links it did not report.
- Present a suggestion as a work whose title or abstract names the concept, not as a recommendation of its quality. For an abstract match, quote its `excerpt`: OpenAlex occasionally attaches an abstract to the wrong work, and the sentence shows it. A suggestion with `inLibrary` is already analysed: point to that project instead of analysing it again. Otherwise offer `prepare --source <identifier>` for it.
- When the user asks what to read next, lead with `readingOrder.next` and say why, from `after`: which concepts it defines that a later paper assumes. Papers in `together` each define something the other assumes; suggest reading them side by side.
- Concepts under different names are two concepts until the user links them. `concepts --names` lists every concept name in the library with its paper's definition, and the decisions so far. In a large library the names come in parts (`part` of `parts`), names with similar definitions in the same part: read each with `--part <n>` and look for pairs within it. If you notice two names that clearly mean the same idea (not a special case and its general concept), ask the user; only after they confirm, run `alias --a "<name>" --b "<name>" --proposed-by model --reason "<why>"`. If they say no, record `--different` so the pair is not raised again. Never link on your own.
- This is about the user, not the paper: never write it into the project.

## Today

When the user asks what to do today, where they left off, or how their day is going, run:

```bash
node scripts/trace-agent.mjs today
```

It reads the user's own record in the studio and prints the day in one answer: review cards due now and from which papers (`review`), papers they started studying and left, with steps done (`continueStudying`), what to read next (`readNext`: the next paper in the library's reading order, a work on their reading list, or a paper not started yet), today and this week against the daily goal with the streak (`work`), and the papers finished and cards reviewed this week against the weekly learning goal the user set on their profile (`learningThisWeek`, `goal: null` when none). `suggestions` says the same in order of importance, as sentences for the user: give them briefly in that order and offer to start with the first. Cards are answered in the studio (Review). It is the user's own record: never write it into a project.

## Review in the chat

When the user asks to review, to be quizzed on what they studied, or to go through their due cards here, run:

```bash
node scripts/trace-agent.mjs review [--limit 10]
node scripts/trace-agent.mjs review --show --id <library id> --card <card id>
node scripts/trace-agent.mjs review --answer --id <library id> --card <card id> (--choice <letters> | --typed "<word>" | --remembered yes|no)
```

The first lists the cards due now, mixed across papers, without their answers. Ask them one at a time and never give the answer first. A question (`answerWith: choice`): show its options with their letters and pass the letters the user picks with `--choice`; only that first answer counts, as in the studio (`chooseAll`: every correct letter). A highlight (`typed`): pass the word the user writes with `--typed`; when it does not match (`needsReader`), show the missing word and ask whether they had it, then record `--remembered yes` or `no`. A concept (`remembered`): let the user explain it, show the answer with `--show`, and record what they say with `--remembered`. Each answer is written to the studio's study progress, as if answered in Review: tell the user whether it was right, with the answer and its reason, and when the card comes back (`comesBack`). Only a due card is written. Never answer or decide for the user, and never record a result they did not give.

## Learning progress

When the user asks how their studying is going, what they keep forgetting or what to review, run:

```bash
node scripts/trace-agent.mjs progress
```

It reads the studio's study progress and prints counts, nothing estimated: papers finished and in progress, reviews remembered (`totals.remembered` of `totals.reviews`), questions right on the first try, cards by the days until their next review, the week ahead (days on this machine's clock, `timeZone`), the cards forgotten most (`hardest`: a question, a concept, or a highlight the user turned into a fill-in-the-blank card), and what explaining a section again added. Give every share with its counts ("26 of 34 reviews remembered"); a percentage from a handful of reviews says little. For the hardest cards, suggest rereading where they come from in that paper rather than only reviewing again.

## Work time

When the user asks how much they worked or studied, how the week went against their goal or against last week, when in the day they work best, or which papers their time went to, run:

```bash
node scripts/trace-agent.mjs work [--days 14]
```

It reads the studio's Focus timer record (`~/.trace/focus-log.json`) and prints today, this week and this month against the daily goal, the streak, the last `--days` days, this week against last week (`againstLastWeek`: last week in all and up to this same moment, which is the fair comparison mid-week, and day by day), when in the day the user works over the last four weeks (`hoursOfDay`: the busiest three hours, the busiest weekday, minutes per hour), time by paper this week, last week and in all (`papers`, a session counts for a paper when the user named it on the timer or started the round from its Lab, Study path or Review), and the latest sessions. Sessions of kind `review` are time spent answering review cards in the studio, at most five minutes a card; sessions of kind `study` are time on a paper's Study path, at most twenty minutes a step. A session's `note` is the line the user wrote when that focus round ended (what they did); quote it as written. To put the sessions in the user's calendar, run `work --ics <file.ics> [--days 30]`: it writes a calendar file (one event per session, with the paper and the note) that Google Calendar, Apple Calendar and Outlook import; tell the user where it is. Time where two timers ran at once is counted once, and days follow this machine's clock (`timeZone`). Give times as written ("2h 15m"). It is the user's own record: never write it into a project.

## Reader notes

When the user asks for their notes or highlights on a paper, or to put them in Obsidian or a Markdown file, run:

```bash
node scripts/trace-agent.mjs notes (--project <project.trace.json> | --id <library id>) [--obsidian] [--out <file.md or folder>]
```

It prints (or with `--out` writes) the notes and highlights the user made in the studio, in the paper's order: story sections (highlighted in the Story preview or on the Study path), report sections, Primer concepts, then claims with their page and quote. `--obsidian` adds YAML front matter (title, authors, year, venue, DOI, tags) and callouts; give `--out` the user's vault folder to save it there. The notes are the user's own: keep them as written, and never write them into a project. For the whole library, run `obsidian --out <vault folder>`: it writes a `Trace` folder there with a note per paper (summary, place in the reading order, concepts, the user's notes and highlights), a note per concept two or more papers explain, and `Trace library.md`, all linked; it overwrites only those files.

## Reading list

When the user asks what to read next, or to save a paper for later, run:

```bash
node scripts/trace-agent.mjs reading
node scripts/trace-agent.mjs reading --add "<arxiv:id | DOI | title>" --title "<title>" --for <library id> --relation reference|cited-by|concept [--concept "<term>"]
node scripts/trace-agent.mjs reading --remove "<id>"
```

It prints the works the user saved with Read later in the studio (a paper's citation graph or its concept suggestions) placed in the library's reading order: a work a paper builds on, or that explains a concept it assumes, comes before that paper; a work that cites it comes after. `alsoSaved` holds the rest, and works already analysed (`inLibrary`). Save works found with `graph` or `concepts --suggest` with `--add`; analyse one with `prepare --source <identifier>`. The list is the user's own: never write it into a project.

## Model record

When the user asks which model to trust, how reliable the quotes of the models they used have been, or whether a model makes up quotes, run:

```bash
node scripts/trace-agent.mjs record
```

It reads the Trace library (the one the studio shows) and prints, for each model, `quotesFound` out of `quotesChecked` on their page, `likelyLow`–`likelyHigh` (a 95% range), the papers, and the claims a reviewer approved or rejected. In a model team each quote is counted for the model that wrote it. Report the numbers as they are:

- Say "found on its page" or "not found on its page", never "invented" or "hallucinated": a missing quote may sit in a table, an equation or a scanned page that text extraction cannot read.
- Keep the order of `models`; it is sorted by `likelyLow`. Give the number of quotes behind every rate, and do not call one model more reliable than another when their ranges overlap.
- When `samePaper` is not empty, lead with it: the same PDF read by different models is the fairest comparison the library has.
- Name every `notCounted` project with its `detail`. For `not-checked` or `changed-since-check`, offer to run `verify --project <file> --paper <paper.pdf>` on the `file` it lists when the user has the PDF; that project is counted from then on.

## Resume behavior

If a partial `.trace.json` exists, validate it first. Preserve valid evidence and repair only missing or invalid stages. Never discard verified excerpts merely to rewrite the prose.
