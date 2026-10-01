import { sharedConcepts, type ConceptAliases } from "./concept-links";
import { notesMarkdown, type ReaderNote } from "./reader-notes";
import { mergeReadingOrder, savedReason, type ReadingItem } from "./reading-list";
import { workLink } from "./reading-share";
import { readingOrder, studyStatus } from "./reading-order";
import type { ResearchProject } from "./schema";
import type { StudyProgress } from "./study-path";

/**
 * Bütün kütüphane bir Obsidian kasasına: her makale bir not (özeti, okuma
 * sırasındaki yeri, kavramları ve okuyucunun notları ve vurguları), birden
 * çok makalenin anlattığı her kavram bir not, ve bir dizin. Makaleler
 * kavramlar ve okuma sırası üzerinden `[[bağlantı]]`larla birbirine
 * bağlanıyor; Obsidian'ın grafiği kütüphanenin haritası oluyor.
 *
 * Yalnızca projelerin kaydı ve okuyucunun kendi notları; model yok, ağ yok.
 */

export type VaultFile = { path: string; content: string };

export const VAULT_FOLDER = "Trace";

/** Dosya adı: Obsidian'ın ve dosya sistemlerinin kabul etmediği karakterler atılıyor. */
export function noteName(title: string) {
  const clean = title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean || "Untitled";
}

const link = (title: string) => `[[${noteName(title)}]]`;
const yaml = (value: string) => JSON.stringify(value);
const statusLabel = { new: "not started", started: "in progress", finished: "finished" } as const;

