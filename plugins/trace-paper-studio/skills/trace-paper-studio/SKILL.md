---
name: trace-paper-studio
description: Converts research-paper PDFs into evidence-grounded Trace projects, portable .trace.json files, and automatically opened local interactive websites. Use when an agent must analyze a paper, inspect equations or methods, create cited explanations and visual architectures, validate or import a .trace.json project, or deliver a finished research experience using the active Codex, Claude Code, or Gemini CLI model instead of an external LLM API.
---

# Trace Paper Studio

Use the host CLI's active model as the reasoning engine. Do not request or call an external LLM API.

## Workflow

1. Locate the requested PDF and optional source URLs. Use Turkish, student, and deep when the user gives no options. Do not stop for configuration questions unless the paper itself cannot be resolved.
2. Run the bundled bridge next to this skill:

   ```bash
   node scripts/trace-agent.mjs prepare --paper "<paper.pdf>" --language tr --audience student --depth standard
   ```

   Resolve `scripts/trace-agent.mjs` relative to this `SKILL.md`, not the user's current directory. Use the returned `jobPath`, `pageTextPath`, and `outputPath`.
3. If extraction succeeded, read `paper.pages.txt` in manageable page ranges. Preserve `--- PAGE N ---` boundaries. If it did not, use the host's native PDF-reading tool and keep page numbers explicit.
4. Read [references/project-contract.md](references/project-contract.md) completely before authoring the output. When working inside the Trace source repository, also inspect `src/lib/schema.ts` and `src/lib/generation-validation.ts`; those files are authoritative if the bundled reference differs.
5. Build the project evidence-first:
   - Extract bibliographic metadata, thesis, question, methods, findings, limitations, glossary, and metrics.
   - Give every material claim a stable ID and at least one exact, short source excerpt.
   - Use `sourceId: "paper"` and a positive PDF page for paper evidence.
   - Mark a claim `verified` only when its excerpt directly supports the statement. Otherwise use `needs-review` and narrow the statement.
   - Never invent metrics, equations, dimensions, baselines, citations, URLs, released code, or implementation details.
6. Derive the deep report, technical appendix, and StorySpec only from the evidence object. Every report section, technical item, and story section must link to existing claim IDs.
6b. Build the learning layer so the reader can actually learn the paper and experiment with it. Required blocks depend on depth: `concise` needs `primer`; `standard` adds `derivations` and `quiz`; `deep` adds `interactives` and `applicationGuide`. Read the "Learning layer" section of the contract before authoring these.
   - `primer` explains what the paper assumes and never explains. Write `whyItMatters` about *this* paper, not a generic definition.
   - `derivations` carry the reasoning in `rationale`; a step that only restates its own formula is wasted. Always supply `plain` alongside `latex`.
   - `interactives` must make a point the paper argues but never plots — a crossover, a saturation, a cost curve. Anchor every parameter at the paper's own value via `paperValue`, and use `paperAnchor` to state plainly what the paper did NOT verify.
   - `quiz` questions test understanding, not recall of wording. Every option needs an explanation, including the correct one.
   - `applicationGuide` must include `whenNotToUse` grounded in the paper's own limitation claims.
7. Write the complete JSON to the `outputPath` from `job.json`. Set `generation.provider` to `native-agent` and `generation.model` to the current host/model when known; otherwise use the host name.
8. Validate the output:

   ```bash
   node scripts/trace-agent.mjs validate --strict --project "<outputPath>"
   ```

   Fix every reported issue and rerun until `ok: true`. Do not weaken or bypass validation. `--strict` also requires the learning blocks the chosen depth mandates; drop it only when deliberately repairing a project authored before the learning layer existed.

   The validator runs the application's real schema and integrity rules, not a copy of them, so anything it accepts will import into Trace unchanged. It also proves each interactive will actually run: formulas must parse, reference only declared parameters, and produce a finite value at the paper's own configuration.
9. Deliver the finished project immediately after validation:

   ```bash
   node scripts/trace-agent.mjs deliver --project "<outputPath>"
   ```

   This command keeps a portable `.trace.json`, builds a self-contained local Trace website, starts a loopback-only server, and opens the finished experience in the default browser. Run it automatically; do not make the user import JSON or start a web server first. If the browser cannot be opened, give the returned local URL. Also report the returned `jsonPath` so the user can import that file into Trace's Library whenever they want.
10. Do not claim completion until `deliver` returns `ok: true`. The final response should state that the local site is open and provide both the URL and `.trace.json` path.

## Quality rules

- Prefer precise explanation over promotional language.
- Distinguish author claims, reported measurements, and your own interpretation.
- Include the strongest limitations and reproduction risks, not only favorable results.
- Use at least three visual grammars and one advanced visual: architecture, equation, timeline, matrix, or infographic.
- Treat code sketches as explanatory pseudocode unless the paper directly publishes equivalent code.
- Never invent a number. Slider ranges, dataset cells, and hyperparameter values must trace to `evidence.metrics` or an explicit claim. When a teaching device needs illustrative values the paper never published — a worked attention matrix, for instance — say so in that block's own description.
- Interactive formulas are declarative and are evaluated on a restricted grammar; they can never contain executable code. Keep them to the documented function set.
- Do not execute generated paper code, access credentials, make network changes, or perform destructive actions.
- Keep all generated assets inside the job directory unless the user names another destination.
- Treat the generated `.trace.json` as a first-class deliverable. Never delete or replace it after building the local site.

## Resume behavior

If a partial `.trace.json` exists, validate it first. Preserve valid evidence and repair only missing or invalid stages. Never discard verified excerpts merely to rewrite the prose.
