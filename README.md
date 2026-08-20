# Trace — Research Paper Studio

> Read the paper. Trace the evidence. See the idea.

Trace is an AI-powered, evidence-first studio that turns research papers into
source-linked workspaces and interactive, exportable web stories.

Upload a PDF, optionally add supporting sources, and choose how deeply the paper
should be explained. Trace extracts its research question, methods, findings,
metrics, limitations, and terminology; connects every important claim back to its
source; and builds a visual scrollytelling experience from the verified evidence.

## Why “Trace”?

Research summaries are easy to generate but difficult to trust. Trace is designed
around a stricter principle: every claim should be traceable to the paper page or
supporting source that justifies it.

This makes the generated experience useful for more than presentation. It becomes
a workspace for reading, checking, editing, teaching, and publishing research.

## The shortest path: install, ask, read

Trace also works as a native plugin for **Codex, Claude Code, and Gemini CLI**.
The plugin uses the model already active in your agent—there is no second LLM API
key and no model configuration inside Trace.

After installation, one sentence is enough — **you do not need the PDF**:

```text
Explain Attention Is All You Need using the Trace plugin.
```

Trace finds the paper on arXiv, downloads it, and gathers what is publicly known
about it (version history, DOI, the venue it was published in, citation counts).
If you already have the file, hand it over instead:

```text
Take this paper and give me the output using the Trace plugin: ./paper.pdf
```

The agent then completes the entire workflow in the background:

```text
name or PDF → arXiv resolution + published context
            → page-aware evidence → deep report → technical appendix
            → interactive visual story
            → primer · derivations · playgrounds · quiz · application guide
            → validation → local website opens
                             └──────→ portable .trace.json
```

When it finishes, your default browser opens the completed local Trace website.
The same job folder contains a `.trace.json` file that can be archived, shared,
or imported from **Library → Trace JSON** in the full application.

### Global install from GitHub

No clone and no local filesystem path are required. Run the command for your
agent from any directory:

**Codex**

```bash
codex plugin marketplace add Ahmet-Ruchan/trace-research-paper-studio --ref main && codex plugin add trace-paper-studio@trace-research-tools
```

**Claude Code**

```bash
claude plugin marketplace add Ahmet-Ruchan/trace-research-paper-studio --scope user && claude plugin install trace-paper-studio@trace-research-tools --scope user
```

**Gemini CLI**

```bash
gemini extensions install https://github.com/Ahmet-Ruchan/trace-research-paper-studio
```

Restart the agent or open a new session after installation. The plugin is then
available globally across projects for that user.

## What Trace does

- Finds a paper on arXiv from its name alone, downloads it, and reports the
  runner-up candidates so a near-miss title can be caught before any work
- Gathers published context — version history, DOI, venue, citation counts —
  and cites it as a web source, never as something the paper itself claims
- Accepts research papers as PDF files up to 35 MB
- Adds up to three optional public web sources
- Extracts a structured evidence map with page-level references
- Splits evidence extraction into four bounded, independently validated passes
- Separates reported results, methods, background, interpretation, and limitations
- Builds an editable visual narrative from verified claims
- Streams partial structured output, live model activity, and 10-second heartbeats
- Automatically retries transient provider and structured-output failures
- Checkpoints completed evidence passes and resumes them after a failed request
- Runs the same evidence contracts through Gemini, OpenAI, Claude, or OpenRouter
- Supports single-model generation or a four-role model team with independent keys
- Assigns Evidence, Technical, Report, and Visual work to different provider/models
- Rejects stories with broken claim, page, metric, or evidence links
- Provides dedicated **Lab**, **Story**, and **Preview** workspaces
- Produces a claim-linked DeepReport with contribution, mechanism, experiments,
  critique, reproduction guidance, implications, and open questions
- Produces a Technical Appendix with equations, evidence-linked algorithm steps,
  safe pseudocode sketches, complexity notes, and implementation constraints
- Renders eleven reusable visual grammars, including architecture maps, equations,
  timelines, qualitative matrices, and infographics
