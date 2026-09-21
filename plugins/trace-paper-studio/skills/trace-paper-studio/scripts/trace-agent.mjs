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
  buildSectionBrief,
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
  findBuiltInTemplate,
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

function acquireAccentLock(dataDirectory) {
  const lockPath = join(dataDirectory, "accent-cycle.lock");
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
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
  throw new Error("The Trace accent cycle is busy. Please retry in a moment.");
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
  node trace-agent.mjs anki --project <project.trace.json> [--out <deck.anki.txt>]
  node trace-agent.mjs validate --project <project.trace.json> [--strict]
  node trace-agent.mjs deliver --project <project.trace.json> [--out <site-directory>] [--mode lab|story]
                              [--no-open] [--no-app] [--install-app] [--app <trace-repo>] [--app-url <http://...>]
  node trace-agent.mjs stop --site <site-directory>
  node trace-agent.mjs section --project <project.trace.json> --target <kind>:<id>
                              [--claims locked|open] [--goal revise|strengthen] [--instruction "<what should change>"]
  node trace-agent.mjs splice --brief <revisions/…brief.json> [--section <section.json>]
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
  anki      Writes an Anki import file: primer concepts, quiz questions and
            glossary terms, each card carrying its quote and page.
  graph     Prints the paper's citation graph from OpenAlex: the most-cited
            works it builds on and the most-cited works that cite it. Every
            node carries an "identifier" that prepare --source accepts.
  --template
            prepare only. A narrative template id (see "templates") or a path
            to a template JSON. It fixes the story's sections, their visuals
            and the report order; job.json carries the instructions.
  --strict  Treats the learning blocks (primer, derivations, quiz,
            interactives, application guide) as REQUIRED for the chosen depth.

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
    if (["no-open", "no-app", "install-app", "strict", "no-report", "no-appendix", "no-learning", "no-figures"].includes(key)) {
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
  else if (command === "templates") listTemplates();
  else if (command === "save-template") saveTemplateFromProject(args);
  else if (command === "publish") await publishProjectLink(args);
  else if (command === "graph") await citationGraph(args);
  else if (command === "verify") verifyProject(args);
  else if (command === "anki") exportAnki(args);
  else usage(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
}

if (resolve(process.argv[1] ?? "") === SCRIPT_PATH) await main();

export { TRACE_ACCENT_PALETTE, assignPaperAccent, persistLibraryProject };
