import type { ResearchProject } from "./schema";

/**
 * Projeyi Anki'nin içe aktardığı sekmeyle ayrılmış metne çevirir.
 *
 * Anki'nin kendi `.apkg` biçimi bir SQLite veritabanı; onu üretmek bir
 * bağımlılık ve bir saldırı yüzeyi demek. Düz metin içe aktarma ise Anki'nin
 * belgelenmiş yolu: baştaki `#` satırları ayırıcıyı, desteyi ve etiket
 * sütununu söylüyor, kullanıcı dosyayı sürükleyip bırakıyor.
 *
 * Her kartın arkasında dayandığı alıntı ve sayfa duruyor: aralıklı tekrar bir
 * cümleyi ezberletir, kaynağı ezberletmez — kart onu her seferinde göstermeli.
 */

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Sekme ve satır sonu alan ayırıcılarıdır; metnin içinde kalamazlar. */
const field = (html: string) => html.replace(/\t/g, " ").replace(/\r?\n/g, "<br>");

const tag = (value: string) => value.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_:-]/gu, "") || "trace";

export type AnkiCard = { front: string; back: string; tags: string[] };

function sourceLine(project: ResearchProject, claimIds: readonly string[]) {
  const claim = project.evidence.claims.find((item) => claimIds.includes(item.id));
  const reference = claim?.sourceRefs[0];
  if (!reference) return "";
  return `<br><br><small>“${escapeHtml(reference.excerpt)}”${reference.page ? ` — p. ${reference.page}` : ""}</small>`;
}

export function ankiCards(project: ResearchProject): AnkiCard[] {
  const cards: AnkiCard[] = [];

  for (const concept of project.primer?.concepts ?? []) {
    cards.push({
      front: `${escapeHtml(concept.term)}<br><small>What is it, and why does this paper need it?</small>`,
      back:
        escapeHtml(concept.intuition) +
        (concept.formal ? `<br><br>\\[${escapeHtml(concept.formal)}\\]` : "") +
        `<br><br><b>Why this paper needs it:</b> ${escapeHtml(concept.whyItMatters)}` +
        sourceLine(project, concept.claimIds),
      tags: ["primer", concept.level],
    });
  }

  for (const question of project.quiz?.questions ?? []) {
    const correct = question.options.filter((option) => option.correct);
    cards.push({
      front: `${escapeHtml(question.prompt)}<ul>${question.options.map((option) => `<li>${escapeHtml(option.label)}</li>`).join("")}</ul>`,
      back:
        correct.map((option) => `<b>${escapeHtml(option.label)}</b><br>${escapeHtml(option.explanation)}`).join("<br><br>") +
        sourceLine(project, question.claimIds),
      tags: ["quiz", question.kind],
    });
  }

  for (const item of project.evidence.glossary) {
    cards.push({
      front: escapeHtml(item.term),
      back:
        escapeHtml(item.definition) +
        (item.sourceRef ? `<br><br><small>“${escapeHtml(item.sourceRef.excerpt)}”${item.sourceRef.page ? ` — p. ${item.sourceRef.page}` : ""}</small>` : ""),
      tags: ["glossary"],
    });
  }
  return cards;
}

export function buildAnkiDeck(project: ResearchProject): string {
  // Anki'de "::" alt deste ayırıcısı; başlıkta geçerse desteyi bölerdi.
  const deck = `Trace::${project.evidence.paper.title.replace(/::/g, " - ").replace(/[\t\r\n]/g, " ").trim()}`;
  const paperTag = tag(project.evidence.paper.title).slice(0, 60);
  const header = ["#separator:tab", "#html:true", "#notetype:Basic", `#deck:${deck}`, "#tags column:3"];
  const rows = ankiCards(project).map((card) =>
    [field(card.front), field(card.back), ["trace", paperTag, ...card.tags].map(tag).join(" ")].join("\t"),
  );
  return `${[...header, ...rows].join("\n")}\n`;
}