- Teaches the background the paper assumes with a prerequisite-ordered primer
- Walks derivations step by step, each step carrying its reasoning and shapes,
  opened directly under the equation it derives
- Renders LaTeX as native MathML — no font payload, identical in both hosts
- Runs the paper's own equations live: sliders start at the paper's value, mark
  it on the track and the chart, and warn when you leave the verified region
- Steps through mechanisms frame by frame and makes result tables sortable
- Checks understanding with an evidence-linked quiz that shows the page behind
  every answer, and closes with an application guide including when *not* to
  use the method, grounded in the paper's own limitations
- Evaluates interactive formulas on a restricted grammar and a pure AST — never
  `eval`, because a `.trace.json` is untrusted input
- Exports the project as JSON or a self-contained HTML story
- Saves complete projects into a searchable, card-based local Library (IndexedDB)
- Imports validated `.trace.json` projects produced by Codex, Claude Code, or Gemini CLI
- Ships a native-agent plugin that uses the active CLI model without another LLM API key
- Supports responsive layouts and reduced-motion preferences
- Includes an API-free example based on *Attention Is All You Need*

## Evidence-first architecture

Trace does not ask a language model to generate and execute an arbitrary React
application. Instead, it uses a constrained pipeline:

```text
PDF + optional sources
          ↓
 Segmented evidence extraction
 overview · methods · results · limits
          ↓
 Validated PaperEvidence
          ↓
 Role-aware orchestration
 Evidence · Technical · Report · Visual
          ↓
 StorySpec + DeepReport + TechnicalAppendix
          ↓
 Trusted React renderers
          ↓
 Lab · Story · Preview · HTML export
```

The pipeline has four canonical data contracts:

1. `PaperEvidence` contains the paper metadata, claims, excerpts, page references,
   metrics, methods, findings, limitations, and glossary.
2. `StorySpec` contains the narrative structure and visual instructions, but only
   references claims that already exist in `PaperEvidence`.
3. `DeepReport` contains rigorous analytical sections and unresolved questions;
   every section also points back to existing evidence claims.
4. `TechnicalAppendix` contains non-executed explanatory code, equations,
   complexity analysis, and implementation guidance anchored to evidence claims.

This keeps research claims inspectable, visual output consistent, and exported
stories independent from the AI provider after generation.

## Model providers

Trace keeps provider-specific document and streaming behavior behind one generation
contract. Every provider therefore produces the same validated evidence graph,
DeepReport, and StorySpec; the workspace does not depend on the selected provider.

In **Model team** mode the fixed pipeline roles can be assigned independently:

| Role | Responsibility | Suggested strength |
| --- | --- | --- |
| Evidence | PDF reading, claims, sources, limitations | Long context and document understanding |
| Technical | Methods, mathematics, experiments, pseudocode | Reasoning and coding |
| Report | Deep explanation, critique, synthesis | Writing and analytical synthesis |
| Visual | StorySpec, canvas, architecture and infographic planning | Design judgment and structured output |

Tasks assigned to the same provider/model are run sequentially to reduce upstream
rate pressure. Different models may work in parallel. PDFs are sent only to models
that have an active document-reading task.

| Provider | Status |
| --- | --- |
| Google Gemini | Available |
| OpenAI Responses API | Available |
| Anthropic Claude Messages API | Available |
| OpenRouter (dynamic model catalog) | Available |
| Local/open-weight models | Planned |

Provider-specific credentials will remain request-scoped and will not be embedded
in projects or exported stories.

## Getting started

### Requirements

- Node.js 20 or newer
- npm
- A supported provider API key for real paper generation

### Installation

