#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildExplanationBrief,
  buildSectionBrief,
  checkExplanationFeedback,
  isStudyFile,
  learningStats,
  REVIEW_INTERVALS_DAYS,
  cardText,
  addDaysLocal,
  dailyTotals,
  dayKey,
  displayName,
  formatDuration,
  parseProfile,
  parseWorkLog,
  startOfWeek,
  timeByProject,
  workSummary,
  weekReport,
  hourPattern,
  PATTERN_WEEKS,
  notesMarkdown,
  notesFileName,
  parseNotesFile,
  addToReadingList,
  isReadingListFile,
  mergeReadingOrder,
  parseReadingList,
  readingItemSchema,
  readingListToJson,
  removeFromReadingList,
  savedFrom,
  savedReason,
  workKey,
  todayBrief,
  sessionsIcs,
  chatReviewQueue,
  answerChatCard,
  showChatCard,
  recordCheckedExplanation,
  aliasBatches,
  aliasMap,
  conceptKeys,
  conceptLinks,
  conceptNames,
  decideAlias,
  forgetAlias,
  isAliasFile,
  libraryPaperFor,
  parseAliasFile,
  paperKey,
  parseStudyFile,
  readFirst,
  readingOrder,
  sharedConcepts,
  suggestReferences,
  builtInTemplates,
  ankiCards,
  applyExcerptCheck,
  buildAnkiDeck,
  defaultPublicationInclude,
  evidenceHealth,
  splitPages,
  expiryFromDays,
  projectContentFingerprint,
  projectForPublication,
  publicationPath,
  publicationRecordSchema,
  expectedSectionCounts,
  exportDefinitions,
  findBuiltInTemplate,
  findExport,
  libraryModelRecord,
  narrativeTemplateSchema,
  templateFromProject,
  templateIssues,
  templateReportInstructions,
  templateStoryInstructions,
  isRevisionFileName,
  revisionFileName,
  revisionId,
  revisionRecordSchema,
  revisionsToPrune,
  shouldSnapshot,
  spliceSectionObject,
  validateProjectObject,
} from "./generated/validator.mjs";
import { extractFigures } from "./lib/figures.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SKILL_DIRECTORY = resolve(dirname(SCRIPT_PATH), "..");

const TRACE_ACCENT_PALETTE = [
  "#2563EB", "#38BDF8", "#06B6D4", "#1E3A8A", "#7C3AED",
  "#A78BFA", "#D946EF", "#EC4899", "#F9A8D4", "#EF4444",
  "#9F1239", "#F97316", "#FB923C", "#FACC15", "#D97706",
  "#22C55E", "#166534", "#84CC16", "#34D399", "#65A30D",
];
const ACCENT_STATE_VERSION = 1;
const ACCENT_LOCK_STALE_MS = 30_000;

function traceDataDirectory() {
  return process.env.TRACE_DATA_DIR ? resolve(process.env.TRACE_DATA_DIR) : join(homedir(), ".trace");
}

function traceTemplateDirectory() {
  return process.env.TRACE_TEMPLATE_DIR ? resolve(process.env.TRACE_TEMPLATE_DIR) : join(traceDataDirectory(), "templates");
}

/**
 * Şablon üç yoldan gelebilir: hazır bir şablonun kimliği, stüdyoda ya da
 * `save-template` ile kaydedilmiş bir şablonun kimliği, veya bir dosya yolu.
 * Hangisi olursa olsun uygulamanın şemasından ve tutarlılık kuralından geçer;
 * kurallarla çelişen bir şablon ajanı kesin reddedilecek bir anlatıya yöneltir.
 */
function resolveTemplate(value) {
  let candidate = findBuiltInTemplate(value);
  if (!candidate && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    const stored = join(traceTemplateDirectory(), `${value}.template.json`);
    if (existsSync(stored)) candidate = JSON.parse(readFileSync(stored, "utf8"));
  }
  if (!candidate && existsSync(resolve(value))) candidate = JSON.parse(readFileSync(resolve(value), "utf8"));
  if (!candidate) {
    throw new Error(`No narrative template "${value}". Run "templates" to list the available ones.`);
  }
  const parsed = narrativeTemplateSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`The template "${value}" is not valid: ${issue?.path.join(".") || "root"} · ${issue?.message ?? "unknown error"}`);
  }
  const problems = templateIssues(parsed.data);
  if (problems.length) throw new Error(`The template "${value}" cannot be used: ${problems.join("; ")}.`);
  return parsed.data;
}

