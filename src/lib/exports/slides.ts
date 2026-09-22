import type { Claim, ResearchProject } from "../schema";
import { escapeHtml } from "./print-html";
import { citeLabel } from "./report-document";

/**
 * Makale kulübü için slayt destesi — tek dosya, betiği yalnızca gezinme.
 *
 * Slaytlar hikâyenin bölümlerinden çıkıyor ve her biri dayandığı alıntıyı
 * sayfasıyla birlikte taşıyor: bir sunumda "bunu nereden biliyoruz?" sorusunun
 * cevabı slaydın üstünde olmalı. Proje metni kaçırılarak yazılıyor; gömülü
 * betik sabit ve proje verisi içermiyor.
 */

function evidenceFor(project: ResearchProject, claimIds: readonly string[], limit = 2) {
  return claimIds
    .map((id) => project.evidence.claims.find((claim) => claim.id === id))
    .filter((claim): claim is Claim => Boolean(claim))
    .slice(0, limit)
    .map((claim) => `<blockquote>“${escapeHtml(claim.sourceRefs[0].excerpt)}” <cite>${escapeHtml(citeLabel(project, claim.sourceRefs[0]))}${claim.confidence === "verified" ? "" : " · needs review"}</cite></blockquote>`)
    .join("");
}

/**
 * Slayt bir paragrafı taşımaz. Bölüm gövdesinin ilk iki cümlesi slaytta,
 * tamamı "n" tuşuyla açılan konuşmacı notunda duruyor — hiçbir şey atılmıyor,
 * yalnızca sunulurken okunacak kadarı öne çıkıyor.
 */