```bash
git clone <your-repository-url>
cd trace-paper-studio
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Use [http://localhost:3000?new=1](http://localhost:3000?new=1) to discard an
unfinished generation checkpoint and start with a new paper. Existing Library
items are preserved. The built-in example can be opened without an API key.

### Generate a research workspace

1. Select a research paper PDF.
2. Add supporting URLs if the paper needs external context.
3. Choose the audience, depth, language, provider, and model.
4. Enter the provider API key in the session-only field.
5. Select **Paper’ı incele** and follow the live evidence pipeline.
6. Inspect claims and the DeepReport in Lab, edit the narrative in Story, and
   review the result in Preview.
7. Return to Library to reopen any saved project, or export it as JSON/HTML.

For OpenRouter, enter a `provider/model` identifier directly or load the filtered
model catalog after entering the API key. The catalog requires text output and
strict structured-output support. PDF parsing uses OpenRouter's file parser, so a
text model does not need native file input. Image-output generation models are not
valid StorySpec workers even when they can also return text: Trace visuals are
strict JSON rendered by trusted React/canvas components. The catalog therefore
shows text-output-only models with structured output support. If an image-output
model is entered manually, Trace routes the structured task to a compatible
OpenRouter text model. Retryable upstream endpoint failures receive one compatible
model fallback.

## Native plugin: Codex, Claude Code, Gemini CLI

### Requirements

- Node.js 20 or newer
- Codex, Claude Code, or Gemini CLI already signed in and working
- A local research-paper PDF
- Optional but recommended: `pdftotext` from Poppler for page-preserving extraction

The plugin itself has no npm install step and does not need a provider API key.
The local result is served only on `127.0.0.1`; paper content is not published.

### Codex installation

For a global user installation, copy and run this single terminal command:

```bash
codex plugin marketplace add Ahmet-Ruchan/trace-research-paper-studio --ref main && codex plugin add trace-paper-studio@trace-research-tools
```

The equivalent two-step form is:

```bash
codex plugin marketplace add Ahmet-Ruchan/trace-research-paper-studio --ref main
codex plugin add trace-paper-studio@trace-research-tools
```

Start a new Codex session and ask:

   ```text
   Take ./papers/attention-is-all-you-need.pdf and give me the output using the Trace plugin.
   ```

Codex uses the active Codex model to read, reason, write the complete project, and
open the result. You can also invoke the skill explicitly with
`$trace-paper-studio`.

### Claude Code installation

For a global user installation, copy and run this single terminal command:

```bash
claude plugin marketplace add Ahmet-Ruchan/trace-research-paper-studio --scope user && claude plugin install trace-paper-studio@trace-research-tools --scope user
```

The same setup can be run interactively inside Claude Code:

```text
/plugin marketplace add Ahmet-Ruchan/trace-research-paper-studio
/plugin install trace-paper-studio@trace-research-tools
```

Run `/reload-plugins` or start a new session, then ask:

   ```text
   Take ./papers/attention-is-all-you-need.pdf and give me the output using the Trace plugin.
   ```

Claude Code uses its currently selected Claude model. Explicit invocation is also
available as `/trace-paper-studio:trace-paper-studio <paper.pdf>`.

For plugin development from a local checkout, use:

```bash
claude --plugin-dir ./plugins/trace-paper-studio
```

### Gemini CLI installation

Install globally from GitHub with one command:

```bash
gemini extensions install https://github.com/Ahmet-Ruchan/trace-research-paper-studio
```

Restart Gemini CLI.

Ask normally, or use the bundled command:

   ```text
   Take ./papers/attention-is-all-you-need.pdf and give me the output using the Trace plugin.
   ```

   ```text
   /trace:analyze ./papers/attention-is-all-you-need.pdf
   ```

Gemini CLI uses its active `--model`; Trace does not select or bill a second model.

### What you receive

Each run creates an isolated `.trace/jobs/<paper>/` directory containing:

| Output | Purpose |
| --- | --- |
| `<paper>.trace.json` | Validated, portable project for Library import or archival |
| `trace-site/index.html` | Self-contained visual Trace experience |
| `trace-site/<project-id>.trace.json` | Download/import copy exposed by the local site |
| `job.json` and `paper.pages.txt` | Reproducible job settings and page-aware source text |

The browser opens only after the evidence graph, report, technical appendix, and
visual story pass validation. Use the **Trace JSON ↓** button in the local site to
download the importable project at any time.

### Manual bridge commands

Agents run these commands automatically; they are documented for debugging:

```bash
# Resolve the paper from its name on arXiv, download it, collect context
npm run trace:agent -- prepare --title "attention is all you need" --depth deep

