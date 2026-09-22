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

export const exportDefinitions: readonly ExportDefinition[] = [
  { format: "md", label: "Markdown report", description: "For Obsidian, Notion or a repository. Every claim with its quote and page.", extension: "md", mime: "text/markdown", build: buildMarkdownReport },
  { format: "html", label: "Printable report (PDF)", description: "Opens as a page; print it and choose Save as PDF.", extension: "report.html", mime: "text/html", build: buildPrintableReport },
  { format: "slides", label: "Slides", description: "One slide per story section, each with its quote and page. Arrow keys to move.", extension: "slides.html", mime: "text/html", build: buildSlides },
  {
    format: "ipynb",
    label: "Jupyter notebook",
    description: "The paper's equations as runnable NumPy, starting at the paper's own values.",
    extension: "ipynb",
    mime: "application/x-ipynb+json",
    unavailable: (project) => (notebookPlaygrounds(project).length ? undefined : "This project has no formula playground to turn into code."),
    build: buildNotebook,
  },
  { format: "bib", label: "BibTeX", description: "The paper as a citation for LaTeX, Zotero or Mendeley.", extension: "bib", mime: "application/x-bibtex", build: (project) => buildBibtex(project) },
  { format: "ris", label: "RIS", description: "The same citation for Zotero, EndNote and most reference managers.", extension: "ris", mime: "application/x-research-info-systems", build: (project) => buildRis(project) },
  {
    format: "anki",
    label: "Anki flashcards",
    description: "Primer concepts, quiz questions and glossary, each card with its quote and page.",
    extension: "anki.txt",
    mime: "text/plain",
    unavailable: (project) => (project.primer || project.quiz || project.evidence.glossary.length ? undefined : "This project has no primer, quiz or glossary to make cards from."),
    build: buildAnkiDeck,
  },
];

export function findExport(format: string) {
  return exportDefinitions.find((definition) => definition.format === format);
}