export function slideLead(body: string) {
  // Yalnızca "nokta + boşluk + büyük harf" cümle sonudur; "28.4" ya da "h_{t-1}." bölünmez.
  const sentences = body.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[\p{Lu}"“(])/u);
  const lead = sentences.slice(0, 2).join(" ").trim();
  return { lead, hasMore: sentences.length > 2 };
}

export function slideCount(project: ResearchProject) {
  return 2 + project.story.sections.length + (project.evidence.metrics.length ? 1 : 0) + 1;
}

export function buildSlides(project: ResearchProject): string {
  const { evidence, story } = project;
  const accent = /^#[0-9a-fA-F]{6}$/.test(story.accent) ? story.accent : "#e75b37";
  const slides: string[] = [];

  slides.push(
    `<section class="slide title"><p class="kicker">${escapeHtml([evidence.paper.venue, evidence.paper.year].filter(Boolean).join(" · "))}</p><h1>${escapeHtml(evidence.paper.title)}</h1><p class="authors">${escapeHtml(evidence.paper.authors.join(", "))}</p></section>`,
    `<section class="slide"><p class="kicker">The claim of the paper</p><h2>${escapeHtml(evidence.thesis)}</h2><p>${escapeHtml(evidence.researchQuestion)}</p></section>`,
  );

  for (const section of story.sections) {
    // Bölümün iddialarını paylaşan bir şekil varsa slayda girer; eşleşme tahmin değil, ortak iddia.
    const figure = (project.figures ?? []).find((item) => item.claimIds.some((id) => section.claimIds.includes(id)));
    slides.push(
      `<section class="slide${figure ? " with-figure" : ""}"><div><p class="kicker">${escapeHtml(`${section.indexLabel} · ${section.kicker}`)}</p><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(slideLead(section.body).lead)}</p>${evidenceFor(project, section.claimIds)}${
        slideLead(section.body).hasMore ? `<aside class="notes">${escapeHtml(section.body)}</aside>` : ""
      }</div>${
        figure ? `<figure><img src="${figure.image}" alt="${escapeHtml(figure.label)}"><figcaption>${escapeHtml(figure.label)} · p. ${figure.page}</figcaption></figure>` : ""
      }</section>`,
    );
  }

  if (evidence.metrics.length) {
    slides.push(
      `<section class="slide"><p class="kicker">Reported numbers</p><h2>What the paper measured</h2><table>${evidence.metrics
        .slice(0, 8)
        .map((metric) => `<tr><th>${escapeHtml(metric.label)}</th><td>${escapeHtml(metric.displayValue)}</td><td>${escapeHtml(metric.context)}</td><td class="page">${escapeHtml(citeLabel(project, metric.sourceRef))}</td></tr>`)
        .join("")}</table></section>`,
    );
  }

  slides.push(
    `<section class="slide"><p class="kicker">Before you build on it</p><h2>What the paper says it cannot do</h2><ul>${evidence.limitations
      .slice(0, 6)
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("")}</ul></section>`,
  );

  return `<!doctype html>
<html lang="${escapeHtml(project.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(evidence.paper.title)} — slides</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #191b18; color: #191b18; font-family: Helvetica, Arial, sans-serif; }
  .slide { display: none; width: 100vw; height: 100vh; padding: 7vh 8vw; background: #fbfaf6; flex-direction: column; justify-content: center; gap: 3vh; overflow: hidden; }
  .slide > *, .slide.with-figure > div > * { max-width: 62em; }
  .notes { display: none; padding: 1.6vh 2vh; border-radius: 1vh; background: #f2efe7; color: #3b3f39; font: 400 1.7vh/1.55 Helvetica, Arial, sans-serif; }
  body.show-notes .notes { display: block; }
  .hint { position: fixed; left: 2vw; bottom: 2vh; color: #8a8f86; font-size: 1.4vh; }
  .slide.active { display: flex; }
  .slide.with-figure { flex-direction: row; align-items: center; gap: 4vw; }
  .slide > div { display: flex; flex-direction: column; gap: 3vh; min-width: 0; }
  .slide.with-figure > div { flex: 1.1; }
  .kicker { margin: 0; color: var(--accent); font-size: 1.5vh; letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin: 0; font: 400 7vh/1.08 Georgia, serif; }
  h2 { margin: 0; font: 400 4.4vh/1.18 Georgia, serif; }
  p, li { margin: 0; color: #3b3f39; font: 400 2.5vh/1.55 Georgia, serif; }
  .authors { font: 400 2vh/1.5 Helvetica, Arial, sans-serif; color: #5d625a; }
  ul { margin: 0; padding-left: 3vh; display: grid; gap: 1.2vh; }
  blockquote { margin: 0; padding-left: 1.6vh; border-left: 3px solid var(--accent); color: #5d625a; font: italic 1.9vh/1.5 Georgia, serif; }
  cite { font: normal 1.5vh Helvetica, Arial, sans-serif; white-space: nowrap; }
  figure { flex: 1; margin: 0; min-width: 0; }
  figure img { display: block; max-width: 100%; max-height: 70vh; margin: 0 auto; }
  figcaption { margin-top: 1vh; color: #5d625a; font-size: 1.5vh; text-align: center; }
  table { border-collapse: collapse; font-size: 2vh; }
  th, td { padding: 1.1vh 1.4vh 1.1vh 0; border-bottom: 1px solid #ddd8cd; text-align: left; vertical-align: top; }
  th { font-weight: 600; } td.page { color: #5d625a; white-space: nowrap; }
  .progress { position: fixed; left: 0; bottom: 0; height: 4px; background: var(--accent); transition: width .2s; }
  .counter { position: fixed; right: 2vw; bottom: 2vh; color: #5d625a; font-size: 1.5vh; }
  @media print {
    body { background: none; }
    .slide { display: flex !important; height: 100vh; break-after: page; }
    .progress, .counter, .hint { display: none; }
    .notes { display: block; }
    @page { size: landscape; margin: 0; }
  }
</style>
</head>
<body>
${slides.join("\n")}
<div class="progress"></div><div class="counter"></div><div class="hint" lang="en">← → to move · N for the full text</div>
<script>
  (function () {
    var slides = document.querySelectorAll(".slide"), index = 0;
    function show(next) {
      index = Math.max(0, Math.min(slides.length - 1, next));
      slides.forEach(function (slide, position) { slide.classList.toggle("active", position === index); });
      document.querySelector(".progress").style.width = ((index + 1) / slides.length * 100) + "%";
      document.querySelector(".counter").textContent = (index + 1) + " / " + slides.length;
    }
    document.addEventListener("keydown", function (event) {
      if (["ArrowRight", "PageDown", " ", "Enter"].indexOf(event.key) >= 0) show(index + 1);
      if (["ArrowLeft", "PageUp", "Backspace"].indexOf(event.key) >= 0) show(index - 1);
      if (event.key === "n" || event.key === "N") document.body.classList.toggle("show-notes");
      if (event.key === "Home") show(0);
      if (event.key === "End") show(slides.length - 1);
    });
    document.addEventListener("click", function (event) { show(index + (event.clientX < window.innerWidth / 3 ? -1 : 1)); });
    show(0);
  })();
</script>
</body>
</html>
`;
}