# Or by arXiv id, or from a local file
npm run trace:agent -- prepare --arxiv 1706.03762 --depth deep
npm run trace:agent -- prepare --paper "paper.pdf" --depth deep

# --strict also requires the learning blocks the chosen depth mandates
npm run trace:agent -- validate --strict --project ".trace/jobs/paper/paper.trace.json"
npm run trace:agent -- deliver --project ".trace/jobs/paper/paper.trace.json"
```

With `--title`, the command reports which paper it matched plus the runner-up
candidates and a `confident` flag — near-miss titles are common ("Not All
Attention Is All You Need" is a different paper). Re-run with `--pick <n>` or
`--arxiv <id>` to switch.

Network access is deliberately narrow: HTTPS only, a host allowlist, redirects
verified against that allowlist, a streaming size cap, and a `%PDF-` signature
check. Downloaded files are never executed. Context sources that cannot be
reached are omitted rather than guessed.

`deliver` preserves JSON, builds the site, starts a loopback-only Node server, and
opens the default browser. Pass `--no-open` only for headless environments; the
command will still return the local URL and JSON path.

## Development

```bash
# Development server
npm run dev

# Lint
npm run lint

# Unit tests
npm run test

# Production build
npm run build

# Rebuild the committed artifacts (standalone viewer + plugin validator)
npm run build:artifacts

# Run every verification step
npm run check
```

### Generated artifacts

Two files are build output but are committed, because the plugin has to stay
dependency-free at run time:

| Artifact | Source | Rebuild |
| --- | --- | --- |
| `plugins/.../assets/viewer.html` | `viewer/` + `src/visuals/` | `npm run build:viewer` |
| `plugins/.../scripts/generated/validator.mjs` | `src/lib/schema.ts` + integrity rules | `npm run build:validator` |

Never edit them by hand. `npm run check` runs `scripts/check-artifacts.mjs`,
which rebuilds both and fails if the committed copies drifted.

The visual and interactive components live in `src/visuals/` and are compiled
twice — as real React for the app, and through preact for the standalone
viewer — so a grammar is written once rather than three times. The plugin
validator is the application's actual schema, bundled, rather than a copy of
it; a rule cannot pass one and fail the other.

## Security and trust model

- API keys are sent only to the backend generation route for the active request.
- API keys are not written to local storage or included in exports.
- Uploaded PDFs are removed from the provider file service after generation.
- Aborted requests also perform best-effort remote file cleanup.
- Supplementary URLs are restricted by protocol, DNS/IP range, redirect count,
  response type, timeout, and payload size to reduce SSRF risk.
- PDF and web contents are treated as untrusted source material, not instructions.
- Generated output must satisfy Zod schemas and additional semantic integrity checks.
- Model calls have explicit per-attempt deadlines and bounded retry policies.
- At most two evidence passes run concurrently to avoid uncontrolled rate pressure.
- Completed passes are checkpointed locally without storing the API key.
- Provider keys and role assignments are validated before paid generation begins.
- OpenRouter mid-stream typed errors are preserved in user-facing diagnostics.
- Verified paper claims require an excerpt and a visible PDF page number.
- Comparison visuals may only use numeric values already recorded in evidence.
- The renderer uses trusted components instead of executing model-generated code.
- Interactive formulas are declarative. They are parsed by a restricted grammar
  and evaluated on a pure AST with length, node-count and depth limits — never
  `eval` or `new Function`, because an imported `.trace.json` is untrusted input.
- Validation proves an interactive will actually run before it ships: the formula
  must parse, reference only declared parameters, and produce a finite value at
  the paper's own configuration.
- Paper resolution reaches only an allowlisted set of hosts over HTTPS, verifies
  every redirect against that allowlist, caps the download while streaming, and
  checks the `%PDF-` signature. Downloaded files are never executed.
- A context source that returns an unreliable record is dropped rather than
  trusted. OpenAlex is queried only with a real publisher DOI, because its
  arXiv-DOI form resolves to a different paper.
- LaTeX is rendered to MathML and passed through a tag/attribute allowlist.

No automated extraction system is a substitute for checking the original paper.
Trace makes that verification faster and more visible; it does not remove the need
for it.

## Project structure

```text
src/
├── app/
│   ├── api/generate/route.ts      # Streaming generation pipeline
│   ├── api/models/openrouter/     # Request-scoped OpenRouter catalog proxy
│   ├── globals.css                # Product design system
│   └── page.tsx                   # Application entry
├── components/
│   ├── app-shell.tsx              # Workspace state and generation stream
│   ├── onboarding.tsx             # PDF, source, model, and key inputs
│   ├── library-view.tsx            # Searchable local project collection
│   ├── lab-view.tsx               # Evidence inspection workspace
│   ├── story-editor.tsx           # Narrative editor
│   ├── story-view.tsx             # Scrollytelling experience
│   ├── visual-renderer.tsx        # Re-export shim -> src/visuals
│   └── evidence-drawer.tsx        # Claim-to-source inspection
├── visuals/                       # SHARED render layer — compiled for both hosts
│   ├── visual-renderer.tsx        # The eleven visual grammars
│   ├── interactive/               # Playground, simulation, data explorer
│   ├── teaching/                  # Primer, derivations, quiz, application guide
│   ├── math.tsx                   # LaTeX -> MathML with an output allowlist
│   ├── chart.ts                   # Dependency-free SVG scales and paths
│   └── *.css                      # Tokens, grammars, learning layer
└── lib/
    ├── schema.ts                  # Evidence, DeepReport, StorySpec, learning layer
    ├── formula.ts                 # Restricted-grammar parser + pure AST evaluator
    ├── project-library.ts         # IndexedDB persistence
    ├── prompts.ts                 # Evidence and narrative instructions
    ├── model-providers.ts         # Provider and model catalog
    ├── openai-structured.ts       # Strict OpenAI schema compatibility
    ├── generation-validation.ts   # Cross-contract integrity checks
    ├── plugin-validator-entry.ts  # Bundled into the plugin — no mirrored rules
    ├── safe-fetch.ts              # Protected supplementary source fetcher
    ├── export-story.ts            # Standalone HTML exporter
    └── sample-project.ts          # API-free Transformer example