export function libraryVault(input: {
  projects: readonly ResearchProject[];
  notes: ReadonlyMap<string, readonly ReaderNote[]>;
  study: ReadonlyMap<string, StudyProgress>;
  aliases?: ConceptAliases;
  readingList?: readonly ReadingItem[];
  exportedAt: string;
}): VaultFile[] {
  const { projects, study } = input;
  // Aynı başlıklı iki analiz aynı nota düşmesin: ikincisine yıl, sonra sıra ekleniyor.
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const project of projects) {
    let name = noteName(project.evidence.paper.title);
    if (used.has(name.toLowerCase())) name = noteName(`${project.evidence.paper.title} (${project.evidence.paper.year || project.id})`);
    for (let index = 2; used.has(name.toLowerCase()); index += 1) name = noteName(`${project.evidence.paper.title} ${index}`);
    used.add(name.toLowerCase());
    names.set(project.id, name);
  }
  const paperLink = (project: ResearchProject) => `[[${names.get(project.id)}]]`;

  const order = readingOrder(projects, study, input.aliases);
  const position = new Map(order.steps.map((step, index) => [step.project.id, index]));
  const concepts = sharedConcepts(projects, study, input.aliases);
  const conceptsOf = new Map<string, string[]>();
  for (const concept of concepts) {
    for (const source of concept.sources) conceptsOf.set(source.projectId, [...(conceptsOf.get(source.projectId) ?? []), concept.term]);
  }

  const files: VaultFile[] = [];
  for (const project of projects) {
    const { paper } = project.evidence;
    const step = order.steps.find((item) => item.project.id === project.id);
    const index = position.get(project.id);
    const before = index !== undefined ? order.steps[index - 1]?.project : undefined;
    const after = index !== undefined ? order.steps[index + 1]?.project : undefined;
    const status = studyStatus(study.get(project.id));
    const own = input.notes.get(project.id) ?? [];
    const notesBody = own.length ? notesMarkdown(project, own, { obsidian: true, exportedAt: input.exportedAt }).replace(/^---[\s\S]*?---\n+/, "").replace(/^# .*\n+/, "") : "";
    const lines = [
      "---",
      `title: ${yaml(paper.title)}`,
      `authors: [${paper.authors.map(yaml).join(", ")}]`,
      ...(paper.year ? [`year: ${yaml(paper.year)}`] : []),
      ...(paper.venue ? [`venue: ${yaml(paper.venue)}`] : []),
      ...(paper.doi ? [`doi: ${yaml(paper.doi)}`] : []),
      `study: ${yaml(statusLabel[status])}`,
      "tags: [trace, paper]",
      "---",
      "",
      `# ${paper.title}`,
      "",
      `*${[paper.authors.slice(0, 6).join(", ") + (paper.authors.length > 6 ? " et al." : ""), paper.venue, paper.year].filter(Boolean).join(" · ")}*`,
      "",
      `> ${project.evidence.thesis}`,
      "",
      project.evidence.plainSummary,
      "",
    ];
    if (index !== undefined) {
      lines.push("## In the reading order", "", `Step ${index + 1} of ${order.steps.length}.${before ? ` After ${paperLink(before)}.` : ""}${after ? ` Before ${paperLink(after)}.` : ""}`, "");
      for (const item of step?.after ?? []) lines.push(`- Assumes ${item.concepts.map((concept) => concept.term).join(", ")}, defined in ${paperLink(item.project)}.`);
      if (step?.after.length) lines.push("");
    }
    const shared = conceptsOf.get(project.id) ?? [];
    if (shared.length) lines.push("## Concepts shared with other papers", "", shared.map((term) => link(term)).join(" · "), "");
    if (project.primer?.concepts.length) lines.push("## Concepts it explains", "", project.primer.concepts.map((concept) => `- **${concept.term}**: ${concept.intuition}`).join("\n"), "");
    lines.push("## Findings", "", project.evidence.findings.map((finding) => `- ${finding}`).join("\n"), "");
    if (notesBody) lines.push("## Your notes and highlights", "", notesBody.trim(), "");
    files.push({ path: `${VAULT_FOLDER}/Papers/${names.get(project.id)}.md`, content: `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n` });
  }

  for (const concept of concepts) {
    const lines = [
      "---",
      `concept: ${yaml(concept.term)}`,
      "tags: [trace, concept]",
      "---",
      "",
      `# ${concept.term}`,
      "",
      `Explained in ${concept.papers} papers of your library.`,
      "",
      ...concept.sources.map((source) => {
        const project = projects.find((item) => item.id === source.projectId);
        return `- ${project ? paperLink(project) : source.paperTitle}${source.term !== concept.term ? ` (as “${source.term}”)` : ""}: ${source.definition}`;
      }),
    ];
    files.push({ path: `${VAULT_FOLDER}/Concepts/${noteName(concept.term)}.md`, content: `${lines.join("\n")}\n` });
  }

  const merged = mergeReadingOrder(order, input.readingList ?? [], [...projects]);
  const index = [
    "---",
    "tags: [trace]",
    `exported: ${input.exportedAt.slice(0, 10)}`,
    "---",
    "",
    "# Trace library",
    "",
    `${projects.length} ${projects.length === 1 ? "paper" : "papers"} and ${concepts.length} shared ${concepts.length === 1 ? "concept" : "concepts"}, exported from Trace.`,
    "",
  ];
  if (merged.entries.length) {
    index.push("## Reading order", "");
    let step = 0;
    for (const entry of merged.entries) {
      if (entry.kind === "paper") {
        step += 1;
        index.push(`${step}. ${paperLink(entry.step.project)} (${statusLabel[entry.step.status]})`);
      } else {
        const href = workLink(entry.place.item);
        index.push(`   - To read: ${href ? `[${entry.place.item.title}](${href})` : entry.place.item.title}${entry.place.why ? `. ${savedReason(entry.place.why)}` : ""}`);
      }
    }
    index.push("");
  }
  const unordered = projects.filter((project) => !position.has(project.id));
  if (unordered.length) index.push(order.steps.length ? "## Other papers" : "## Papers", "", ...unordered.map((project) => `- ${paperLink(project)}`), "");
  const saved = merged.others.filter((place) => !place.owned);
  if (saved.length) {
    index.push("## Also on the reading list", "", ...saved.map((place) => {
      const href = workLink(place.item);
      return `- ${href ? `[${place.item.title}](${href})` : place.item.title}`;
    }), "");
  }
  if (concepts.length) index.push("## Shared concepts", "", concepts.map((concept) => link(concept.term)).join(" · "), "");
  files.push({ path: `${VAULT_FOLDER}/Trace library.md`, content: `${index.join("\n").trim()}\n` });
  return files;
}
