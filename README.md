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

After installation, give the agent a PDF path with one sentence:

```text
Take this paper and give me the output using the Trace plugin: ./paper.pdf
```

The agent then completes the entire workflow in the background:

```text
PDF → page-aware evidence → deep report → technical appendix
    → interactive visual story → validation → local website opens
                                    └──────→ portable .trace.json
```

When it finishes, your default browser opens the completed local Trace website.
The same job folder contains a `.trace.json` file that can be archived, shared,
or imported from **Library → Trace JSON** in the full application.

## What Trace does

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

1. Add this GitHub repository as a plugin marketplace:

   ```bash
   codex plugin marketplace add Ahmet-Ruchan/trace-research-paper-studio
   ```

2. Install Trace:

   ```bash
   codex plugin add trace-paper-studio@personal
   ```

3. Start a new Codex session and ask:

   ```text
   Take ./papers/attention-is-all-you-need.pdf and give me the output using the Trace plugin.
   ```

Codex uses the active Codex model to read, reason, write the complete project, and
open the result. You can also invoke the skill explicitly with
`$trace-paper-studio`.

### Claude Code installation

1. In Claude Code, add the marketplace:

   ```text
   /plugin marketplace add Ahmet-Ruchan/trace-research-paper-studio
   ```

2. Install the plugin:

   ```text
   /plugin install trace-paper-studio@trace-research-tools
   ```

3. Start a new session and ask:

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

1. Install the GitHub extension:

   ```bash
   gemini extensions install https://github.com/Ahmet-Ruchan/trace-research-paper-studio
   ```

2. Restart Gemini CLI.

3. Ask normally, or use the bundled command:

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
npm run trace:agent -- prepare --paper "paper.pdf" --depth deep
npm run trace:agent -- validate --project ".trace/jobs/paper/paper.trace.json"
npm run trace:agent -- deliver --project ".trace/jobs/paper/paper.trace.json"
```

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

# Run every verification step
npm run check
```

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
│   ├── visual-renderer.tsx        # Trusted visual grammars
│   └── evidence-drawer.tsx        # Claim-to-source inspection
└── lib/
    ├── schema.ts                  # Evidence, DeepReport, and StorySpec contracts
    ├── project-library.ts         # IndexedDB persistence
    ├── prompts.ts                 # Evidence and narrative instructions
    ├── model-providers.ts         # Provider and model catalog
    ├── openai-structured.ts       # Strict OpenAI schema compatibility
    ├── generation-validation.ts   # Cross-contract integrity checks
    ├── safe-fetch.ts              # Protected supplementary source fetcher
    ├── export-story.ts            # Standalone HTML exporter
    └── sample-project.ts          # API-free Transformer example

plugins/trace-paper-studio/        # Shared Codex + Claude Code plugin
├── .codex-plugin/plugin.json
├── .claude-plugin/plugin.json
└── skills/trace-paper-studio/     # Canonical Agent Skill, contract, bridge

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
The interface, evidence contracts, DeepReport, eleven visual renderers, local
Library, exports, and Gemini/OpenAI/Claude/OpenRouter generation pipelines are
functional. Hosted publishing, accounts, shared database persistence, and local
model providers are the next major phases.