viewer/                            # Standalone viewer app (preact build target)
scripts/                           # build-viewer, build-plugin-validator, drift check
examples/                          # Flagship enriched project, covered by tests

plugins/trace-paper-studio/        # Shared Codex + Claude Code plugin
├── .codex-plugin/plugin.json
├── .claude-plugin/plugin.json
└── skills/trace-paper-studio/     # Canonical Agent Skill, contract, bridge
    ├── scripts/lib/paper-source.mjs   # arXiv resolution + published context
    ├── scripts/generated/             # Bundled validator (generated)
    └── assets/viewer.html             # Standalone site template (generated)

gemini-extension.json              # GitHub-installable Gemini CLI extension
.agents/skills/                    # Direct Codex repository discovery
.claude/skills/                    # Direct Claude Code repository discovery
skills/                            # Gemini extension skill discovery
```

Local research libraries can be kept under `ML Research Papers/`; this directory is
ignored by Git so source PDFs are not accidentally committed.

## Roadmap

- Local/open-weight provider adapters
- Section-level regeneration with evidence locking
- Side-by-side paper comparison
- Project revisions and reusable narrative templates
- Database-backed workspaces and user accounts
- Shareable hosted stories with publication controls
- Team review, annotations, and claim approval workflows

## Current status

Trace is an early MVP focused on validating the core experience and trust model.
Working today: the evidence contracts, DeepReport, technical appendix, eleven
visual renderers, the learning layer (primer, derivations, interactive
playgrounds, quiz, application guide), arXiv resolution from a paper's name,
the local Library, exports, the native plugin for Codex/Claude Code/Gemini CLI,
and the Gemini/OpenAI/Claude/OpenRouter generation pipelines.

Not there yet: hosted publishing, accounts, shared database persistence, and
local/open-weight model providers.

*Attention Is All You Need* ships as a fully enriched reference project in
`examples/`, covered by tests so it cannot silently fall behind the schema.
