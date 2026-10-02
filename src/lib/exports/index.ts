import { buildAnkiDeck } from "../anki-export";
import type { ResearchProject } from "../schema";
import { buildBibtex, buildRis } from "./bibliography";
import { buildMarkdownReport } from "./markdown";
import { buildNotebook, notebookPlaygrounds } from "./notebook";
import { buildPrintableReport } from "./print-html";
import { buildSlides } from "./slides";

/**
 * Bütün dışa aktarma biçimleri tek tabloda. Stüdyodaki menü ve köprünün
 * `export` komutu aynı tabloyu okuyor; yeni bir biçim iki yerde birden belirir
 * ve ikisi asla farklı bir dosya üretmez. Hepsi saf: ağ yok, model yok.
 */
export type ExportFormat = "md" | "html" | "slides" | "ipynb" | "bib" | "ris" | "anki";

export type ExportDefinition = {
  format: ExportFormat;
  label: string;
  description: string;
  extension: string;
  mime: string;
  /** Bu projede üretilecek bir şey yoksa neden; menü seçeneği kapatır, köprü hatayı söyler. */
  unavailable?: (project: ResearchProject) => string | undefined;
  build: (project: ResearchProject) => string;
};

/**
 * Menüde görünen ad, açıklama ve "bu projede yok" nedeni. Varsayılan
 * İngilizce; stüdyo arayüzün dilindekini veriyor (`exportMenuText`). Köprünün
 * `export` komutu tablodaki İngilizce `label` ve `unavailable` metnini
 * kullanmaya devam ediyor.
 */
export type ExportMenuWords = Record<ExportFormat, { label: string; description: string; unavailable?: string }>;

export const EXPORT_MENU_WORDS: ExportMenuWords = {
  md: { label: "Markdown report", description: "For Obsidian, Notion or a repository. Every claim with its quote and page." },
  html: { label: "Printable report (PDF)", description: "Opens as a page; print it and choose Save as PDF." },
  slides: { label: "Slides", description: "One slide per story section, each with its quote and page. Arrow keys to move." },
  ipynb: {
    label: "Jupyter notebook",
    description: "The paper's equations as runnable NumPy, starting at the paper's own values.",
    unavailable: "This project has no formula playground to turn into code.",
  },
  bib: { label: "BibTeX", description: "The paper as a citation for LaTeX, Zotero or Mendeley." },
  ris: { label: "RIS", description: "The same citation for Zotero, EndNote and most reference managers." },
  anki: {
    label: "Anki flashcards",
    description: "Primer concepts, quiz questions and glossary, each card with its quote and page.",
    unavailable: "This project has no primer, quiz or glossary to make cards from.",
  },
};

const words = EXPORT_MENU_WORDS;

export const exportDefinitions: readonly ExportDefinition[] = [
  { format: "md", label: words.md.label, description: words.md.description, extension: "md", mime: "text/markdown", build: buildMarkdownReport },
  { format: "html", label: words.html.label, description: words.html.description, extension: "report.html", mime: "text/html", build: buildPrintableReport },
  { format: "slides", label: words.slides.label, description: words.slides.description, extension: "slides.html", mime: "text/html", build: buildSlides },
  {
    format: "ipynb",
    label: words.ipynb.label,
    description: words.ipynb.description,
    extension: "ipynb",
    mime: "application/x-ipynb+json",
    unavailable: (project) => (notebookPlaygrounds(project).length ? undefined : words.ipynb.unavailable),
    build: buildNotebook,
  },
  { format: "bib", label: words.bib.label, description: words.bib.description, extension: "bib", mime: "application/x-bibtex", build: (project) => buildBibtex(project) },
  { format: "ris", label: words.ris.label, description: words.ris.description, extension: "ris", mime: "application/x-research-info-systems", build: (project) => buildRis(project) },
  {
    format: "anki",
    label: words.anki.label,
    description: words.anki.description,
    extension: "anki.txt",
    mime: "text/plain",
    unavailable: (project) => (project.primer || project.quiz || project.evidence.glossary.length ? undefined : words.anki.unavailable),
    build: buildAnkiDeck,
  },
];

/**
 * Menüdeki satırın metni, verilen dilde: ad, açıklama ve seçenek kapalıysa
 * nedeni (`unavailable`). Biçimin kendisi (dosya, uzantı) değişmiyor.
 */
export function exportMenuText(definition: ExportDefinition, project: ResearchProject, menuWords: ExportMenuWords = EXPORT_MENU_WORDS) {
  const text = menuWords[definition.format];
  const reason = definition.unavailable?.(project);
  return { label: text.label, description: text.description, unavailable: reason === undefined ? undefined : (text.unavailable ?? reason) };
}

export function findExport(format: string) {
  return exportDefinitions.find((definition) => definition.format === format);
}