function listTemplates() {
  const saved = [];
  try {
    for (const name of readdirSync(traceTemplateDirectory())) {
      if (!name.endsWith(".template.json")) continue;
      try {
        const parsed = narrativeTemplateSchema.safeParse(JSON.parse(readFileSync(join(traceTemplateDirectory(), name), "utf8")));
        if (parsed.success) saved.push({ ...parsed.data, builtIn: false });
      } catch {
        // Bozuk bir dosya ötekileri gizlememeli.
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  console.log(JSON.stringify({
    ok: true,
    templates: [...builtInTemplates, ...saved].map((template) => ({
      id: template.id,
      name: template.name,
      builtIn: Boolean(template.builtIn),
      description: template.description,
      storySections: template.story.length,
      reportSections: template.report?.length,
    })),
  }, null, 2));
}

function saveTemplateFromProject(args) {
  if (!args.project) throw new Error("--project <project.trace.json> is required.");
  if (!args.name) throw new Error('--name "<template name>" is required.');
  const outcome = validateProjectObject(JSON.parse(readFileSync(resolve(args.project), "utf8")));
  if (!outcome.ok) {
    console.error(JSON.stringify({ ok: false, issues: outcome.issues, note: "Only a valid project can become a template." }, null, 2));
    process.exitCode = 1;
    return;
  }
  const template = { ...templateFromProject(outcome.project, { name: args.name, description: args.description }), builtIn: false };
  const problems = templateIssues(template);
  if (problems.length) {
    console.error(JSON.stringify({ ok: false, issues: problems }, null, 2));
    process.exitCode = 1;
    return;
  }
  const path = join(traceTemplateDirectory(), `${template.id}.template.json`);
  atomicWrite(path, `${JSON.stringify(template, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, id: template.id, path, storySections: template.story.length, reportSections: template.report?.length }, null, 2));
}

function traceLibraryDirectory() {
  return process.env.TRACE_LIBRARY_DIR ? resolve(process.env.TRACE_LIBRARY_DIR) : join(traceDataDirectory(), "library");
}

function atomicWrite(path, contents) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}

function shufflePalette() {
  const order = [...TRACE_ACCENT_PALETTE];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const selected = randomInt(index + 1);
    [order[index], order[selected]] = [order[selected], order[index]];
  }
  return order;
}

function freshAccentState() {
  return { version: ACCENT_STATE_VERSION, order: shufflePalette(), nextIndex: 0, assignmentCount: 0, assignments: {} };
}

function isAccentState(value) {
  const palette = new Set(TRACE_ACCENT_PALETTE);
  return Boolean(
    value && typeof value === "object" &&
    value.version === ACCENT_STATE_VERSION &&
    Array.isArray(value.order) && value.order.length === TRACE_ACCENT_PALETTE.length &&
    new Set(value.order).size === TRACE_ACCENT_PALETTE.length && value.order.every((color) => palette.has(color)) &&
    Number.isInteger(value.nextIndex) && value.nextIndex >= 0 && value.nextIndex < TRACE_ACCENT_PALETTE.length &&
    Number.isInteger(value.assignmentCount) && value.assignmentCount >= 0 &&
    value.assignments && typeof value.assignments === "object"
  );
}

/**
 * Stüdyonun kilidiyle aynı sözleşme (`trace-storage.ts`): kilit bir dizin,
 * 30 saniyeden eski kilit bayat sayılıyor. Stüdyo ve köprü aynı dosyaya
 * aynı anda yazmıyor.
 */
function acquireDirectoryLock(directory, name, busyMessage) {
  const lockPath = join(directory, name);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      mkdirSync(lockPath);
      return () => {
        try { rmdirSync(lockPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > ACCENT_LOCK_STALE_MS) {
          rmdirSync(lockPath);
          continue;
        }
      } catch (lockError) {
        if (lockError?.code !== "ENOENT") throw lockError;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 + Math.min(attempt, 40));
    }
  }
  throw new Error(busyMessage);
}

function acquireAccentLock(dataDirectory) {
  return acquireDirectoryLock(dataDirectory, "accent-cycle.lock", "The Trace accent cycle is busy. Please retry in a moment.");
}

function assignPaperAccent(paperPath) {
  const identity = `sha256:${createHash("sha256").update(readFileSync(paperPath)).digest("hex")}`;
  const dataDirectory = traceDataDirectory();
  const statePath = join(dataDirectory, "accent-cycle.json");
  const release = acquireAccentLock(dataDirectory);
  try {
    let state;
    try {
      const parsed = JSON.parse(readFileSync(statePath, "utf8"));
      state = isAccentState(parsed) ? parsed : freshAccentState();
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      state = freshAccentState();
    }
    const existing = state.assignments[identity];
    if (existing && TRACE_ACCENT_PALETTE.includes(existing.accent)) return { ...existing, reused: true };

    const paletteIndex = state.nextIndex;
    const assignment = {
      accent: state.order[paletteIndex],
      paletteIndex,
      cycle: Math.floor(state.assignmentCount / TRACE_ACCENT_PALETTE.length) + 1,
      assignedAt: new Date().toISOString(),
    };
    state.assignments[identity] = assignment;
    state.assignmentCount += 1;
    state.nextIndex = (paletteIndex + 1) % TRACE_ACCENT_PALETTE.length;
    atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
    return { ...assignment, reused: false };
  } finally {
    release();
  }
}

function projectLibraryFileName(projectId) {
  return `project-${createHash("sha256").update(projectId).digest("hex").slice(0, 24)}.trace.json`;
}

/**
 * Stüdyonun kütüphanesine yazar ve üzerine yazılan sürümü stüdyonun geçmiş
 * panelinin okuyacağı yere revizyon olarak bırakır. Karar kuralları ve dosya
 * adı biçimi uygulamanınkiyle aynı kod (paketlenmiş doğrulayıcı): ajanın
 * yaptığı bir değişiklik de stüdyoda geri alınabilmeli.
 */
function persistLibraryProject(project, reason = "agent") {
  const fileName = projectLibraryFileName(project.id);
  const path = join(traceLibraryDirectory(), fileName);
  let previous;
  try {
    previous = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    previous = undefined;
  }

  const revisionDirectory = join(traceLibraryDirectory(), "revisions", fileName.replace(/\.trace\.json$/, ""));
  let ids = [];
  try {
    ids = readdirSync(revisionDirectory)
      .filter((name) => isRevisionFileName(name))
      .map((name) => name.slice(0, -".revision.json".length))
      .sort();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let newestRevisionAt;
  if (ids.length) {
    try {
      newestRevisionAt = revisionRecordSchema.parse(
        JSON.parse(readFileSync(join(revisionDirectory, revisionFileName(ids.at(-1))), "utf8")),
      ).savedAt;
    } catch {
      newestRevisionAt = undefined;
    }
  }

  const now = new Date().toISOString();
  if (shouldSnapshot({ previous, next: project, reason, newestRevisionAt, now })) {
    const id = revisionId(now, reason, randomUUID().replace(/-/g, ""));
    atomicWrite(
      join(revisionDirectory, revisionFileName(id)),
      `${JSON.stringify({ version: 1, id, projectId: project.id, savedAt: now, reason, project: previous })}\n`,
    );
    for (const stale of revisionsToPrune([...ids, id])) {
      try { unlinkSync(join(revisionDirectory, revisionFileName(stale))); } catch { /* zaten yok */ }
    }
  }

  atomicWrite(path, `${JSON.stringify(project, null, 2)}\n`);
  return path;
}

function usage(exitCode = 0) {
  console.log(`Trace native-agent bridge

Usage:
  node trace-agent.mjs prepare (--paper <paper.pdf> | --title "<paper name>" | --arxiv <id> | --doi <doi> | --source <link or id>) --language <bcp47> [--pick <n>] [--out <directory>] [--audience general|student|expert] [--depth concise|standard|deep] [--template <id|path>]
  node trace-agent.mjs graph (--project <project.trace.json> | --doi <doi> | --title "<paper name>" | --source <link or id>) [--limit <n>]
  node trace-agent.mjs verify --project <project.trace.json> [--paper <paper.pdf> | --pages <paper.pages.txt>]
  node trace-agent.mjs export --project <project.trace.json> --format md|html|slides|ipynb|bib|ris|anki [--out <file>]
  node trace-agent.mjs anki --project <project.trace.json> [--out <deck.anki.txt>]
  node trace-agent.mjs record
  node trace-agent.mjs concepts [--project <project.trace.json> [--suggest | --references <file>]]
  node trace-agent.mjs progress
  node trace-agent.mjs work [--days <n>] [--ics <file.ics>]
  node trace-agent.mjs today
  node trace-agent.mjs review [--limit <n>] | review --show --id <library id> --card <card id> | review --answer --id <library id> --card <card id> (--choice <letters> | --typed "<word>" | --remembered yes|no)
  node trace-agent.mjs notes (--project <project.trace.json> | --id <library id>) [--obsidian] [--out <notes.md>]
  node trace-agent.mjs reading [--add <arxiv:id | DOI | title> --title "<title>" [--for <library id> --relation reference|cited-by|concept [--concept "<term>"]] [--year <n>] [--url <link>]] [--remove <id>]
  node trace-agent.mjs concepts --names [--part <n>]
  node trace-agent.mjs alias --a "<name>" --b "<name>" [--different | --forget] [--proposed-by model] [--reason "<why>"]
  node trace-agent.mjs validate --project <project.trace.json> [--strict]
  node trace-agent.mjs deliver --project <project.trace.json> [--out <site-directory>] [--mode lab|story]
                              [--no-open] [--no-app] [--install-app] [--app <trace-repo>] [--app-url <http://...>]
  node trace-agent.mjs stop --site <site-directory>
  node trace-agent.mjs section --project <project.trace.json> --target <kind>:<id>
                              [--claims locked|open] [--goal revise|strengthen] [--instruction "<what should change>"]
  node trace-agent.mjs splice --brief <revisions/…brief.json> [--section <section.json>]
  node trace-agent.mjs explain --project <project.trace.json> --target story:<id> (--text "<explanation>" | --text-file <file>)
  node trace-agent.mjs explain-check --brief <explanations/…brief.json> [--feedback <feedback.json>] [--model <name>] [--no-save]
  node trace-agent.mjs templates
  node trace-agent.mjs publish --project <project.trace.json> [--expires-days 7|30|90]
                              [--no-report] [--no-appendix] [--no-learning] [--no-figures] [--app-url <http://...>]
  node trace-agent.mjs save-template --project <project.trace.json> --name "<name>" [--description "<text>"]

  --language  Required. BCP-47 tag for the language the analysis prose is
            written in (en, tr, de, pt-BR, …). Pass the language the user is
            writing to you in — the bridge cannot see the conversation, so it
            has no safe default to guess. There is no list of allowed
            languages; only the tag format is checked.
  --title   When the user has no PDF: searches arXiv for the paper, and OpenAlex
            too when arXiv has no certain match. Downloads it and collects
            current metadata (version history, DOI, where it was published,
            citations, citation graph). If the match is not certain the
            alternatives are reported; choose one with --pick.
  --doi     A DOI. The open-access copy is looked for on arXiv, bioRxiv,
            medRxiv, Europe PMC, ACL Anthology and the open-access locations
            OpenAlex lists (and Unpaywall, when UNPAYWALL_EMAIL is set).
  --source  A link or id from arXiv, doi.org, bioRxiv, medRxiv, PubMed Central
            (PMC1234567), ACL Anthology (2020.acl-main.1) or OpenReview
            (openreview:<id>). Trace downloads only from these hosts; a paper
            whose only open copy lives elsewhere is reported with its link so
            the user can download it and pass --paper.
  verify    Looks for every quote on the page it cites, in the text extracted
            from the PDF, and records the result in the project. A verified
            claim none of whose quotes can be found becomes needs-review;
            nothing is ever upgraded. Run it after writing the project and
            before validate and deliver. Needs pdftotext.
  export    Writes the project in another form, next to it unless --out is given:
            md (Markdown report), html (printable report; print it to get a
            PDF), slides (one HTML deck), ipynb (the paper's equations as
            runnable NumPy), bib / ris (the citation), anki (flashcards).
            Every claim keeps its quote and page. No network, no model.
  anki      Writes an Anki import file: primer concepts, quiz questions and
            glossary terms, each card carrying its quote and page.
  graph     Prints the paper's citation graph from OpenAlex: the most-cited
            works it builds on and the most-cited works that cite it. Every
            node carries an "identifier" that prepare --source accepts.
  record    Prints how each model's quotes held up across the Trace library:
            quotes found on their page out of quotes checked, with the range
            the evidence is consistent with, the same paper analysed by
            different models, and every project left out with its reason.
            Reads the library only. No network, no model.
  concepts  Links concepts across the Trace library by name. With --project:
            for each primer concept of that project, the other papers that
            explain it and whether the reader studied it there (from the
            studio's study progress). Without: the concepts more than one
            paper explains. Reads the library only. No model.
            --suggest also looks through the paper's references (the 50
            most-cited, from OpenAlex) for works whose title, then abstract,
            names a concept the reader has not studied in any paper;
            --references <file> does the same offline with a list you give
            it (a JSON array of titles or { title, year, abstract } objects,
            or one title per line). A work already in the library is marked
            inLibrary.
  alias     Records the reader's decision that two concept names are the
            same concept (or --different, or --forget a decision). Only after
            the reader confirms: concepts are otherwise matched by name.
            concepts --names lists the names and the decisions so far;
            in a large library the names come in parts (--part <n>),
            names with similar definitions in the same part.
  progress  Prints the reader's learning statistics from the studio's study
            progress: papers finished and in progress, reviews remembered,
            questions right on the first try, where the review cards are
            (next review in 1 to 90 days), the week ahead (days on this
            machine's clock, named in timeZone), the cards forgotten most, and
            what explaining a section again added. Counts only; reads the
            library only. No network, no model.
  work      Prints the reader's work time from the studio's Focus timer
            (~/.trace/focus-log.json): today, this week and month against the
            daily goal, streaks, the last --days days (default 7), time by
            paper this week and in all, and the latest sessions. Days on this
            machine's clock. --ics <file> writes the sessions (of the last
            --days days, or all) as a calendar file instead. No network, no
            model.
  today     Prints the reader's day in one place: review cards due (and from
            which papers), papers studied halfway, the next paper or saved work
            in the reading order, today's and this week's work time against the
            goal, and suggestions to tell the reader in that order. Reads only;
            no network, no model.
  review    Review in the chat: lists the review cards due now without their
            answers (--limit, default 10). --show prints one card's answer;
            --answer checks the reader's answer by the studio's rules and
            writes the result to the studio's study progress (same lock):
            --choice for a question, --typed for a highlight's missing word,
            --remembered yes|no for a concept after its answer was shown. Only a
            due card is written. No network, no model.
  notes     Prints the reader's own notes and highlights on a paper (kept in
            ~/.trace/library/notes.json, never in the project) as Markdown, in
            the paper's order: story sections, report sections, Primer
            concepts, claims with their page. --obsidian adds YAML front matter
            and callouts; --out writes the file instead. Reads only; no
            network, no model.
  reading   Prints the reader's reading list (papers saved to read later in
            the studio, ~/.trace/library/reading-list.json) placed in the
            library's reading order: a work a paper builds on, or that explains
            a concept it assumes, comes before that paper; a work citing it
            comes after. --add saves a work (from "graph" or "concepts
            --suggest"), --for says which library paper it serves and how;
            --remove takes the id printed for it. No network, no model.
  --template
            prepare only. A narrative template id (see "templates") or a path
            to a template JSON. It fixes the story's sections, their visuals
            and the report order; job.json carries the instructions.
  --strict  Treats the learning blocks (primer, derivations, quiz, common
            misreadings, interactives, application guide) as REQUIRED for
            the chosen depth.

  --no-app  Do not start or open the main Trace app; deliver only the
            standalone site.
  --install-app
            Runs "npm install" when the studio's dependencies are missing.
            This can take minutes, which is why it never happens on its own.
  --app     Root of the Trace repository (default: found automatically,
            TRACE_APP_DIR).
  --app-url Address of a Trace app that is already running (TRACE_APP_URL).

  section   Rewrites ONE part of a project while the evidence stays locked:
            story:<id>, report:<id>, primer:<concept-id>, quiz:<question-id>,
            derivation:<id> or equation:<technical-appendix-equation-id>.
            Writes a brief and a prompt under revisions/ next to the project.
            Read the prompt, write the object as JSON to the reported
            sectionPath, then run splice.
  --claims  locked (default): the section must cite exactly the claims it
            cites now. open: it may cite any existing claim, never a new one.
  --goal    strengthen: for a thin story or report section (see thinSections
            in validate). The rewrite must cite at least two claims, one of
            them verified, or splice rejects it. Implies --claims open.
  splice    Validates the written section with the app's own rules and swaps
            it into the project. Nothing changes if any check fails. The
            replaced section is kept as …previous.json.

  explain   The reader explains one story (or report) section in their own
            words; this checks it against the evidence. Writes a brief and a
            prompt under explanations/ next to the project: the prompt holds
            only the evidence ledger, the section and the reader's text. Read
            it, write the feedback as JSON to the reported feedbackPath, then
            run explain-check.
  explain-check
            Checks the written feedback with the studio's own rules: every
            claim id exists, "left out" only names the section's own claims,
            and every quoted phrase is really in the reader's text. Prints
            what they conveyed, what they left out and where the evidence
            says otherwise, each with its claim and page. Nothing is saved
            in the project. When the project is in the Trace library, the
            explanation is kept with the reader's study progress (the
            studio shows it under "Your earlier explanations"), and
            history.sinceLast says what changed since their last
            explanation of the same section. --no-save skips that; --model
            names the model that wrote the feedback.

  publish   Freezes a copy of the project as a shareable link served by the
            Trace studio at /p/<id>. Blocks can be left out; evidence quotes
            always stay. Anyone who can reach the studio and has the link can
            read it. Manage or unpublish it from the studio's Publish panel.

The bridge never calls an LLM API. The active Codex, Claude Code, or Antigravity CLI model reads the prepared paper and writes the project.

Deliver brings everything up in one command: it keeps the JSON, builds the
standalone local site, readies the main Trace app (starting its dev server if
it is not already running), hands the project over to the library, and opens
both in the browser. The user never has to import anything by hand. Servers
that were started this way are shut down with "stop --site".

If the studio does not come up the delivery still succeeded: the standalone
site works, and its "Open in Studio" button shows the command that installs
the studio. PASS THE "appNote" AND "studioCommand" FIELDS ON TO THE USER.`);
  process.exit(exitCode);
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = values[index + 1];
    if (["no-open", "no-app", "install-app", "strict", "no-report", "no-appendix", "no-learning", "no-figures", "suggest", "no-save", "names", "different", "forget", "obsidian", "show", "answer"].includes(key)) {
      args[key] = true;
      continue;
    }
    if (!value || value.startsWith("--")) throw new Error(`--${key} needs a value.`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "paper";
}

function assertChoice(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`${label} must be one of: ${choices.join(", ")}.`);
  return value;
}

/**
 * Kullanıcının elinde PDF olmayabilir. `--title` veya `--arxiv` verildiğinde
 * makale arXiv'de bulunur, indirilir ve hakkındaki güncel/resmi üstveri
 * toplanır. Sonuç job dizinine yazılır; agent bunu anlatıyı zenginleştirmek
 * için kullanır.
 */
async function resolvePaper(args) {
  if (args.paper) return { paperPath: resolve(args.paper), resolution: null };

  // Kimlikle gelen her şey (arXiv, DOI, depo bağlantısı) aynı yoldan çözülür.
  const identifier = args.arxiv ?? args.doi ?? args.source;
  if (!identifier && !args.title) {
    throw new Error(
      "One of --paper <file.pdf>, --title \"<paper name>\", --arxiv <id>, --doi <doi> or --source <link or id> is required.",
    );
  }

  const { parseIdentifier, resolveIdentifier, searchPapers, isConfidentMatch, downloadFirstAvailable, collectContext } =
    await import("./lib/paper-source.mjs");

  let chosen;
  let candidates = [];
  let matchedBy = "title-search";
  // `--source`a başlık yazan kullanıcı da cevap almalı; hata almak yerine aranır.
  const parsed = identifier ? parseIdentifier(identifier) : undefined;
  if (parsed && parsed.kind !== "title") {
    chosen = await resolveIdentifier(parsed);
    matchedBy = `${parsed.kind}-id`;
  } else {
    const title = args.title ?? parsed.id;
    candidates = await searchPapers(title, 8);
    if (!candidates.length) throw new Error(`No paper found on arXiv or OpenAlex for: "${title}"`);
    const index = args.pick ? Number(args.pick) - 1 : 0;
    chosen = candidates[index];
    if (!chosen) throw new Error(`--pick ${args.pick} is out of range (${candidates.length} candidates).`);
  }

  const name = slugify(chosen.title ?? chosen.arxivId ?? chosen.doi ?? "paper");
  const directory = resolve(args.out ?? `.trace/jobs/${name}`);
  mkdirSync(directory, { recursive: true });
  const paperPath = join(directory, `${name}.pdf`);

  const download = await downloadFirstAvailable(chosen, paperPath);
  const context = await collectContext(chosen);
  writeFileSync(join(directory, "context.json"), `${JSON.stringify(context, null, 2)}\n`, "utf8");

  return {
    paperPath,
    jobDirectoryOverride: directory,
    resolution: {
      matchedBy,
      origin: chosen.origin,
      arxivId: chosen.arxivId,
      doi: chosen.doi,
      title: chosen.title,
      matchScore: chosen.matchScore,
      pdfUrl: download.url,
      sizeBytes: download.sizeBytes,
      // Önce denenip başarısız olan adresler; ajan neden ikinci kopyanın
      // kullanıldığını kullanıcıya söyleyebilsin.
      pdfAttempts: download.attempts.length ? download.attempts : undefined,
      contextPath: join(directory, "context.json"),
      citationGraph: context.citationGraph?.ok
        ? { references: context.citationGraph.references.length, citedBy: context.citationGraph.citedBy.length }
        : undefined,
      // Eşleşme kesin değilse agent kullanıcıya doğrulatabilsin diye
      // alternatifler her zaman raporlanır.
      alternatives: candidates.slice(0, 5).map((entry, index) => ({
        pick: index + 1,
        origin: entry.origin,
        arxivId: entry.arxivId,
        doi: entry.doi,
        title: entry.title,
        matchScore: entry.matchScore,
        pdfAvailable: entry.pdfAvailable !== false,
      })),
      // Güven ölçütü `isConfidentMatch` içinde; kimlikle çözülen kayıt kesindir.
      confident: matchedBy === "title-search" ? isConfidentMatch(candidates) && chosen === candidates[0] : true,
    },
  };
}

/**
 * Bir makalenin atıf grafiği: dayandığı ve onu izleyen çalışmalar.
 *
 * `prepare` bunu zaten context.json'a yazıyor; bu komut daha önce üretilmiş
 * bir proje ya da yalnızca merak edilen bir makale için. Her düğümün
 * `identifier` alanı doğrudan `prepare --source` ile analiz edilebilir.
 */
async function citationGraph(args) {
  const { parseIdentifier, resolveIdentifier } = await import("./lib/paper-source.mjs");
  const { fetchCitationGraph } = await import("./lib/citation-graph.mjs");
  let lookup;
  if (args.project) {
    const project = readJsonFile(resolve(args.project), "project");
    lookup = { doi: project.evidence?.paper?.doi, title: project.evidence?.paper?.title, authors: project.evidence?.paper?.authors };
  } else {
    const identifier = args.doi ?? args.source ?? args.title;
    if (!identifier) throw new Error("graph needs one of --project <project.trace.json>, --doi <doi>, --title \"<paper name>\" or --source <link or id>.");
    const parsed = parseIdentifier(identifier);
    if (parsed.kind === "doi") lookup = { doi: parsed.id };
    else if (parsed.kind === "title") lookup = { title: parsed.id };
    else {
      // arXiv kimliği ya da depo bağlantısı: grafik başlık ve yazarla eşleştirilir.
      const entry = await resolveIdentifier(parsed);
      lookup = { doi: entry.doi, title: entry.title, authors: entry.authors };
    }
  }
  const limit = args.limit ? Math.max(1, Math.min(25, Number(args.limit) || 12)) : 12;
  console.log(JSON.stringify(await fetchCitationGraph(lookup, { limit }), null, 2));
}

async function prepare(args) {
  /**
   * Seçenekler PDF'ten ÖNCE doğrulanıyor: `resolvePaper` arXiv'e gidip
   * megabaytlarca dosya indiriyor ve bunu eksik bir bayrak için yapmanın
   * anlamı yok. Ayrıca hatayı ajana anında geri veriyor.
   *
   * `--language` bu köprü kullanıcının hangi dilde yazdığını göremediği için
   * zorunlu. Buradaki her sessiz varsayılan kullanıcıların bir kısmı için
   * sessizce yanlış dilde çıktı üretir; tam olarak bu yaşandı: varsayılan
   * "tr" idi ve İngilizce yazan kullanıcı Türkçe analiz aldı.
   */
  if (args.language === undefined) {
    throw new Error(
      "--language is required. Pass a BCP-47 tag for the language the user is writing in (en, tr, de, pt-BR, …): it decides the language of the analysis prose, and this bridge cannot see the conversation to infer it.",
    );
  }
  // Etiket biçimi doğrulanıyor ama dil listesi YOK: Trace çıktıyı kullanıcının
  // dilinde üretiyor ve buraya konacak her liste birilerini dışarıda bırakır.
  // Biçim yine de denetleniyor, çünkü bu değer `Intl` API'lerine gidiyor.
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(args.language)) {
    throw new Error(`--language must be a BCP-47 tag such as "en", "tr" or "pt-BR"; received "${args.language}".`);
  }
  const language = args.language;
  const audience = assertChoice(args.audience ?? "student", ["general", "student", "expert"], "--audience");
  const depth = assertChoice(args.depth ?? "standard", ["concise", "standard", "deep"], "--depth");
  // PDF indirilmeden önce: yanlış bir şablon adı için megabaytlar harcanmasın.
  const template = args.template ? resolveTemplate(args.template) : undefined;

  const { paperPath, jobDirectoryOverride, resolution } = await resolvePaper(args);
  if (!existsSync(paperPath)) throw new Error(`PDF not found: ${paperPath}`);
  if (extname(paperPath).toLowerCase() !== ".pdf") throw new Error("The input must have a .pdf extension.");
  const size = statSync(paperPath).size;
  if (size > 35 * 1024 * 1024) throw new Error("The PDF exceeds the 35 MB Trace limit.");
  const signature = readFileSync(paperPath).subarray(0, 5).toString("ascii");
  if (signature !== "%PDF-") throw new Error("The file does not carry a valid PDF signature.");

  const jobDirectory =
    jobDirectoryOverride ??
    resolve(args.out ?? `.trace/jobs/${slugify(basename(paperPath, extname(paperPath)))}`);
  mkdirSync(jobDirectory, { recursive: true });

  const rawTextPath = resolve(jobDirectory, "paper.raw.txt");
  const pageTextPath = resolve(jobDirectory, "paper.pages.txt");
  const extraction = spawnSync("pdftotext", ["-layout", paperPath, rawTextPath], { encoding: "utf8" });
  let pageCount;
  let extractedText;
  let extractionNote;
  if (!extraction.error && extraction.status === 0 && existsSync(rawTextPath)) {
    const raw = readFileSync(rawTextPath, "utf8");
    const pages = raw.split("\f").filter((page, index, all) => page.trim() || index < all.length - 1);
    extractedText = pages.map((page, index) => `--- PAGE ${index + 1} ---\n${page.trimEnd()}`).join("\n\n");
    writeFileSync(pageTextPath, `${extractedText}\n`, "utf8");
    pageCount = pages.length;
    extractionNote = "extracted with pdftotext -layout, page boundaries preserved";
  } else {
    extractionNote = extraction.error?.code === "ENOENT"
      ? "pdftotext not found; the active agent must load the PDF with its own document tool"
      : `pdftotext failed: ${(extraction.stderr || extraction.error?.message || "unknown").trim()}`;
  }

  const outputPath = resolve(jobDirectory, `${slugify(basename(paperPath, extname(paperPath)))}.trace.json`);
  /**
   * Makalenin kendi şekilleri çıkarılır. Hangisinin anlatıya girdiğine AJAN
   * karar verir — bir makalede sekiz şekil bulunabiliyor ve çoğu tablo ya da
   * ek bölüm grafiği oluyor. Burada yalnızca aday üretiliyor.
   *
   * Şekil çıkarılamaması hazırlığı düşürmez: metin zaten elimizde ve görsel
   * bir ek, zorunluluk değil.
   */
  const figureDirectory = resolve(jobDirectory, "figures");
  let figures = [];
  let figureNote;
  try {
    const extracted = extractFigures(paperPath, figureDirectory, { limit: 10 });
    figures = extracted.figures;
    figureNote = extracted.note;
  } catch (error) {
    figureNote = error instanceof Error ? error.message : String(error);
  }

  // This state lives under ~/.trace, so Codex, Claude Code and Antigravity
  // share one shuffled sequence regardless of the directory they start in.
  const presentation = assignPaperAccent(paperPath);

  const job = {
    version: 1,
    createdAt: new Date().toISOString(),
    paper: { path: paperPath, fileName: basename(paperPath), sizeBytes: size, pageCount },
    extraction: { ready: Boolean(extractedText), pageTextPath: extractedText ? pageTextPath : undefined, note: extractionNote },
    outputPath,
    figures: figures.map((figure) => ({
      id: figure.id,
      label: figure.label,
      caption: figure.caption,
      page: figure.page,
      path: figure.file,
      widthPx: figure.widthPx,
      heightPx: figure.heightPx,
      bytes: figure.bytes,
    })),
    figureNote,
    options: { language, audience, depth },
    presentation,
    targets: {
      storySections: expectedSectionCounts({ depth, template }).story,
      reportSections: expectedSectionCounts({ depth, template }).report,
    },
    template: template
      ? {
          ...template,
          storyInstructions: templateStoryInstructions(template),
          reportInstructions: templateReportInstructions(template) || undefined,
          note: "Follow this structure and copy the template object (without storyInstructions, reportInstructions and note) into the project's top-level template field; validate checks the story against it.",
        }
      : undefined,
    resolution: resolution ?? undefined,
  };
  const jobPath = resolve(jobDirectory, "job.json");
  writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        jobPath,
        outputPath,
        pageTextPath: extractedText ? pageTextPath : null,
        extractionNote,
        figureCount: figures.length,
        figureDirectory: figures.length ? figureDirectory : null,
        figureNote,
        presentation,
        resolution: resolution ?? undefined,
      },
      null,
      2,
    ),
  );
}

/**
 * Proje doğrulama.
 *
 * Buradaki kurallar ELLE YAZILMAZ. `scripts/generated/validator.mjs`
 * uygulamanın gerçek Zod şemasını ve bütünlük fonksiyonlarını içeren derlenmiş
 * bir pakettir (`npm run build:validator`). Eskiden bu dosyada ~380 satırlık
 * bir kopya vardı ve sapmıştı: üst sınırlar denetlenmediği için `validate`
 * "ok" derken web uygulaması aynı dosyayı reddediyordu. Kopya kaldırıldı;
 * parite artık yapısal bir garanti.
 */
function assignedAccentForProject(projectPath) {
  const jobPath = join(dirname(projectPath), "job.json");
  if (!existsSync(jobPath)) return undefined;
  try {
    const job = JSON.parse(readFileSync(jobPath, "utf8"));
    if (resolve(job.outputPath ?? "") !== projectPath) return undefined;
    return TRACE_ACCENT_PALETTE.includes(job.presentation?.accent)
      ? job.presentation.accent
      : undefined;
  } catch {
    return undefined;
  }
}

function inspectProject(args, print = true) {
  if (!args.project) throw new Error("--project <project.trace.json> is required.");
  const projectPath = resolve(args.project);
  if (!existsSync(projectPath)) throw new Error(`Project not found: ${projectPath}`);

  let raw;
  try {
    raw = JSON.parse(readFileSync(projectPath, "utf8"));
  } catch (error) {
    throw new Error(`The project is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  // --strict: öğrenme bloklarının `depth` için zorunlu olanlarını da arar.
  // Varsayılan kapalı, böylece öğrenme katmanından önce üretilmiş projeler
  // doğrulanmaya devam eder.
  const outcome = validateProjectObject(raw, { requireDepthBlocks: Boolean(args.strict) });

  if (!outcome.ok) {
    const result = { ok: false, projectPath, issueCount: outcome.issues.length, issues: outcome.issues };
    if (print) console.error(JSON.stringify(result, null, 2));
    return result;
  }

  const project = outcome.project;
  const assignedAccent = assignedAccentForProject(projectPath);
  if (assignedAccent && project.story.accent.toUpperCase() !== assignedAccent) {
    const result = {
      ok: false,
      projectPath,
      issueCount: 1,
      issues: [{
        path: ["story", "accent"],
        message: `Use the paper's assigned accent ${assignedAccent} from job.json; received ${project.story.accent}.`,
      }],
    };
    if (print) console.error(JSON.stringify(result, null, 2));
    return result;
  }
  const result = {
    ok: true,
    projectPath,
    title: project.evidence.paper.title,
    claims: project.evidence.claims.length,
    storySections: project.story.sections.length,
    visualTypes: [...new Set(project.story.sections.map((section) => section.visual.type))],
    deepReport: Boolean(project.deepReport),
    technicalAppendix: Boolean(project.technicalAppendix),
    learning: {
      primerConcepts: project.primer?.concepts.length ?? 0,
      derivations: project.derivations?.length ?? 0,
      interactives: project.interactives?.length ?? 0,
      quizQuestions: project.quiz?.questions.length ?? 0,
      misreadings: project.misreadings?.items.length ?? 0,
      applicationGuide: Boolean(project.applicationGuide),
    },
    // Tek iddiaya ya da yalnızca doğrulanmamış iddialara dayanan bölümler;
    // `section --goal strengthen` bunları daha fazla kanıtla yeniden yazdırır.
    // Alıntıların sayfa metnine karşı denetimi; `verify` yazar. Yoksa denetlenmemiştir.
    excerptCheck: project.excerptCheck
      ? { checkedAt: project.excerptCheck.checkedAt, checked: project.excerptCheck.checked, notFound: project.excerptCheck.unlocated.length }
      : "not run — run verify before deliver so the project records that its quotes were found on their pages",
    thinSections: evidenceHealth(project).sections
      .filter((section) => section.thin)
      .map((section) => ({ target: `${section.area}:${section.id}`, title: section.title, claims: section.claimCount, verified: section.verifiedCount })),
    project,
  };

  if (print) {
    // Projenin tamamı çağırana döner ama konsola basılmaz; özet okunabilir kalsın.
    const summary = { ...result };
    delete summary.project;
    console.log(JSON.stringify(summary, null, 2));
  }
  return result;
}
/**
 * Alıntıları PDF'in sayfa metnine karşı denetler ve sonucu projeye yazar.
 *
 * `confidence` ajanın kendi beyanı; bu komut ise mekanik: her alıntı atıf
 * yaptığı sayfada aranır. Alıntılarının hiçbiri bulunamayan "verified" iddia
 * "needs-review" olur, hiçbir şey yükseltilmez. Uygulamadaki denetimle AYNI
 * kod (derlenmiş paket), dolayısıyla stüdyo ile köprü farklı hüküm vermez.
 *
 * Metin kaynağı sırayla: --pages, --paper, yoksa projenin yanındaki job.json.
 */
function verifyProject(args) {
  const inspected = inspectProject(args, false);
  if (!inspected.ok) {
    console.error(JSON.stringify({ ok: false, projectPath: inspected.projectPath, issues: inspected.issues }, null, 2));
    process.exitCode = 1;
    return;
  }
  const projectPath = inspected.projectPath;

  let raw;
  if (args.pages) {
    // paper.pages.txt işaretli, paper.raw.txt form-feed'li; ikisi de kabul edilir.
    raw = readFileSync(resolve(args.pages), "utf8").replace(/\n*--- PAGE \d+ ---\n/g, "\f").replace(/^\f/, "");
  } else {
    let paperPath = args.paper ? resolve(args.paper) : undefined;
    const jobPath = join(dirname(projectPath), "job.json");
    const rawTextPath = join(dirname(projectPath), "paper.raw.txt");
    if (!paperPath && existsSync(rawTextPath)) raw = readFileSync(rawTextPath, "utf8");
    if (!paperPath && !raw && existsSync(jobPath)) paperPath = readJsonFile(jobPath, "job").paper?.path;
    if (!raw) {
      if (!paperPath || !existsSync(paperPath)) {
        throw new Error("verify needs the paper: pass --paper <paper.pdf> or --pages <paper.pages.txt>, or keep the project next to its job.json.");
      }
      const extraction = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", paperPath, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (extraction.error?.code === "ENOENT") {
        throw new Error("verify needs pdftotext (Poppler): brew install poppler, apt install poppler-utils or choco install poppler.");
      }
      if (extraction.status !== 0) throw new Error(`pdftotext failed: ${(extraction.stderr || "unknown error").trim()}`);
      raw = extraction.stdout;
    }
  }

  const pages = splitPages(raw);
  if (pages.reduce((sum, page) => sum + page.trim().length, 0) < 1_500) {
    throw new Error("The PDF has almost no extractable text (probably a scan), so its quotes cannot be checked mechanically.");
  }
  const { project, downgradedIds } = applyExcerptCheck(inspected.project, pages);
  const check = project.excerptCheck;
  // Yanlış PDF her iddiayı düşürürdü; neredeyse hiçbir şey eşleşmiyorsa dokunulmaz.
  if (check.checked >= 5 && check.unlocated.length / check.checked > 0.8) {
    throw new Error(`Only ${check.checked - check.unlocated.length} of ${check.checked} quotes were found. This is probably not the PDF the project was written from; nothing was changed.`);
  }
  // Dosyanın KENDİSİ güncellenir, şemadan geçmiş kopyası değil: ayrıştırma
  // anahtarları yeniden sıralıyor ve ajanın yazdığı biçimi bozuyordu.
  const onDisk = readJsonFile(projectPath, "project");
  const downgraded = new Set(downgradedIds);
  for (const claim of onDisk.evidence.claims) if (downgraded.has(claim.id)) claim.confidence = "needs-review";
  onDisk.excerptCheck = check;
  atomicWrite(projectPath, `${JSON.stringify(onDisk, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    projectPath,
    pages: pages.length,
    checked: check.checked,
    found: check.checked - check.unlocated.length,
    notFound: check.unlocated,
    downgradedToNeedsReview: downgradedIds,
    note: check.unlocated.length
      ? "Open each notFound item on its page. Fix an excerpt you paraphrased by copying the exact words, then run verify again; leave a claim needs-review when its support really is a table, figure or equation that text extraction cannot read. Run validate afterwards: a section may have become thin."
      : "Every quote was found on the page it cites.",
  }, null, 2));
}

/**
 * Anki destesi: primer kavramları, quiz soruları ve sözlük, her kartın
 * arkasında dayandığı alıntı ve sayfayla. Stüdyodaki düğmeyle aynı kod.
 */
function exportAnki(args) {
  const inspected = inspectProject(args, false);
  if (!inspected.ok) {
    console.error(JSON.stringify({ ok: false, projectPath: inspected.projectPath, issues: inspected.issues }, null, 2));
    process.exitCode = 1;
    return;
  }
  const cards = ankiCards(inspected.project);
  if (!cards.length) throw new Error("This project has no primer, quiz or glossary to make cards from.");
  const outPath = resolve(args.out ?? inspected.projectPath.replace(/(\.trace)?\.json$/i, "") + ".anki.txt");
  atomicWrite(outPath, buildAnkiDeck(inspected.project));
  console.log(JSON.stringify({
    ok: true,
    deckPath: outPath,
    cards: cards.length,
    note: "In Anki: File → Import, pick this file. The deck name, note type and tags are set by the file's header lines.",
  }, null, 2));
}

/**
 * Projeyi başka bir biçime çevirir: rapor, slayt, defter, kaynakça, kartlar.
 * Stüdyodaki Export menüsüyle AYNI tablo ve aynı kod; ağ yok, model yok.
 */
function exportProject(args) {
  const formats = exportDefinitions.map((definition) => definition.format);
  if (!args.format) throw new Error(`--format is required. One of: ${formats.join(", ")}.`);
  const definition = findExport(args.format);
  if (!definition) throw new Error(`Unknown --format "${args.format}". One of: ${formats.join(", ")}.`);

  const inspected = inspectProject(args, false);
  if (!inspected.ok) {
    console.error(JSON.stringify({ ok: false, projectPath: inspected.projectPath, issues: inspected.issues }, null, 2));
    process.exitCode = 1;
    return;
  }
  const reason = definition.unavailable?.(inspected.project);
  if (reason) throw new Error(reason);

  const outPath = resolve(args.out ?? `${inspected.projectPath.replace(/(\.trace)?\.json$/i, "")}.${definition.extension}`);
  atomicWrite(outPath, definition.build(inspected.project));
  console.log(JSON.stringify({ ok: true, format: definition.format, label: definition.label, path: outPath, note: definition.description }, null, 2));
}

function validateProject(args) {
  const result = inspectProject(args);
  if (!result.ok) process.exitCode = 1;
}

/**
 * Bölüm yeniden üretimi.
 *
 * Uygulamada model doğrudan çağrılıyor; burada modeli ajanın kendisi
 * çalıştırıyor. Köprü iki uçta duruyor: önce kilidi ve istemi yazan bir
 * özet, sonra ajanın yazdığı bölümü uygulamanın AYNI takma fonksiyonuyla
 * projeye takan bir adım. Kontrol başarısız olursa proje dosyasına hiç
 * dokunulmuyor.
 */
function readJsonFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`The ${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function revisionPaths(projectPath, target) {
  const directory = join(dirname(projectPath), "revisions");
  const stem = slugify(target.replace(":", "-"));
  return {
    brief: join(directory, `${stem}.brief.json`),
    prompt: join(directory, `${stem}.prompt.md`),
    section: join(directory, `${stem}.section.json`),
    previous: join(directory, `${stem}.previous.json`),
  };
}

function prepareSection(args) {
  if (!args.project) throw new Error("--project <project.trace.json> is required.");
  if (!args.target) throw new Error("--target <kind>:<id> is required, e.g. story:<section-id>, report:<section-id> or quiz:<question-id>.");
  const projectPath = resolve(args.project);
  const outcome = buildSectionBrief(readJsonFile(projectPath, "project"), args.target, {
    claimPolicy: args.claims,
    instruction: args.instruction,
    goal: args.goal,
  });
  if (!outcome.ok) {
    console.error(JSON.stringify({ ok: false, issueCount: outcome.issues.length, issues: outcome.issues }, null, 2));
    process.exitCode = 1;
    return;
  }

  const paths = revisionPaths(projectPath, outcome.brief.target);
  atomicWrite(paths.brief, `${JSON.stringify({ ...outcome.brief, projectPath }, null, 2)}\n`);
  atomicWrite(
    paths.prompt,
    `${outcome.brief.prompt}\n\n---\n\nWrite the section object, and nothing else, as JSON to:\n${paths.section}\n\nThen run:\nnode ${SCRIPT_PATH} splice --brief ${paths.brief}\n`,
  );
  console.log(JSON.stringify({
    ok: true,
    target: outcome.brief.target,
    claimPolicy: outcome.brief.claimPolicy,
    goal: outcome.brief.goal,
    evidenceFingerprint: outcome.brief.evidenceFingerprint,
    briefPath: paths.brief,
    promptPath: paths.prompt,
    sectionPath: paths.section,
    next: `Read ${paths.prompt}, write the section to ${paths.section}, then run splice --brief ${paths.brief}`,
  }, null, 2));
}

function applySection(args) {
  if (!args.brief) throw new Error("--brief <revisions/…brief.json> is required.");
  const briefPath = resolve(args.brief);
  const brief = readJsonFile(briefPath, "brief");
  const projectPath = resolve(args.project ?? brief.projectPath ?? "");
  const sectionPath = resolve(args.section ?? briefPath.replace(/\.brief\.json$/, ".section.json"));
  const previousPath = briefPath.replace(/\.brief\.json$/, ".previous.json");

  const outcome = spliceSectionObject(
    readJsonFile(projectPath, "project"),
    brief,
    readJsonFile(sectionPath, "section"),
  );
  if (!outcome.ok) {
    console.error(JSON.stringify({
      ok: false,
      projectPath,
      issueCount: outcome.issues.length,
      issues: outcome.issues,
      note: "The project was not changed. Fix the section file and run splice again.",
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  atomicWrite(previousPath, `${JSON.stringify(outcome.previous, null, 2)}\n`);
  atomicWrite(projectPath, `${JSON.stringify(outcome.project, null, 2)}\n`);

  // Proje daha önce teslim edildiyse stüdyo kütüphanedeki kopyayı okuyor;
  // o kopya eski kalırsa kullanıcı değişikliği hiç görmez.
  const libraryPath = join(traceLibraryDirectory(), projectLibraryFileName(outcome.project.id));
  const libraryUpdated = existsSync(libraryPath);
  if (libraryUpdated) persistLibraryProject(outcome.project, "regenerate");

  console.log(JSON.stringify({
    ok: true,
    projectPath,
    target: brief.target,
    previousPath,
    libraryUpdated,
    next: `Run deliver --project ${projectPath} to rebuild the standalone site.`,
  }, null, 2));
}

function explanationPaths(projectPath, target) {
  const directory = join(dirname(projectPath), "explanations");
  const stem = slugify(target.replace(":", "-"));
  return {
    brief: join(directory, `${stem}.brief.json`),
    prompt: join(directory, `${stem}.prompt.md`),
    feedback: join(directory, `${stem}.feedback.json`),
  };
}

/**
 * "Kendi cümlelerinle anlat": okuyucunun açıklamasını kanıta karşı denetletmek
 * için ajana yalnızca kanıtı içeren istemi yazar. Ajan geri bildirimi yazınca
 * `explain-check` onu stüdyonun kullandığı aynı kurallarla denetler.
 */
function prepareExplanation(args) {
  if (!args.project) throw new Error("--project <project.trace.json> is required.");
  if (!args.target) throw new Error("--target story:<section-id> (or report:<section-id>) is required.");
  if (!args.text && !args["text-file"]) throw new Error('--text "<the reader\'s explanation>" or --text-file <file> is required.');
  const projectPath = resolve(args.project);
  const text = args.text ?? readFileSync(resolve(args["text-file"]), "utf8");
  const outcome = buildExplanationBrief(readJsonFile(projectPath, "project"), args.target, text);
  if (!outcome.ok) {
    console.error(JSON.stringify({ ok: false, issueCount: outcome.issues.length, issues: outcome.issues }, null, 2));
    process.exitCode = 1;
    return;
  }
  const paths = explanationPaths(projectPath, outcome.brief.target);
  atomicWrite(paths.brief, `${JSON.stringify({ ...outcome.brief, projectPath }, null, 2)}\n`);
  atomicWrite(
    paths.prompt,
    `${outcome.brief.prompt}\n\n---\n\nWrite the feedback object, and nothing else, as JSON to:\n${paths.feedback}\n\nThen run:\nnode ${SCRIPT_PATH} explain-check --brief ${paths.brief}\n`,
  );
  console.log(JSON.stringify({
    ok: true,
    target: outcome.brief.target,
    briefPath: paths.brief,
    promptPath: paths.prompt,
    feedbackPath: paths.feedback,
    next: `Read ${paths.prompt}, write the feedback to ${paths.feedback}, then run explain-check --brief ${paths.brief}`,
  }, null, 2));
}

function checkExplanation(args) {
  if (!args.brief) throw new Error("--brief <explanations/…brief.json> is required.");
  const briefPath = resolve(args.brief);
  const brief = readJsonFile(briefPath, "brief");
  const projectPath = resolve(args.project ?? brief.projectPath ?? "");
  const feedbackPath = resolve(args.feedback ?? briefPath.replace(/\.brief\.json$/, ".feedback.json"));
  const outcome = checkExplanationFeedback(readJsonFile(projectPath, "project"), brief, readJsonFile(feedbackPath, "feedback"));
  if (!outcome.ok) {
    console.error(JSON.stringify({
      ok: false,
      feedbackPath,
      issueCount: outcome.issues.length,
      issues: outcome.issues,
      note: "Fix the feedback file and run explain-check again. Quote the reader's words exactly and cite only claim ids from the ledger.",
    }, null, 2));
    process.exitCode = 1;
    return;
  }
  const { ok, ...report } = outcome;
  const history = args["no-save"]
    ? { saved: false, reason: "--no-save" }
    : saveExplanationHistory(readJsonFile(projectPath, "project"), brief, readJsonFile(feedbackPath, "feedback"), args.model);
  console.log(JSON.stringify({
    ok,
    ...report,
    history,
    note: "This is a model's reading of the explanation against the collected evidence, not a grade; it did not read the paper. Tell the reader what they conveyed, what they left out and where the evidence says otherwise, with each claim's page. When history.sinceLast is set, also tell them what they conveyed this time that they had not last time, and what they left out both times.",
  }, null, 2));
}

/**
 * Anlatış kütüphanenin çalışma kaydına ekleniyor (stüdyonun `study.json`'ı,
 * aynı kilit ve bozuk dosyayı kenara alma kuralıyla): stüdyo onu "Your earlier
 * explanations" altında gösteriyor ve bir sonraki anlatış onunla
 * karşılaştırılıyor. Proje kütüphanede değilse yazılmıyor; ilerleme projeye
 * değil kütüphanedeki makaleye ait.
 */
function saveExplanationHistory(project, brief, feedback, model) {
  const library = traceLibraryDirectory();
  if (!existsSync(join(library, projectLibraryFileName(brief.projectId)))) {
    return { saved: false, reason: "The project is not in the Trace library, so there is no study progress to keep the explanation in. Run deliver first." };
  }
  const release = acquireDirectoryLock(library, "study.lock", "The study progress is busy. Please retry in a moment.");
  try {
    const path = join(library, "study.json");
    let raw;
    let exists = true;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") exists = false;
      else if (!(error instanceof SyntaxError)) throw error;
    }
    const outcome = recordCheckedExplanation(project, brief, feedback, raw, typeof model === "string" && model.trim() ? model.trim() : "your agent", new Date().toISOString());
    if (!outcome.ok) return { saved: false, reason: outcome.issues.join("; ") };
    if (!outcome.duplicate) {
      if (exists && !isStudyFile(raw)) {
        renameSync(path, join(library, `study.damaged-${new Date().toISOString().replace(/[-:.]/g, "")}.json`));
      }
      atomicWrite(path, `${JSON.stringify(outcome.file, null, 2)}\n`);
    }
    return {
      saved: !outcome.duplicate,
      ...(outcome.duplicate ? { reason: "This explanation was already recorded." } : {}),
      explanations: outcome.explanations,
      sinceLast: outcome.sinceLast,
    };
  } finally {
    release();
  }
}

/**
 * Stüdyonun sunacağı bir yayın kaydı yazar. Kayıt biçimi ve süzme kuralları
 * uygulamanınkiyle aynı kod; stüdyo çalışmıyorsa kayıt yine yazılır ve
 * stüdyo açıldığında bağlantı çalışır.
 */
async function publishProjectLink(args) {
  if (!args.project) throw new Error("--project <project.trace.json> is required.");
  const days = args["expires-days"] === undefined ? null : Number(args["expires-days"]);
  if (days !== null && ![7, 30, 90].includes(days)) throw new Error("--expires-days must be 7, 30 or 90.");

  const validation = inspectProject({ project: args.project }, false);
  if (!validation.ok) {
    console.error(JSON.stringify({ ok: false, issues: validation.issues, note: "Only a valid project can be published." }, null, 2));
    process.exitCode = 1;
    return;
  }
  // Yayın kütüphanedeki kopyadan türer; stüdyo "güncelle" dediğinde aynı yerden okur.
  persistLibraryProject(validation.project);

  const include = {
    ...defaultPublicationInclude,
    deepReport: !args["no-report"],
    technicalAppendix: !args["no-appendix"],
    learning: !args["no-learning"],
    figures: !args["no-figures"],
  };
  const now = new Date().toISOString();
  const record = publicationRecordSchema.parse({
    version: 1,
    id: randomUUID().replace(/-/g, "").slice(0, 20),
    projectId: validation.project.id,
    title: validation.project.story.title,
    createdAt: now,
    updatedAt: now,
    publishedFrom: validation.project.updatedAt,
    contentFingerprint: projectContentFingerprint(validation.project),
    status: "live",
    settings: { include, expiresAt: expiryFromDays(days, now) },
    project: projectForPublication(validation.project, include),
  });
  const directory = process.env.TRACE_PUBLICATION_DIR
    ? resolve(process.env.TRACE_PUBLICATION_DIR)
    : join(traceDataDirectory(), "publications");
  atomicWrite(join(directory, `${record.id}.publication.json`), `${JSON.stringify(record)}\n`);

  const path = publicationPath(record.id);
  let studioUrl;
  const explicit = args["app-url"] ?? process.env.TRACE_APP_URL;
  for (const candidate of explicit ? [explicit.replace(/\/+$/, "")] : ["http://127.0.0.1:3000", "http://127.0.0.1:3001", "http://127.0.0.1:3002"]) {
    if (await probeTraceApp(candidate)) {
      studioUrl = candidate;
      break;
    }
  }
  console.log(JSON.stringify({
    ok: true,
    id: record.id,
    path,
    url: studioUrl ? `${studioUrl}${path}` : undefined,
    expiresAt: record.settings.expiresAt,
    excluded: Object.entries(include).filter(([, on]) => !on).map(([key]) => key),
    note: studioUrl
      ? "The link works for anyone who can reach this studio. On localhost that is only this machine."
      : "No studio is running. The link starts working at <studio address>/p/<id> once the studio runs; deliver starts it.",
  }, null, 2));
}

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
const APP_HEALTH_MARKER = "trace-research-studio";
const APP_BOOT_TIMEOUT_MS = 180_000;

/**
 * "Bu porttaki uygulama gerçekten Trace mi?" — sağlık ucu bir protokol imzası.
 * Sadece portun açık olmasına bakmak yetmez: 3000 bambaşka bir dev sunucusu
 * olabilir ve projeyi oraya devretmek sessizce boşa giderdi.
 */
async function probeTraceApp(baseUrl, timeoutMs = 1_500) {
  try {
    const response = await fetch(new URL("/api/health", baseUrl), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.app === APP_HEALTH_MARKER;
  } catch {
    return false;
  }
}

/**
 * Trace deposunun kökünü arar. İşaret olarak `trace:agent` betiği kullanılıyor;
 * ada bakmak sahte eşleşme üretir, bu betik yalnızca bu projede var.
 *
 * Birden çok aday çıkabiliyor — plugin klonu deponun tamamını taşıdığı için
 * kendisi de bir adaydır, ama bağımlılıkları kurulu değildir. Bu yüzden
 * BAĞIMLILIKLARI KURULU olan aday tercih edilir: kullanıcının çalışan bir
 * kopyası varsa yüzlerce megabaytlık ikinci bir kurulum gereksizdir.
 */
function findAppRoots(startDirectories) {
  const found = [];
  for (const start of startDirectories) {
    if (!start) continue;
    let current = resolve(start);
    for (let depth = 0; depth < 8; depth += 1) {
      const manifest = join(current, "package.json");
      if (existsSync(manifest)) {
        try {
          const parsed = JSON.parse(readFileSync(manifest, "utf8"));
          if (parsed?.scripts?.["trace:agent"] && !found.includes(current)) found.push(current);
        } catch {
          // bozuk package.json: yukarı çıkmayı sürdür
        }
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return found;
}

const STUDIO_MEMO = join(homedir(), ".trace", "studio.json");

/**
 * Çalışır durumda bir stüdyo bir kez bulunduğunda yeri hatırlanır.
 *
 * Sebebi somut: ajan çoğu zaman kullanıcının BAŞKA bir projesinin dizininde
 * çalışıyor ve yukarı doğru arama Trace deposuna hiç rastlamıyor. Bir kez
 * depodan çalıştırmak, sonraki bütün teslimatların stüdyoyu bulmasına yetiyor.
 */
function readRememberedAppRoot() {
  try {
    const { appRoot } = JSON.parse(readFileSync(STUDIO_MEMO, "utf8"));
    return typeof appRoot === "string" && existsSync(join(appRoot, "package.json")) ? appRoot : undefined;
  } catch {
    return undefined;
  }
}

function rememberAppRoot(appRoot) {
  try {
    mkdirSync(dirname(STUDIO_MEMO), { recursive: true });
    writeFileSync(STUDIO_MEMO, `${JSON.stringify({ appRoot }, null, 2)}\n`, "utf8");
  } catch {
    // hatırlamak bir kolaylık; başarısız olması teslimatı etkilemez
  }
}

function findAppRoot(startDirectories) {
  const roots = findAppRoots([readRememberedAppRoot(), ...startDirectories]);
  return roots.find((root) => existsSync(join(root, "node_modules", "next"))) ?? roots[0];
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/**
 * Stüdyonun bağımlılıklarını kurar. Yüzlerce megabayt indirip dakikalar
 * sürebildiği için KENDİLİĞİNDEN çalışmaz: bir makaleyi anlatma isteği,
 * kullanıcının diskine bu boyutta bir şey yazma izni değildir. `--install-app`
 * ile açıkça istenir.
 */
function installAppDependencies(appRoot, logDirectory) {
  const logPath = join(logDirectory, "trace-app-install.log");
  const log = openSync(logPath, "a");
  const result = spawnSync(npmCommand(), ["install", "--no-audit", "--no-fund"], {
    cwd: appRoot,
    stdio: ["ignore", log, log],
    timeout: 15 * 60 * 1000,
  });
  if (result.status === 0) return { ok: true, logPath };
  return { ok: false, reason: `npm install failed (${result.status ?? result.signal}); log: ${logPath}`, logPath };
}

async function startTraceApp(appRoot, logDirectory, args) {
  if (!existsSync(join(appRoot, "node_modules", "next"))) {
    if (!args["install-app"]) {
      return {
        ok: false,
        appRoot,
        command: `cd "${appRoot}" && npm install && npm run dev`,
        reason: `Trace Studio dependencies are not installed. Run once: cd "${appRoot}" && npm install — or re-run deliver with --install-app.`,
      };
    }
    const installed = installAppDependencies(appRoot, logDirectory);
    if (!installed.ok) return { ok: false, appRoot, command: `cd "${appRoot}" && npm install && npm run dev`, reason: installed.reason };
  }
  const port = await findOpenPort(3000);
  const url = `http://127.0.0.1:${port}`;
  const logPath = join(logDirectory, "trace-app.log");
  const log = openSync(logPath, "a");
  const child = spawn(npmCommand(), ["run", "dev", "--", "--port", String(port)], {
    cwd: appRoot,
    detached: true,
    stdio: ["ignore", log, log],
  });
  let exited = false;
  child.on("error", () => { exited = true; });
  child.on("exit", () => { exited = true; });
  child.unref();

  const deadline = Date.now() + APP_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeTraceApp(url, 2_000)) {
      rememberAppRoot(appRoot);
      return { ok: true, url, port, pid: child.pid, logPath, started: true, appRoot };
    }
    if (exited) {
      return { ok: false, appRoot, command: `cd "${appRoot}" && npm run dev`, reason: `The dev server exited; log: ${logPath}`, logPath };
    }
    await new Promise((wait) => setTimeout(wait, 500));
  }
  return { ok: false, appRoot, command: `cd "${appRoot}" && npm run dev`, reason: `The dev server did not answer within ${APP_BOOT_TIMEOUT_MS / 1000}s; log: ${logPath}`, logPath };
}

/**
 * Ana uygulamayı hazır hale getirir: ayaktaysa onu kullanır, değilse başlatır.
 * Başarısızlık teslimatı DÜŞÜRMEZ — bağımsız site zaten çalışıyor ve JSON
 * diskte duruyor; ana uygulama bir ek yüzey.
 */
async function ensureTraceApp(args, logDirectory) {
  if (args["no-app"]) return { ok: false, skipped: "--no-app was passed." };

  const explicitUrl = args["app-url"] ?? process.env.TRACE_APP_URL;
  if (explicitUrl) {
    const url = explicitUrl.replace(/\/+$/, "");
    if (await probeTraceApp(url, 4_000)) return { ok: true, url, started: false, reused: true };
    return { ok: false, reason: `No Trace app answered at ${url}.` };
  }

  for (const port of [3000, 3001, 3002]) {
    const url = `http://127.0.0.1:${port}`;
    if (await probeTraceApp(url)) return { ok: true, url, port, started: false, reused: true };
  }

  const appRoot = args.app ?? process.env.TRACE_APP_DIR
    ?? findAppRoot([SKILL_DIRECTORY, process.cwd()]);
  if (!appRoot) {
    return { ok: false, reason: "The Trace repository was not found; point at it with --app <dir> or TRACE_APP_DIR." };
  }
  if (!existsSync(join(resolve(appRoot), "package.json"))) {
    return { ok: false, reason: `${appRoot} is not a Node project.` };
  }
  return startTraceApp(resolve(appRoot), logDirectory, args);
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Aynı proje ikinci kez teslim edildiğinde yeni sunucu açmaz. Aksi halde her
 * çalıştırma bir port daha tutar ve kullanıcı hangi sekmenin güncel olduğunu
 * bilemez.
 */
async function reuseViewerServer(statusPath, projectId) {
  if (!existsSync(statusPath)) return undefined;
  try {
    const status = JSON.parse(readFileSync(statusPath, "utf8"));
    if (!isAlive(status.pid)) return undefined;
    const response = await fetch(`${status.url}/${encodeURIComponent(projectId)}.trace.json`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return undefined;
    const served = await response.json();
    return served?.id === projectId ? status : undefined;
  } catch {
    return undefined;
  }
}

function findOpenPort(start = 4317) {
  return new Promise((resolvePort, reject) => {
    const tryPort = (port) => {
      const probe = createNetServer();
      probe.unref();
      probe.once("error", (error) => {
        if (error.code === "EADDRINUSE" && port < start + 100) tryPort(port + 1);
        else reject(error);
      });
      probe.listen({ host: "127.0.0.1", port }, () => {
        const selected = probe.address().port;
        probe.close(() => resolvePort(selected));
      });
    };
    tryPort(start);
  });
}

function contentType(pathname) {
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".html") || pathname === "/") return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function serve(args) {
  if (!args.site) throw new Error("--site <site-directory> is required.");
  if (!args.port) throw new Error("--port <port> is required.");
  const siteDirectory = resolve(args.site);
  const port = Number(args.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be a valid TCP port.");

  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relativePath = requested === "/" ? "index.html" : decodeURIComponent(requested).replace(/^\/+/, "");
    const filePath = resolve(siteDirectory, normalize(relativePath));
    if (filePath !== siteDirectory && !filePath.startsWith(`${siteDirectory}/`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    const headers = {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    };
    // Ana uygulama (localhost:3000) projeyi buradan çekip kütüphanesine alıyor.
    // İzin YALNIZCA loopback kaynaklara ve YALNIZCA proje dosyasına veriliyor:
    // sitenin geri kalanı hiçbir sayfaya açılmıyor.
    const origin = request.headers.origin;
    if (origin && LOOPBACK_ORIGIN.test(origin) && filePath.endsWith(".trace.json")) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
    response.writeHead(200, headers);
    response.end(readFileSync(filePath));
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    if (args.status) {
      writeFileSync(resolve(args.status), `${JSON.stringify({ pid: process.pid, port, url, siteDirectory }, null, 2)}\n`, "utf8");
    }
  });
}

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 125));
  }
  throw new Error(`The local Trace server could not be started: ${lastError instanceof Error ? lastError.message : "timed out"}`);
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const values = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const opened = spawnSync(command, values, { stdio: "ignore" });
  return !opened.error && opened.status === 0;
}

async function deliver(args) {
  const validation = inspectProject(args, false);
  if (!validation.ok) {
    console.error(JSON.stringify(validation, null, 2));
    process.exitCode = 1;
    return;
  }
  const projectPath = validation.projectPath;
  // Library persistence does not depend on a browser handoff. A successful
  // delivery is immediately visible to every Trace Studio on this machine.
  const libraryPath = persistLibraryProject(validation.project);
  const siteDirectory = resolve(args.out ?? join(dirname(projectPath), "trace-site"));
  mkdirSync(siteDirectory, { recursive: true });

  const templatePath = join(SKILL_DIRECTORY, "assets", "viewer.html");
  if (!existsSync(templatePath)) throw new Error(`The Trace viewer template could not be found: ${templatePath}`);
  const serializedProject = JSON.stringify(validation.project).replaceAll("<", "\\u003c");
  // Şablon bir DERLEME ARTEFAKTIDIR (npm run build:viewer). Burada yalnızca
  // yer tutucular doldurulur; böylece plugin çalışma anında bağımlılıksız kalır.
  // `replace` yerine fonksiyon verilir: proje metni "$&" gibi diziler içerirse
  // string sürümü onları desen referansı sanıp bozar.
  const projectId = validation.project.id || "project";
  const jsonPath = join(siteDirectory, `${projectId}.trace.json`);
  writeFileSync(jsonPath, `${JSON.stringify(validation.project, null, 2)}\n`, "utf8");

  const statusPath = join(siteDirectory, ".trace-server.json");
  // Ana uygulamanın açılışı yavaş; bağımsız site ile paralel yürütülüyor.
  const appPromise = ensureTraceApp(args, siteDirectory);

  const existing = await reuseViewerServer(statusPath, projectId);
  let url = existing?.url;
  let serverPid = existing?.pid;
  if (!existing) {
    const port = await findOpenPort(args.port ? Number(args.port) : 4317);
    const child = spawn(process.execPath, [SCRIPT_PATH, "serve", "--site", siteDirectory, "--port", String(port), "--status", statusPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    url = `http://127.0.0.1:${port}`;
    serverPid = child.pid;
    // Hazır olma denetimi PROJE DOSYASI üzerinden yapılır: `index.html` ancak
    // stüdyo devir teslimi belli olduktan sonra yazılıyor, dolayısıyla kök
    // adres bu noktada henüz 404 döner.
    await waitForServer(`${url}/${encodeURIComponent(projectId)}.trace.json`);
  }

  const jsonUrl = `${url}/${encodeURIComponent(projectId)}.trace.json`;
  const app = await appPromise;
  // The project is already in the shared on-disk Library. The URL only tells
  // Studio which saved project to open; no browser-only import is required.
  const appUrl = app.ok ? `${app.url}/?project=${encodeURIComponent(projectId)}` : undefined;
  if (app.ok && app.started) {
    writeFileSync(join(siteDirectory, ".trace-app.json"), `${JSON.stringify(app, null, 2)}\n`, "utf8");
  }

  // Bağımsız sayfadaki "Open in Studio" köprüsü. Stüdyo ayaktaysa doğrudan
  // adres, değilse onu ayağa kaldıran komut gömülür — kullanıcı hangi durumda
  // olduğunu sayfadan görür, tarayıcı hata ekranından değil.
  // `surface: "local"`: JSON dosyası bu sitenin yanında duruyor, sayfa da
  // kendini yayınlanmış bir bağlantı gibi değil yerel stüdyo gibi adlandırıyor.
  const studio = appUrl
    ? { url: appUrl, surface: "local" }
    : app.command
      ? { command: app.command, directory: app.appRoot, surface: "local" }
      : { surface: "local" };
  const html = readFileSync(templatePath, "utf8")
    .replace("__TRACE_PROJECT_JSON__", () => serializedProject)
    .replace("__TRACE_VIEW_MODE__", () => (args.mode === "story" ? "story" : "lab"))
    .replace("__TRACE_STUDIO_JSON__", () => JSON.stringify(studio).replaceAll("<", "\\u003c"));
  writeFileSync(join(siteDirectory, "index.html"), html, "utf8");

  // Bağımsız site önce, ana uygulama sonra açılır: tarayıcı son sekmeye
  // odaklanır ve kullanıcı zengin yüzeyde başlar.
  const opened = [];
  if (!args["no-open"]) {
    if (openBrowser(url)) opened.push("viewer");
    if (appUrl && openBrowser(appUrl)) opened.push("app");
  }

  console.log(JSON.stringify({
    ok: true,
    title: validation.title,
    url,
    appUrl,
    appStarted: app.ok ? Boolean(app.started) : false,
    appNote: app.ok ? undefined : (app.reason ?? app.skipped),
    opened,
    siteDirectory,
    jsonPath,
    jsonUrl,
    libraryPath,
    sourceProjectPath: projectPath,
    serverPid,
    appPid: app.ok ? app.pid : undefined,
    studioCommand: app.ok ? undefined : app.command,
    note: opened.length > 0
      ? `Opened: ${opened.join(", ")}. The JSON stays in the same folder.`
      : `Could not open a browser. Standalone site: ${url}${appUrl ? ` · Studio: ${appUrl}` : ""}`,
  }, null, 2));
}

/** Teslimat sırasında başlatılan sunucuları kapatır. */
function stopServers(args) {
  if (!args.site) throw new Error("--site <site-directory> is required.");
  const siteDirectory = resolve(args.site);
  const stopped = [];
  for (const [name, file] of [["viewer", ".trace-server.json"], ["app", ".trace-app.json"]]) {
    const statusPath = join(siteDirectory, file);
    if (!existsSync(statusPath)) continue;
    try {
      const status = JSON.parse(readFileSync(statusPath, "utf8"));
      if (isAlive(status.pid)) {
        // Dev sunucusu alt süreçler doğuruyor; `detached` ile açıldığı için
        // süreç grubunun tamamı negatif pid ile kapatılıyor.
        try { process.kill(-status.pid, "SIGTERM"); } catch { process.kill(status.pid, "SIGTERM"); }
        stopped.push({ name, pid: status.pid, url: status.url });
      }
    } catch {
      // bozuk durum dosyası: atla
    }
  }
  console.log(JSON.stringify({ ok: true, stopped }, null, 2));
}

/**
 * Kütüphanenin model karnesi; stüdyodaki "Model record" ekranıyla aynı kod
 * (paketlenmiş doğrulayıcı). Okunamayan dosyalar sayılıyor, atlanmıyor.
 */
function printModelRecord() {
  const library = traceLibraryDirectory();
  const inputs = [];
  const fileById = new Map();
  let unreadableFiles = 0;
  let entries = [];
  try {
    entries = readdirSync(library, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".trace.json")) continue;
    try {
      const project = JSON.parse(readFileSync(join(library, entry.name), "utf8"));
      inputs.push(project);
      if (typeof project?.id === "string") fileById.set(project.id, join(library, entry.name));
    } catch {
      unreadableFiles += 1;
    }
  }
  const record = libraryModelRecord(inputs);
  // Dışarıda kalan projeyi düzeltmek için (ör. verify) hangi dosya olduğu gerekiyor.
  const notCounted = record.notCounted.map((item) => ({ ...item, file: fileById.get(item.projectId) }));
  console.log(JSON.stringify({
    ok: true,
    library,
    ...record,
    projects: record.projects + unreadableFiles,
    unreadable: record.unreadable + unreadableFiles,
    notCounted,
    note: "A quote that is not found on its page is not always invented: tables, equations and scanned pages do not survive text extraction. Models are sorted by likelyLow, the low end of a 95% Wilson interval, so a model checked on a few quotes does not outrank one checked on many. samePaper is the fairest comparison: the same PDF read by different models.",
  }, null, 2));
}

/** Kütüphanedeki projeler (okunamayanlar sayılıyor) ve kütüphanenin çalışma kayıtları. */
function readLibrary() {
  const library = traceLibraryDirectory();
  const projects = [];
  const files = new Map();
  let unreadable = 0;
  let entries = [];
  try {
    entries = readdirSync(library, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".trace.json")) continue;
    const outcome = (() => {
      try {
        return validateProjectObject(JSON.parse(readFileSync(join(library, entry.name), "utf8")));
      } catch {
        return { ok: false };
      }
    })();
    if (!outcome.ok) {
      unreadable += 1;
      continue;
    }
    projects.push(outcome.project);
    files.set(outcome.project.id, join(library, entry.name));
  }
  let study = new Map();
  try {
    study = parseStudyFile(JSON.parse(readFileSync(join(library, "study.json"), "utf8")));
  } catch {
    // Çalışma kaydı yoksa ya da okunamıyorsa hiçbir kavram "çalışılmış" sayılmıyor.
  }
  let aliasFile = parseAliasFile(undefined);
  try {
    aliasFile = parseAliasFile(JSON.parse(readFileSync(join(library, "aliases.json"), "utf8")));
  } catch {
    // Eş kaydı yoksa kavramlar yalnızca ada göre eşleşiyor.
  }
  return { library, projects, files, unreadable, study, aliasFile, aliases: aliasMap(aliasFile) };
}

/**
 * Okuyucunun kavram eşi kararı (`concept-aliases.ts`): stüdyonun
 * `aliases.json`'ına, aynı kilit ve bozuk dosyayı kenara alma kuralıyla. Ajan
 * bunu YALNIZCA okuyucu açıkça onayladıktan sonra çağırıyor.
 */
function recordAlias(args) {
  if (!args.a || !args.b) throw new Error("alias needs --a \"<name>\" and --b \"<name>\".");
  const decision = args.forget ? "forget" : args.different ? "different" : "same";
  const { library, projects } = readLibrary();
  const known = new Set(projects.flatMap((project) => [...(project.primer?.concepts ?? []).map((concept) => concept.term), ...project.evidence.glossary.map((item) => item.term)]).flatMap(conceptKeys));
  if (decision !== "forget" && ![args.a, args.b].every((term) => conceptKeys(term).some((key) => known.has(key)))) {
    throw new Error("Both names must be concepts (primer or glossary) of a paper in the Trace library. Run concepts --names to see them.");
  }
  const proposedBy = args["proposed-by"] === "model" ? "model" : "reader";
  const release = acquireDirectoryLock(library, "aliases.lock", "The concept links are busy. Please retry in a moment.");
  try {
    const path = join(library, "aliases.json");
    let raw;
    let exists = true;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") exists = false;
      else if (!(error instanceof SyntaxError)) throw error;
    }
    const current = parseAliasFile(raw);
    const next = decision === "forget"
      ? forgetAlias(current, args.a, args.b)
      : decideAlias(current, args.a, args.b, decision, proposedBy, new Date().toISOString(), typeof args.reason === "string" ? args.reason : undefined);
    if (exists && !isAliasFile(raw)) renameSync(path, join(library, `aliases.damaged-${new Date().toISOString().replace(/[-:.]/g, "")}.json`));
    atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`);
    console.log(JSON.stringify({
      ok: true,
      decision,
      terms: [args.a, args.b],
      linked: next.decisions.filter((item) => item.decision === "same").map((item) => item.terms),
      note: decision === "same" ? "The two names now count as one concept in the concept links, the concept map and the reading order." : decision === "different" ? "The pair will not be proposed again." : "The decision was removed.",
    }, null, 2));
  } finally {
    release();
  }
}

/**
 * Kaynakça listesi dosyadan: JSON dizi (başlık dizgeleri ya da { title, year,
 * identifier, abstract } nesneleri, ya da { references: [...] }) veya her
 * satırda bir başlık. Ajan kaynakçayı makalenin metninden okuyabiliyor; ağ gerekmiyor.
 */
function readReferenceList(path) {
  if (!existsSync(path)) throw new Error(`reference list not found: ${path}`);
  const text = readFileSync(path, "utf8");
  let items;
  try {
    const parsed = JSON.parse(text);
    items = Array.isArray(parsed) ? parsed : parsed?.references;
  } catch {
    items = text.split(/\r?\n/);
  }
  if (!Array.isArray(items)) {
    throw new Error("--references must be a JSON array of titles or { title, year } objects, or a text file with one title per line.");
  }
  return items
    .map((item) => (typeof item === "string" ? { title: item } : item))
    .filter((item) => item && typeof item.title === "string" && item.title.trim())
    .map((item) => {
      const year = Number.parseInt(item.year, 10);
      return {
        title: item.title.trim(),
        ...(Number.isFinite(year) ? { year } : {}),
        ...(typeof item.identifier === "string" && item.identifier.trim() ? { identifier: item.identifier.trim() } : {}),
        ...(typeof item.url === "string" && item.url.trim() ? { url: item.url.trim() } : {}),
        ...(Number.isFinite(item.citationCount) ? { citationCount: item.citationCount } : {}),
        ...(typeof item.abstract === "string" && item.abstract.trim() ? { abstract: item.abstract.trim() } : {}),
      };
    });
}

/**
 * Henüz çalışılmamış kavramlar için makalenin kaynaklarından öneri: stüdyonun
 * "Look in the references" düğmesiyle aynı eşleşme. Kaynaklar OpenAlex'ten
 * (`--suggest`) ya da ajanın verdiği listeden (`--references`). Grafik bir
 * bonus: OpenAlex'e ulaşılamazsa kavram bağları yine yazılıyor.
 */
async function conceptSuggestions(args, project, links, projects, files) {
  let references;
  let source;
  if (args.references) {
    references = readReferenceList(resolve(args.references));
    source = "file";
  } else {
    const { fetchCitationGraph } = await import("./lib/citation-graph.mjs");
    const { paper } = project.evidence;
    const graph = await fetchCitationGraph({ doi: paper.doi, title: paper.title, authors: paper.authors }, { limit: 50, abstracts: true });
    if (!graph.ok) {
      return { ok: false, reason: graph.skipped ? `OpenAlex has no certain record of this paper (${graph.skipped}).` : graph.error ?? "The references could not be loaded." };
    }
    references = graph.references;
    source = "OpenAlex";
  }
  const others = projects.filter((item) => item.id !== project.id);
  return {
    ok: true,
    source,
    references: references.length,
    items: suggestReferences(links, references).map((item) => {
      const owned = libraryPaperFor(item.reference, others);
      return {
        conceptId: item.conceptId,
        term: item.term,
        phrase: item.phrase,
        where: item.where,
        ...(item.excerpt ? { excerpt: item.excerpt } : {}),
        title: item.reference.title,
        year: item.reference.year ?? null,
        citationCount: item.reference.citationCount ?? null,
        identifier: item.reference.identifier ?? null,
        inLibrary: owned ? { paper: owned.evidence.paper.title, projectId: owned.id, file: files.get(owned.id) } : null,
      };
    }),
    note: "Cited works whose title (where: title) or abstract (where: abstract, with the sentence as excerpt) names a concept the reader has not studied in any paper: a match on the words, not a judgement of the work. Abstracts come from OpenAlex and are occasionally attached to the wrong work, so quote the excerpt when you mention an abstract match. A work that is inLibrary is already analysed: point the reader to it instead of analysing it again. Otherwise prepare --source <identifier> analyses it.",
  };
}

/**
 * Makaleler arası kavram bağları. `--project` ile o projenin ön bilgi
 * kavramlarının kütüphanedeki karşılıkları ve okuyucunun onları nerede
 * çalıştığı; onsuz kütüphanenin kavram haritası. Kütüphaneyi yalnızca okur;
 * model yok. Ağa yalnızca `--suggest` gidiyor.
 */
async function printConcepts(args) {
  if ((args.suggest || args.references) && !args.project) throw new Error("--suggest and --references need --project <project.trace.json>.");
  const { library, projects, files, unreadable, study, aliasFile, aliases } = readLibrary();
  const paper = (source) => ({ paper: source.paperTitle, projectId: source.projectId, file: files.get(source.projectId), kind: source.kind, studied: Boolean(source.knowledge?.studied) });
  const libraryPaper = (project) => ({ paper: project.evidence.paper.title, projectId: project.id, file: files.get(project.id), year: project.evidence.paper.year });
  if (args.project) {
    const outcome = validateProjectObject(readJsonFile(resolve(args.project), "project"));
    if (!outcome.ok) {
      console.error(JSON.stringify({ ok: false, issueCount: outcome.issues.length, issues: outcome.issues }, null, 2));
      process.exitCode = 1;
      return;
    }
    const links = conceptLinks(outcome.project, projects, study, aliases);
    const suggestions = args.suggest || args.references ? await conceptSuggestions(args, outcome.project, links, projects, files) : undefined;
    console.log(JSON.stringify({
      ok: true,
      library,
      papers: new Set(projects.map(paperKey)).size,
      projects: projects.length,
      unreadable,
      project: outcome.project.evidence.paper.title,
      summary: {
        concepts: links.length,
        studiedHere: links.filter((link) => link.here?.studied).length,
        studiedElsewhere: links.filter((link) => !link.here?.studied && link.studiedIn).length,
        inOtherPapersNotStudied: links.filter((link) => !link.here?.studied && !link.studiedIn && link.elsewhere.length).length,
        onlyHere: links.filter((link) => !link.elsewhere.length).length,
      },
      concepts: links.map((link) => ({
        conceptId: link.conceptId,
        term: link.term,
        studiedHere: Boolean(link.here?.studied),
        studiedIn: link.studiedIn ? paper(link.studiedIn) : null,
        alsoIn: link.elsewhere.map(paper),
      })),
      readFirst: readFirst(outcome.project, projects, study, aliases).map((item) => ({
        ...libraryPaper(item.project),
        status: item.status,
        defines: item.concepts,
      })),
      ...(suggestions ? { suggestions } : {}),
      note: "Concepts are matched by name across the library, never by meaning. Tell the reader which of this paper's concepts they already studied in other papers, and where, and which are new to them. readFirst lists library papers that define (in their glossary) concepts this paper assumes: suggest the ones not studied yet before this one. This is about the reader, not the paper: do not write it into the project.",
    }, null, 2));
    return;
  }
  if (args.names) {
    // Büyük bir kütüphanenin adları stüdyodaki gibi parçalara bölünüyor; tanımları benzeyen adlar aynı parçada.
    const names = conceptNames(projects, aliasFile);
    const parts = aliasBatches(names);
    const part = args.part === undefined ? 1 : Number(args.part);
    if (!Number.isInteger(part) || part < 1 || part > Math.max(1, parts.length)) {
      throw new Error(`--part must be a whole number from 1 to ${Math.max(1, parts.length)}.`);
    }
    console.log(JSON.stringify({
      ok: true,
      library,
      totalNames: names.length,
      part,
      parts: parts.length,
      names: (parts[part - 1] ?? []).map((name) => ({ term: name.term, paper: name.paper, kind: name.kind, papers: name.papers, definition: name.definition })),
      decided: aliasFile.decisions,
      note: `Concept names across the library, one per concept, with their paper's definition${parts.length > 1 ? `: part ${part} of ${parts.length}, names with similar definitions grouped in the same part. Look for pairs within this part, then run concepts --names --part ${part < parts.length ? part + 1 : 1}` : ""}. If two different names clearly mean the same concept, ASK the reader; only after they confirm, record it with alias --a <name> --b <name> --proposed-by model. Never link on your own, and skip pairs already in decided.`,
    }, null, 2));
    return;
  }
  const shared = sharedConcepts(projects, study, aliases);
  const order = readingOrder(projects, study, aliases);
  console.log(JSON.stringify({
    ok: true,
    library,
    papers: new Set(projects.map(paperKey)).size,
    projects: projects.length,
    unreadable,
    shared: shared.map((concept) => ({ term: concept.term, papers: concept.sources.map(paper), studied: concept.studied })),
    readingOrder: {
      steps: order.steps.map((step) => ({
        ...libraryPaper(step.project),
        status: step.status,
        after: step.after.map((item) => ({ paper: item.project.evidence.paper.title, projectId: item.project.id, concepts: item.concepts })),
        together: step.together.map((item) => ({ paper: item.project.evidence.paper.title, projectId: item.project.id })),
      })),
      next: order.next ? libraryPaper(order.next) : null,
      unconnected: order.unconnected,
    },
    note: "Concepts that more than one paper in the library explains, from primers and glossaries, matched by name. studied: the reader studied it in that paper. readingOrder puts each paper after the papers that define (in their glossary) a concept it assumes (in its primer), older first where nothing decides; next is the first paper the reader has not finished studying.",
  }, null, 2));
}

/**
 * Öğrenme istatistikleri (`learning-stats.ts`): stüdyonun "Progress" ekranı
 * ile aynı sayımlar, kütüphanenin çalışma kaydından.
 */
function printProgress() {
  const { library, projects, files, unreadable, study } = readLibrary();
  const stats = learningStats(projects, study, new Date().toISOString());
  console.log(JSON.stringify({
    ok: true,
    library,
    unreadable,
    totals: stats.totals,
    cardsByNextReview: stats.boxes.map((cards, box) => ({ inDays: REVIEW_INTERVALS_DAYS[box], cards })),
    // Günler bu makinenin saatine göre; "bugün" okuyucunun takvimindeki gün.
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    week: stats.week.map(({ day, due }) => ({ day, due })),
    hardest: stats.hardest.map((card) => ({
      kind: card.kind,
      text: cardText(card),
      paper: card.paperTitle,
      projectId: card.projectId,
      forgotten: card.review.lapses,
      reviews: card.review.reviews,
    })),
    explanationGain: stats.explanationGain,
    papers: stats.papers.map((paper) => ({
      paper: paper.project.evidence.paper.title,
      projectId: paper.project.id,
      file: files.get(paper.project.id),
      status: paper.status,
      steps: paper.steps,
      checks: paper.checks,
      cards: paper.cards,
      recalls: paper.recalls,
      explanations: paper.explanations,
      lastStudied: paper.lastStudied,
    })),
    note: "Counts from the reader's study progress, nothing estimated. Give shares with their counts (\"4 of 6 reviews remembered\"); a percentage from a handful of reviews says little. For the cards forgotten most, suggest rereading where they come from before another review.",
  }, null, 2));
}

/**
 * Çalışma saati (`work-log.ts`): stüdyonun profilindeki süreler. Günler bu
 * makinenin saatine göre; oturumların birleşimi, iki sayacın aynı anda saydığı
 * süre bir kez.
 */
function printWork(args) {
  const days = args.days === undefined ? 7 : Number(args.days);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("--days must be a whole number from 1 to 366.");
  const dataDirectory = traceDataDirectory();
  const readJson = (name) => {
    try {
      return JSON.parse(readFileSync(join(dataDirectory, name), "utf8"));
    } catch {
      return undefined;
    }
  };
  const now = new Date();
  const profile = parseProfile(readJson("profile.json"), now.toISOString());
  const log = parseWorkLog(readJson("focus-log.json"));
  const { projects, files } = readLibrary();
  const byId = new Map(projects.map((project) => [project.id, project]));
  const { weekStart, dailyGoalMinutes } = profile.preferences;
  // --ics: oturumları takvim dosyasına yazıyor (--days verildiyse yalnızca o günler).
  if (args.ics) {
    const from = args.days === undefined ? 0 : addDaysLocal(now, 1 - days).setHours(0, 0, 0, 0);
    const sessions = log.sessions.filter((session) => Date.parse(session.end) > from);
    const out = resolve(String(args.ics));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, sessionsIcs(sessions, { paperTitle: (id) => byId.get(id)?.evidence.paper.title, now }));
    console.log(JSON.stringify({ ok: true, written: out, sessions: sessions.length, ...(args.days === undefined ? {} : { days }), note: "A calendar file (.ics) of the reader's work sessions, one event each, with the paper and the round's note. Google Calendar, Apple Calendar and Outlook import it; importing it again does not duplicate events." }, null, 2));
    return;
  }
  const totals = dailyTotals(log);
  const summary = workSummary(totals, now, { weekStart, goalMinutes: dailyGoalMinutes });
  const time = (seconds) => ({ seconds, time: formatDuration(seconds) });
  const papers = (range) =>
    [...timeByProject(log.sessions, range)].map(([projectId, seconds]) => ({
      paper: projectId ? byId.get(projectId)?.evidence.paper.title ?? "A paper no longer in the library" : "Other work (no paper named)",
      projectId: projectId || null,
      ...(projectId && files.get(projectId) ? { file: files.get(projectId) } : {}),
      ...time(seconds),
    }));
  const weekFrom = startOfWeek(now, weekStart);
  const report = weekReport(log.sessions, totals, now, weekStart);
  const tomorrow = addDaysLocal(now, 1).getTime();
  const pattern = hourPattern(log.sessions, { from: addDaysLocal(now, 1 - PATTERN_WEEKS * 7).getTime(), to: tomorrow, weekStart });
  const hour = (value) => `${String(value).padStart(2, "0")}:00`;
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat("en", { weekday: "long" }).format(addDaysLocal(weekFrom, index)));
  console.log(JSON.stringify({
    ok: true,
    dataDirectory,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reader: displayName(profile) || null,
    dailyGoal: time(dailyGoalMinutes * 60),
    today: time(summary.today),
    thisWeek: { ...time(summary.week), weekStartsOn: weekStart === 1 ? "Monday" : "Sunday", goalMetOnDays: summary.goalDaysThisWeek },
    thisMonth: time(summary.month),
    allTime: { ...time(summary.total), daysWorked: summary.activeDays, dailyAverage: time(summary.average) },
    streak: { current: summary.currentStreak, longest: summary.longestStreak },
    bestDay: summary.best ? { day: summary.best.day, ...time(summary.best.seconds) } : null,
    days: Array.from({ length: days }, (_, index) => {
      const day = dayKey(addDaysLocal(now, index - days + 1));
      return { day, ...time(totals.get(day) ?? 0) };
    }),
    againstLastWeek: {
      lastWeek: time(report.lastWeek.seconds),
      lastWeekByThisTime: time(report.lastWeek.byNow),
      change: { ...time(Math.abs(report.change)), direction: Math.abs(report.change) < 60 ? "same" : report.change > 0 ? "more" : "less" },
      days: report.thisWeek.days.map((day, index) => ({ day: day.day, thisWeek: time(day.seconds), lastWeek: time(report.lastWeek.days[index].seconds) })),
    },
    hoursOfDay: {
      weeks: PATTERN_WEEKS,
      busiestHours: pattern.peak ? { from: hour(pattern.peak.from), to: hour(pattern.peak.to), share: Math.round(pattern.peak.share * 100) / 100 } : null,
      busiestDay: pattern.total ? weekdays[pattern.byDay.indexOf(Math.max(...pattern.byDay))] : null,
      byHour: pattern.byHour.map((seconds, index) => ({ hour: hour(index), minutes: Math.round(seconds / 60) })).filter((item) => item.minutes > 0),
    },
    papers: {
      thisWeek: papers({ from: weekFrom.getTime(), to: addDaysLocal(weekFrom, 7).getTime() }),
      lastWeek: papers({ from: addDaysLocal(weekFrom, -7).getTime(), to: weekFrom.getTime() }),
      allTime: papers({}),
    },
    latestSessions: log.sessions.slice(-10).reverse().map((session) => ({
      kind: session.kind,
      label: session.label ?? null,
      paper: session.projectId ? byId.get(session.projectId)?.evidence.paper.title ?? null : null,
      start: session.start,
      end: session.end,
      minutes: Math.round((Date.parse(session.end) - Date.parse(session.start)) / 60_000),
      note: session.note ?? null,
    })),
    note: log.sessions.length || Object.keys(log.archive).length
      ? "Worked time from the studio's Focus timer, counted once where timers overlapped. Give times as written (\"2h 15m\"), compare with the daily goal, and name the papers the time went to. The reader's own record: do not write it into any project."
      : "No work recorded yet. The studio's Focus timer (the Focus button in its header) records focus rounds, and the countdown and stopwatch if the reader counts them as work.",
  }, null, 2));
}

/** Günün özeti (`today.ts`): kartlar, yarım kalanlar, sıradaki okuma, çalışma süresi. */
function printToday() {
  const { library, projects, study, aliases } = readLibrary();
  const readJson = (path) => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return undefined;
    }
  };
  const now = new Date();
  const profile = parseProfile(readJson(join(traceDataDirectory(), "profile.json")), now.toISOString());
  const log = parseWorkLog(readJson(join(traceDataDirectory(), "focus-log.json")));
  const readingList = parseReadingList(readJson(join(library, "reading-list.json")));
  const brief = todayBrief({ projects, study, readingList, aliases, log, goalMinutes: profile.preferences.dailyGoalMinutes, weeklyGoals: profile.preferences.weeklyGoals, weekStart: profile.preferences.weekStart, now });
  const time = (seconds) => ({ seconds, time: formatDuration(seconds) });
  console.log(JSON.stringify({
    ok: true,
    library,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reader: displayName(profile) || null,
    day: brief.day,
    review: brief.review,
    continueStudying: brief.continueStudying,
    readNext: brief.readNext ?? null,
    work: { today: time(brief.work.today), goal: time(brief.work.goal), thisWeek: time(brief.work.week), lastWeekByThisTime: time(brief.work.lastWeekByNow), streak: brief.work.streak },
    learningThisWeek: {
      from: brief.learning.from,
      to: brief.learning.to,
      daysLeft: brief.learning.daysLeft,
      papersFinished: { done: brief.learning.papers.done, goal: brief.learning.papers.goal || null },
      cardsReviewed: { done: brief.learning.cards.done, remembered: brief.learning.cards.remembered, goal: brief.learning.cards.goal || null },
    },
    suggestions: brief.suggestions,
    note: "The reader's day, from their own record in the studio. Give the suggestions in this order, briefly; offer to start with the first. Review cards are answered in the studio (Review) or with the review commands if available. Never write any of this into a project.",
  }, null, 2));
}

/**
 * Sohbette tekrar (`chat-review.ts`): vadesi gelen kartlar yanıtsız
 * listeleniyor; ajan soruyor, okuyucunun yanıtını --answer ile veriyor ve
 * sonuç stüdyonun `study.json`'ına aynı kilitle yazılıyor.
 */
function chatReview(args) {
  const { library, projects, study } = readLibrary();
  const now = new Date().toISOString();
  if (args.show) {
    if (!args.id || !args.card) throw new Error("review --show needs --id <library id> and --card <card id>.");
    const shown = showChatCard(projects, study, args.id, args.card);
    if (!shown.ok) throw new Error(shown.issue);
    console.log(JSON.stringify({ ok: true, card: shown.card, answer: shown.answer, note: "Show this to the reader only after they have tried. For a concept, ask whether they remembered it, then record it with --answer --remembered yes or no." }, null, 2));
    return;
  }
  if (args.answer) {
    if (!args.id || !args.card) throw new Error("review --answer needs --id <library id> and --card <card id>.");
    const yesNo = (value) => {
      if (value === undefined) return undefined;
      if (/^(yes|y|true|1)$/i.test(value)) return true;
      if (/^(no|n|false|0)$/i.test(value)) return false;
      throw new Error("--remembered takes yes or no.");
    };
    const release = acquireDirectoryLock(library, "study.lock", "The study progress is busy. Please retry in a moment.");
    try {
      const path = join(library, "study.json");
      let raw;
      let exists = true;
      try {
        raw = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") exists = false;
        else if (!(error instanceof SyntaxError)) throw error;
      }
      const outcome = answerChatCard(projects, raw, args.id, args.card, { choice: args.choice, typed: args.typed, remembered: yesNo(args.remembered) }, now);
      if (!outcome.ok) throw new Error(outcome.issue);
      if (outcome.recorded) {
        if (exists && !isStudyFile(raw)) renameSync(path, join(library, `study.damaged-${now.replace(/[-:.]/g, "")}.json`));
        atomicWrite(path, `${JSON.stringify(outcome.file, null, 2)}\n`);
      }
      // Yeni kayıt dosyaya yazıldı; çıktıya yalnızca sonuç.
      const result = { ...outcome };
      delete result.file;
      console.log(JSON.stringify({
        ...result,
        note: outcome.recorded
          ? "Recorded in the studio, as if answered in Review. Tell the reader whether it was right, with the answer and its reason, and when the card comes back; then ask the next card."
          : "The word does not match. Show the reader the missing word and ask whether they had it (a typo, a synonym); record their answer with --remembered yes or no.",
      }, null, 2));
    } finally {
      release();
    }
    return;
  }
  const limit = args.limit === undefined ? undefined : Number(args.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) throw new Error("--limit must be a whole number from 1 to 50.");
  const queue = chatReviewQueue(projects, study, now, limit);
  console.log(JSON.stringify({
    ok: true,
    library,
    ...queue,
    note: "Ask the cards one at a time, in this order, without giving the answer. A question: show the options with their letters and pass the reader's letters with --choice (a first answer counts; chooseAll means every correct letter). A highlight: pass the word the reader wrote with --typed. A concept: let the reader explain it, then show the answer with --show and record what they say with --remembered yes or no. Never answer for the reader and never write a result they did not give.",
  }, null, 2));
}

/**
 * Okuma listesi: stüdyoda "Read later" denen çalışmalar, okuma sırasına
 * yerleştirilmiş. --add ve --remove stüdyonun kilidiyle yazıyor.
 */
function readingList(args) {
  const { library, projects, study, aliases } = readLibrary();
  const path = join(library, "reading-list.json");
  const readRaw = () => {
    try {
      return { exists: true, raw: JSON.parse(readFileSync(path, "utf8")) };
    } catch (error) {
      if (error?.code === "ENOENT") return { exists: false, raw: undefined };
      if (error instanceof SyntaxError) return { exists: true, raw: undefined };
      throw error;
    }
  };
  let changed;
  if (args.add || args.remove) {
    const release = acquireDirectoryLock(library, "reading-list.lock", "The reading list is busy. Please retry in a moment.");
    try {
      const file = readRaw();
      let items = parseReadingList(file.raw);
      if (args.remove) {
        if (!items.some((item) => item.id === args.remove)) throw new Error(`No work with the id "${args.remove}" on the reading list.`);
        items = removeFromReadingList(items, args.remove);
        changed = { removed: args.remove };
      } else {
        const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : String(args.add).trim();
        const identifier = String(args.add).trim();
        if (args.for && !projects.some((project) => project.id === args.for)) throw new Error(`No paper with the id "${args.for}" in the library.`);
        const relation = args.relation ?? "reference";
        if (!["reference", "cited-by", "concept"].includes(relation)) throw new Error("--relation must be reference, cited-by or concept.");
        const item = readingItemSchema.parse({
          id: workKey({ title, identifier }),
          title,
          identifier,
          ...(args.year ? { year: Number(args.year) } : {}),
          ...(args.url ? { url: args.url } : {}),
          from: args.for ? [{ projectId: args.for, relation, ...(args.concept ? { concept: args.concept } : {}) }] : [],
          addedAt: new Date().toISOString(),
        });
        items = addToReadingList(items, item);
        changed = { added: item.id };
      }
      if (file.exists && !isReadingListFile(file.raw)) renameSync(path, join(library, `reading-list.damaged-${new Date().toISOString().replace(/[-:.]/g, "")}.json`));
      atomicWrite(path, `${JSON.stringify(readingListToJson(items), null, 2)}\n`);
    } finally {
      release();
    }
  }
  const items = parseReadingList(readRaw().raw);
  const merged = mergeReadingOrder(readingOrder(projects, study, aliases), items, projects);
  const saved = (place, inOrder) => ({
    kind: "saved",
    id: place.item.id,
    title: place.item.title,
    year: place.item.year ?? null,
    identifier: place.item.identifier ?? null,
    url: place.item.url ?? null,
    ...(place.owned ? { inLibrary: place.owned.id } : {}),
    why: place.owned ? "Now in the library." : place.why ? (inOrder ? savedReason(place.why) : savedFrom(place.why)) : place.item.from.length ? "Saved from a paper no longer in the library." : "Saved on its own.",
  });
  console.log(JSON.stringify({
    ok: true,
    library,
    ...(changed ?? {}),
    saved: items.length,
    order: merged.entries.map((entry) => entry.kind === "paper"
      ? { kind: "paper", paper: entry.step.project.evidence.paper.title, projectId: entry.step.project.id, status: entry.step.status }
      : saved(entry.place, true)),
    alsoSaved: merged.others.map((place) => saved(place, false)),
    note: items.length
      ? "The reader's own list. Suggest the next unread item in order; a saved work is analysed with prepare --source <identifier>. Never write the list into a project."
      : "Nothing saved yet. In the studio, Read later in a paper's citation graph or its concept suggestions saves a work; --add does the same from here.",
  }, null, 2));
}

/**
 * Okuyucunun notları: stüdyoda yazılan notlar ve vurgular, Markdown olarak.
 * Proje dosyasına hiç yazılmıyorlar; burada yalnızca okunuyorlar.
 */
function printNotes(args) {
  const { library, projects, files } = readLibrary();
  let project;
  if (args.project) {
    const outcome = validateProjectObject(JSON.parse(readFileSync(resolve(args.project), "utf8")));
    if (!outcome.ok) throw new Error("The project file is not a valid Trace project.");
    project = projects.find((item) => item.id === outcome.project.id) ?? outcome.project;
  } else if (args.id) {
    project = projects.find((item) => item.id === args.id);
    if (!project) throw new Error(`No paper with the id "${args.id}" in the library (${library}).`);
  } else {
    throw new Error("--project <project.trace.json> or --id <library id> is required.");
  }
  let all = new Map();
  try {
    all = parseNotesFile(JSON.parse(readFileSync(join(library, "notes.json"), "utf8")));
  } catch {
    // Not kaydı yoksa ya da okunamıyorsa not yok.
  }
  const notes = all.get(project.id) ?? [];
  const markdown = notesMarkdown(project, notes, { obsidian: Boolean(args.obsidian), exportedAt: new Date().toISOString() });
  const summary = {
    ok: true,
    paper: project.evidence.paper.title,
    projectId: project.id,
    ...(files.get(project.id) ? { file: files.get(project.id) } : {}),
    notes: notes.filter((note) => note.text).length,
    highlights: notes.filter((note) => note.quote).length,
    marked: notes.filter((note) => !note.text && !note.quote).length,
    format: args.obsidian ? "obsidian" : "markdown",
  };
  if (args.out) {
    const target = resolve(args.out.endsWith(".md") ? args.out : join(args.out, notesFileName(project)));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, markdown, "utf8");
    console.log(JSON.stringify({ ...summary, wrote: target }, null, 2));
    return;
  }
  console.log(JSON.stringify({ ...summary, markdown, note: notes.length ? "The reader's own notes, from the studio. Show or save them as they are; never write them into the project." : "No notes on this paper yet. In the studio, select text in the Deep report or the Story preview to highlight it, or open a claim to write a note." }, null, 2));
}

