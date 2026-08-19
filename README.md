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

## What Trace does

- Accepts research papers as PDF files up to 35 MB
- Adds up to three optional public web sources
- Extracts a structured evidence map with page-level references
- Separates reported results, methods, background, interpretation, and limitations
- Builds an editable visual narrative from verified claims
- Streams live generation progress to the interface
- Automatically retries transient provider and structured-output failures
- Rejects stories with broken claim, page, metric, or evidence links
- Provides dedicated **Lab**, **Story**, and **Preview** workspaces
- Renders six reusable interactive visual grammars
- Exports the project as JSON or a self-contained HTML story
- Saves the active project locally in the browser
- Supports responsive layouts and reduced-motion preferences
- Includes an API-free example based on *Attention Is All You Need*

## Evidence-first architecture

Trace does not ask a language model to generate and execute an arbitrary React
application. Instead, it uses a constrained pipeline:

```text
PDF + optional sources
          ↓
    Evidence extraction
          ↓
 Validated PaperEvidence
          ↓
 Narrative + visual planning
          ↓
   Validated StorySpec
          ↓
 Trusted React renderers
          ↓
 Lab · Story · Preview · HTML export
```

The pipeline has two canonical data contracts:

1. `PaperEvidence` contains the paper metadata, claims, excerpts, page references,
   metrics, methods, findings, limitations, and glossary.
2. `StorySpec` contains the narrative structure and visual instructions, but only
   references claims that already exist in `PaperEvidence`.

This keeps research claims inspectable, visual output consistent, and exported
stories independent from the AI provider after generation.

## Model providers

Trace is designed to become model-provider agnostic. The current MVP includes the
Gemini pipeline; additional adapters will share the same evidence and story
contracts.

| Provider | Status |
| --- | --- |
| Google Gemini | Available in the MVP |
| OpenAI | Planned |
| Anthropic Claude | Planned |
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

Use [http://localhost:3000?new=1](http://localhost:3000?new=1) to clear the saved
local workspace and start with a new paper. The built-in example can be opened
without an API key.

### Generate a research workspace

1. Select a research paper PDF.
2. Add supporting URLs if the paper needs external context.
3. Choose the audience, depth, language, and model.
4. Enter the provider API key in the session-only field.
5. Select **Paper’ı incele** and follow the live evidence pipeline.
6. Inspect claims in Lab, edit the narrative in Story, and review the result in
   Preview.
7. Export the project as JSON or standalone HTML.

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
│   ├── globals.css                # Product design system
│   └── page.tsx                   # Application entry
├── components/
│   ├── app-shell.tsx              # Workspace state and generation stream
│   ├── onboarding.tsx             # PDF, source, model, and key inputs
│   ├── lab-view.tsx               # Evidence inspection workspace
│   ├── story-editor.tsx           # Narrative editor
│   ├── story-view.tsx             # Scrollytelling experience
│   ├── visual-renderer.tsx        # Trusted visual grammars
│   └── evidence-drawer.tsx        # Claim-to-source inspection
└── lib/
    ├── schema.ts                  # PaperEvidence and StorySpec contracts
    ├── prompts.ts                 # Evidence and narrative instructions
    ├── generation-validation.ts   # Cross-contract integrity checks
    ├── safe-fetch.ts              # Protected supplementary source fetcher
    ├── export-story.ts            # Standalone HTML exporter
    └── sample-project.ts          # API-free Transformer example
```

Local research libraries can be kept under `ML Research Papers/`; this directory is
ignored by Git so source PDFs are not accidentally committed.

## Roadmap

- Provider adapter layer for Gemini, OpenAI, Anthropic, and local models
- Section-level regeneration with evidence locking
- Richer visual grammars for equations, architectures, tables, and experiments
- Side-by-side paper comparison
- Project history, revisions, and reusable narrative templates
- Database-backed workspaces and user accounts
- Shareable hosted stories with publication controls
- Team review, annotations, and claim approval workflows

## Current status

Trace is an early MVP focused on validating the core experience and trust model.
The interface, evidence contracts, story renderer, local persistence, exports, and
Gemini generation pipeline are functional. Hosted publishing, accounts, database
persistence, and additional model providers are the next major phases.
