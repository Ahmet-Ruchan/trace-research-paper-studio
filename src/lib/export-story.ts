import type { ResearchProject, StoryVisual } from "./schema";

function escapeHtml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function visualMarkup(visual: StoryVisual) {
  let canvas = "";
  if (visual.type === "metric") {
    canvas = `<div class="metric-grid">${visual.items
      .map(
        (item) => `<div><b>${escapeHtml(item.value)}</b><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.note)}</small></div>`,
      )
      .join("")}</div>`;
  }
  if (visual.type === "flow") {
    canvas = `<div class="flow">${visual.items
      .map(
        (item, index) => `<div><i>${String(index + 1).padStart(2, "0")}</i><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div>`,
      )
      .join("")}</div>`;
  }
  if (visual.type === "comparison") {
    const max = Math.max(...visual.items.map((item) => item.value), 1);
    canvas = `<div class="bars">${visual.items
      .map(
        (item) => `<div><p><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.displayValue)}</b></p><i><span class="${item.highlight ? "hot" : ""}" style="width:${Math.max((item.value / max) * 100, 8)}%"></span></i></div>`,
      )
      .join("")}</div>`;
  }
  if (visual.type === "concept") {
    canvas = `<div class="concept"><b>${escapeHtml(visual.center)}</b>${visual.items
      .map((item) => `<span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span>`)
      .join("")}</div>`;
  }
  if (visual.type === "layers") {
    canvas = `<div class="layers">${visual.items
      .map(
        (item, index) => `<div class="${escapeHtml(item.tone)}"><i>${String(index + 1).padStart(2, "0")}</i><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div>`,
      )
      .join("")}</div>`;
  }
  if (visual.type === "quote") {
    canvas = `<div class="quote"><i>∴</i><blockquote>${escapeHtml(visual.quote)}</blockquote><p>${escapeHtml(visual.attribution)}</p></div>`;
  }
  if (visual.type === "architecture") {
    canvas = `<div class="architecture"><div>${visual.nodes.map((node) => `<span class="${escapeHtml(node.group)}"><i>${escapeHtml(node.group)}</i><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.detail)}</small></span>`).join("")}</div><ol>${visual.edges.map((edge) => `<li><b>${escapeHtml(edge.from)}</b> → ${escapeHtml(edge.label)} → <b>${escapeHtml(edge.to)}</b></li>`).join("")}</ol></div>`;
  }
  if (visual.type === "equation") {
    canvas = `<div class="equation"><b>${escapeHtml(visual.formula)}</b><div>${visual.terms.map((term) => `<span><strong>${escapeHtml(term.symbol)}</strong><small>${escapeHtml(term.label)} · ${escapeHtml(term.detail)}</small></span>`).join("")}</div><ol>${visual.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></div>`;
  }
  if (visual.type === "timeline") {
    canvas = `<div class="timeline">${visual.items.map((item, index) => `<span class="${escapeHtml(item.tone)}"><i>${String(index + 1).padStart(2, "0")}</i><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span>`).join("")}</div>`;
  }
  if (visual.type === "matrix") {
    canvas = `<div class="matrix"><div class="matrix-head" style="grid-template-columns:repeat(${visual.columns.length + 1},1fr)"><i></i>${visual.columns.map((column) => `<b>${escapeHtml(column)}</b>`).join("")}</div>${visual.rows.map((row) => `<div style="grid-template-columns:repeat(${visual.columns.length + 1},1fr)"><strong>${escapeHtml(row.label)}</strong>${row.cells.map((cell) => `<span class="${escapeHtml(cell.tone)}">${escapeHtml(cell.label)}</span>`).join("")}</div>`).join("")}</div>`;
  }
  if (visual.type === "infographic") {
    canvas = `<div class="infographic">${visual.items.map((item) => `<span><b>${escapeHtml(item.badge)}</b><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div></span>`).join("")}</div>`;
  }

  return `<figure><header>${escapeHtml(visual.eyebrow)}<i></i></header><div class="canvas">${canvas}</div><figcaption>${escapeHtml(visual.caption)}</figcaption></figure>`;
}