async function main() {
try {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") usage();
  const args = parseArgs(rest);
  if (command === "prepare") await prepare(args);
  else if (command === "validate") validateProject(args);
  else if (command === "deliver") await deliver(args);
  else if (command === "stop") stopServers(args);
  else if (command === "serve") serve(args);
  else if (command === "section") prepareSection(args);
  else if (command === "splice") applySection(args);
  else if (command === "explain") prepareExplanation(args);
  else if (command === "explain-check") checkExplanation(args);
  else if (command === "templates") listTemplates();
  else if (command === "save-template") saveTemplateFromProject(args);
  else if (command === "publish") await publishProjectLink(args);
  else if (command === "graph") await citationGraph(args);
  else if (command === "verify") verifyProject(args);
  else if (command === "anki") exportAnki(args);
  else if (command === "export") exportProject(args);
  else if (command === "record") printModelRecord();
  else if (command === "concepts") await printConcepts(args);
  else if (command === "progress") printProgress();
  else if (command === "work") printWork(args);
  else if (command === "notes") printNotes(args);
  else if (command === "today") printToday();
  else if (command === "review") chatReview(args);
  else if (command === "reading") readingList(args);
  else if (command === "alias") recordAlias(args);
  else usage(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
}

if (resolve(process.argv[1] ?? "") === SCRIPT_PATH) await main();

export { TRACE_ACCENT_PALETTE, assignPaperAccent, persistLibraryProject };
