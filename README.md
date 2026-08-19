# Trace — evidence-first research studio

Trace turns a scientific paper into a source-linked research workspace and an interactive, exportable web story.

The MVP deliberately does not ask an LLM to write and execute an arbitrary React application. It uses a two-stage pipeline:

1. The paper and optional web sources become a validated `PaperEvidence` object.
2. Verified claims become a constrained `StorySpec` rendered by trusted components.

This keeps claims inspectable, sections editable, outputs consistent, and exported stories independent from the model API.

## Current MVP

- PDF upload up to 35 MB
- Up to three optional public web sources with SSRF protection
- Session-only Gemini API key sent through a backend route
- Evidence extraction with page-level source references
- Live, stage-by-stage generation progress over an NDJSON stream
- Automatic retries for transient API failures and invalid structured output
- Cross-checks for claim, page, metric, method, limitation, and story links
- Separate Lab, Story editor, and Preview modes
- Six reusable visual grammars
- Local project persistence
- Project JSON and self-contained HTML export
- Responsive and reduced-motion layouts
- Bundled example project available without an API key

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To start with a clean local workspace even when a sample is saved, open
[http://localhost:3000?new=1](http://localhost:3000?new=1).

The local `ML Research Papers` directory is intentionally ignored by Git. Use the
bundled `Attention Is All You Need.pdf` through the file picker for the first real
pipeline test; its API key remains in memory only for that request.

Run all checks:

```bash
npm run check
```

## Security model

- API keys are not saved to local storage or included in exported stories.
- Uploaded PDFs are removed from Gemini Files after generation completes.
- Aborted requests also run best-effort remote file cleanup.
- Supplementary URLs are limited by protocol, DNS/IP range, redirects, response type, timeout, and size.
- Paper and web contents are treated as untrusted source material in model instructions.
- Rendered stories use a constrained schema rather than model-generated executable code.

## Important files

- `src/lib/schema.ts` — canonical evidence and story data contracts
- `src/lib/prompts.ts` — extraction and narrative prompts
- `src/app/api/generate/route.ts` — Gemini generation pipeline
- `src/components/lab-view.tsx` — research workspace
- `src/components/story-view.tsx` — scrollytelling renderer
- `src/lib/export-story.ts` — standalone HTML exporter