export function buildStandaloneStory(project: ResearchProject) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(project.story.accent) ? project.story.accent : "#e75b37";
  const sections = project.story.sections
    .map((section) => {
      const claims = section.claimIds
        .map((id) => project.evidence.claims.find((claim) => claim.id === id))
        .filter(Boolean)
        .map(
          (claim) => `<details><summary>Kaynağı gör · ${claim?.sourceRefs[0]?.page ? `s. ${claim.sourceRefs[0].page}` : "web"}</summary><p>${escapeHtml(claim?.statement ?? "")}</p><blockquote>${escapeHtml(claim?.sourceRefs[0]?.excerpt ?? "")}</blockquote></details>`,
        )
        .join("");
      return `<section id="${safeId(section.id)}" data-visual="visual-${safeId(section.id)}"><span class="index">${escapeHtml(section.indexLabel)}</span><p class="kicker">${escapeHtml(section.kicker)}</p><h2>${escapeHtml(section.title)}</h2><p class="body">${escapeHtml(section.body)}</p><div class="sources">${claims}</div><div class="mobile-visual">${visualMarkup(section.visual)}</div></section>`;
    })
    .join("");
  const visuals = project.story.sections
    .map(
      (section, index) => `<div id="visual-${safeId(section.id)}" class="visual ${index === 0 ? "active" : ""}">${visualMarkup(section.visual)}</div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${project.language}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${escapeHtml(project.story.dek)}"><title>${escapeHtml(project.story.title)}</title>
<style>
:root{--paper:#f3f0e8;--surface:#fbfaf6;--ink:#181a17;--muted:#6b716a;--line:#d7d2c8;--accent:${accent}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}.progress{height:3px;position:fixed;inset:0 0 auto;z-index:10;background:var(--line)}.progress i{display:block;height:100%;width:0;background:var(--accent);transition:.2s}header.hero{min-height:94vh;padding:32px max(5vw,24px);display:flex;flex-direction:column;justify-content:space-between;border-bottom:1px solid var(--line)}.mast{display:flex;justify-content:space-between;text-transform:uppercase;font-size:11px;letter-spacing:.14em}.hero-copy{max-width:1040px;margin:auto 0}.overline,.kicker{text-transform:uppercase;letter-spacing:.15em;font-size:11px;color:var(--accent);font-weight:700}.hero h1{font:500 clamp(58px,9vw,138px)/.9 Georgia,serif;letter-spacing:-.055em;max-width:1100px;margin:22px 0 30px}.dek{font:400 clamp(20px,2vw,31px)/1.45 Georgia,serif;max-width:780px;color:#454943}.story{display:grid;grid-template-columns:minmax(340px,.8fr) minmax(480px,1.2fr);max-width:1480px;margin:auto}.copy{padding:0 5vw}.copy section{min-height:100vh;padding:32vh 0 24vh;opacity:.43;transition:.4s}.copy section.active{opacity:1}.index{font:italic 22px Georgia,serif;color:var(--accent)}section h2{font:500 clamp(34px,4vw,61px)/1.03 Georgia,serif;letter-spacing:-.04em;margin:18px 0 24px}.body{font:18px/1.75 Georgia,serif;color:#444942}.sticky{position:sticky;top:0;height:100vh;padding:8vh 4vw;display:grid;place-items:center}.visual{grid-area:1/1;opacity:0;transform:translateY(12px);pointer-events:none;transition:.45s;width:100%}.visual.active{opacity:1;transform:none}.mobile-visual{display:none}figure{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:0 24px 80px #39352b0b;overflow:hidden}figure>header{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;text-transform:uppercase;letter-spacing:.13em;font-size:10px;font-weight:700}figure>header i{width:7px;height:7px;border-radius:50%;background:var(--accent)}.canvas{min-height:480px;padding:42px;display:grid;place-items:center}figcaption{border-top:1px solid var(--line);padding:15px 22px;font-size:12px;color:var(--muted)}.metric-grid{display:grid;grid-template-columns:repeat(3,1fr);width:100%;gap:10px}.metric-grid div{border-left:1px solid var(--line);padding:22px}.metric-grid b{display:block;font:48px Georgia,serif;color:var(--accent)}.metric-grid strong,.metric-grid small{display:block;margin-top:8px}.metric-grid small,.flow small,.concept small,.layers small{color:var(--muted)}.flow{display:flex;width:100%}.flow div{flex:1;position:relative;padding:22px 10px;border-top:1px solid var(--line)}.flow i{display:block;color:var(--accent);margin-bottom:25px}.flow strong,.flow small{display:block}.bars{width:100%}.bars>div{margin:26px 0}.bars p{display:flex;justify-content:space-between}.bars i{display:block;height:13px;background:#e4e0d8;border-radius:20px}.bars i span{display:block;height:100%;border-radius:inherit;background:#262925}.bars i span.hot{background:var(--accent)}.concept{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:18px}.concept>b{grid-column:1/-1;margin:auto;padding:25px;border-radius:50%;border:1px solid var(--accent);font:26px Georgia,serif}.concept span{padding:20px;border:1px solid var(--line);border-radius:12px}.concept strong,.concept small{display:block}.layers{width:100%;display:grid;gap:9px}.layers div{display:grid;grid-template-columns:40px 1fr 1fr;padding:20px;border:1px solid var(--line);border-radius:10px;align-items:center}.layers .accent{background:var(--accent);color:white}.layers .ink{background:var(--ink);color:white}.quote{text-align:center}.quote>i{font-size:80px;color:var(--accent)}.quote blockquote{font:48px Georgia,serif;margin:10px}.quote p{color:var(--muted)}.architecture,.equation,.timeline,.matrix,.infographic{width:100%}.architecture>div{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.architecture span,.equation span,.infographic>span{padding:14px;border:1px solid var(--line);border-radius:9px}.architecture span>*{display:block}.architecture span i{color:var(--accent);font-size:9px;text-transform:uppercase}.architecture span small,.equation small,.timeline small,.infographic small{display:block;margin-top:6px;color:var(--muted)}.architecture ol{font-size:10px;color:var(--muted)}.equation>b{display:block;padding:28px;text-align:center;font:32px Georgia,serif;color:var(--accent)}.equation>div{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.equation span strong{font:22px Georgia,serif}.timeline{display:flex}.timeline>span{flex:1;padding:18px;border-top:2px solid var(--line)}.timeline>span>*{display:block}.timeline>span i{margin-bottom:25px;color:var(--accent)}.matrix>div{display:grid}.matrix>div>*{padding:12px;border:1px solid var(--line);font-size:10px}.matrix .high{background:var(--accent);color:white}.matrix .medium{background:#f5d7ce}.matrix .low{background:#eeeae1}.infographic{display:grid;grid-template-columns:1fr 1fr;gap:8px}.infographic>span{display:flex;gap:12px}.infographic>span>b{color:var(--accent);font:22px Georgia,serif}details{border-top:1px solid var(--line);padding:12px 0;font-size:12px;color:var(--muted)}summary{cursor:pointer}.closing{padding:18vh 6vw;max-width:1000px}.closing h2{font:500 clamp(44px,7vw,90px)/.95 Georgia,serif;letter-spacing:-.05em}.closing>p{font:22px/1.65 Georgia,serif;color:#454943}.source-card{margin-top:60px;padding:25px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
@media(max-width:850px){.story{display:block}.sticky{display:none}.copy{padding:0 22px}.copy section{padding:20vh 0;min-height:auto;opacity:1}.mobile-visual{display:block;margin-top:45px}.canvas{min-height:360px;padding:22px}.metric-grid{grid-template-columns:1fr}.hero h1{font-size:18vw}.flow{display:grid}.closing{padding:15vh 22px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{transition:none!important}}
</style></head>
<body><div class="progress"><i></i></div><header class="hero"><div class="mast"><b>Trace story</b><span>${escapeHtml(project.story.readingTime)}</span></div><div class="hero-copy"><p class="overline">${escapeHtml(project.evidence.paper.year)} · ${escapeHtml(project.evidence.paper.venue)}</p><h1>${escapeHtml(project.story.title)}</h1><p class="dek">${escapeHtml(project.story.dek)}</p></div><div class="mast"><span>${escapeHtml(project.evidence.paper.authors.slice(0,4).join(", "))}</span><span>Scroll ↓</span></div></header><main class="story"><div class="copy">${sections}</div><aside class="sticky">${visuals}</aside></main><footer class="closing"><p class="overline">Son okuma</p><h2>${escapeHtml(project.story.closing.title)}</h2><p>${escapeHtml(project.story.closing.body)}</p><div class="source-card"><small>Birincil kaynak</small><h3>${escapeHtml(project.evidence.paper.title)}</h3></div></footer>
<script>const sections=[...document.querySelectorAll('.copy section')];const visuals=[...document.querySelectorAll('.visual')];const bar=document.querySelector('.progress i');const activate=(id)=>{sections.forEach(s=>s.classList.toggle('active',s.id===id));visuals.forEach(v=>v.classList.toggle('active',v.id==='visual-'+id))};const observer=new IntersectionObserver(entries=>{const hit=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(hit)activate(hit.target.id)},{rootMargin:'-35% 0px -40%',threshold:[0,.25,.6]});sections.forEach(s=>observer.observe(s));addEventListener('scroll',()=>{const h=document.documentElement;bar.style.width=((h.scrollTop/(h.scrollHeight-h.clientHeight))*100)+'%'},{passive:true});</script></body></html>`;
}
