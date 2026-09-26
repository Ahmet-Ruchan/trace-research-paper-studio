import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { evidenceFingerprint } from "../src/lib/section-regeneration";
import type { ResearchProject } from "../src/lib/schema";

/**
 * Stüdyonun paneller arası akışları. Model çağrısı gereken iki uç
 * (`/api/regenerate`, `/api/models/probe`) taklit ediliyor: burada korunan
 * şey modelin kalitesi değil, arayüzün sonucu nasıl gösterip sakladığı.
 * Geri kalan her şey — kütüphane, geçmiş, yayın, şablon — gerçek sunucu.
 */
// Playwright testleri depo kökünden çalıştırıyor.
const example = JSON.parse(
  readFileSync(join(process.cwd(), "public/examples/attention-is-all-you-need.en.trace.json"), "utf8"),
) as ResearchProject;

function projectNamed(id: string): ResearchProject {
  return { ...structuredClone(example), id };
}

async function seed(request: APIRequestContext, project: ResearchProject, reason = "import") {
  const response = await request.put(`/api/library?reason=${reason}`, { data: project });
  expect(response.ok()).toBe(true);
  return project;
}

async function openStory(page: Page, projectId: string) {
  await page.goto(`/?project=${projectId}&mode=story`);
  // Önyükleme ekranı yalnızca kütüphane okunduktan sonra kalkıyor; düğme
  // görünürse uygulama etkileşime hazırdır.
  await expect(page.locator(".regen-trigger").first()).toBeVisible();
}

test.describe("story editor", () => {
  test("keeps its two shortcuts from covering each other", async ({ page, request }) => {
    await seed(request, projectNamed("e2e-shortcuts"));
    await openStory(page, "e2e-shortcuts");

    const template = await page.getByRole("button", { name: "Save as template" }).boundingBox();
    const preview = await page.getByRole("button", { name: "Full-screen preview" }).boundingBox();
    expect(template).not.toBeNull();
    expect(preview).not.toBeNull();
    const overlaps = template!.y < preview!.y + preview!.height && preview!.y < template!.y + template!.height;
    expect(overlaps).toBe(false);
  });

  test.describe("in a Turkish browser", () => {
    test.use({ locale: "tr-TR" });

    test("marks an English project's visual captions as English", async ({ page, request }) => {
      await seed(request, projectNamed("e2e-locale"));
      await openStory(page, "e2e-locale");
      // Büyük harf dönüşümü `lang` özniteliğine göre yapılıyor; "tr" olsaydı
      // "Design" başlığı "DESİGN" olarak çizilirdi.
      const caption = page.locator(".editor-preview span[lang]").first();
      await expect(caption).toHaveAttribute("lang", "en");
    });
  });
});

test.describe("section regeneration", () => {
  test("shows both versions, applies the accepted one and keeps the old one in history", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-regenerate"));
    const section = project.story.sections[0];
    const rewritten = { ...section, body: "Rewritten by the end-to-end test model." };

    await page.route("**/api/regenerate", async (route) => {
      const body = route.request().postDataJSON() as { claimPolicy: string; target: { sectionId: string } };
      expect(body.claimPolicy).toBe("locked");
      expect(body.target.sectionId).toBe(section.id);
      const events = [
        { type: "progress", stage: "story", progress: 50, title: "Streaming the story section.", detail: "" },
        { type: "section", target: body.target, section: rewritten, evidenceFingerprint: evidenceFingerprint(project.evidence) },
      ];
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
        body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
      });
    });

    await openStory(page, project.id);
    await page.locator(".regen-trigger").first().click();
    await page.getByLabel("Gemini API key").fill("test-key");
    await page.getByRole("dialog").getByRole("button", { name: "Regenerate", exact: true }).click();

    await expect(page.locator(".regen-preview-label", { hasText: "Proposed" })).toBeVisible();
    await expect(page.locator(".regen-preview").nth(1)).toContainText("Rewritten by the end-to-end test model.");
    await page.getByRole("button", { name: "Use this version" }).click();

    await expect(page.locator(".body-input")).toHaveValue("Rewritten by the end-to-end test model.");
    await expect(page.locator(".regen-undo")).toBeVisible();

    // Otomatik kayıt gecikmeli; geçmişte "yeniden üretimden önce" kaydı belirmeli.
    await expect.poll(async () => {
      const response = await request.get(`/api/library/revisions?id=${project.id}`);
      const { revisions } = (await response.json()) as { revisions: Array<{ reason: string }> };
      return revisions.map((revision) => revision.reason);
    }).toContain("regenerate");
  });

  test("rewrites one quiz question in the practice tab", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-quiz"));
    const question = project.quiz!.questions[0];
    const rewritten = { ...question, prompt: "Rewritten question from the end-to-end model?" };

    await page.route("**/api/regenerate", async (route) => {
      const body = route.request().postDataJSON() as { target: { kind: string; sectionId: string } };
      expect(body.target).toEqual({ kind: "quiz", sectionId: question.id });
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
        body: `${JSON.stringify({ type: "section", target: body.target, section: rewritten, evidenceFingerprint: evidenceFingerprint(project.evidence) })}\n`,
      });
    });

    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav button", { hasText: "Learn & Try" }).click();
    await page.locator(".quiz-question").first().locator(".regen-trigger").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Regenerate quiz question" })).toBeVisible();
    await dialog.getByLabel("Gemini API key").fill("test-key");
    await dialog.getByRole("button", { name: "Regenerate", exact: true }).click();

    await expect(page.locator(".regen-preview").nth(1)).toContainText("Rewritten question from the end-to-end model?");
    await page.getByRole("button", { name: "Use this version" }).click();
    await expect(page.locator(".quiz-prompt").first()).toContainText("Rewritten question from the end-to-end model?");
    await expect(page.locator(".regen-undo")).toContainText("Quiz question regenerated");
  });

  test("strengthens a thin section from the evidence health panel", async ({ page, request }) => {
    const project = projectNamed("e2e-strengthen");
    const thin = project.story.sections[1];
    thin.claimIds = thin.claimIds.slice(0, 1);
    await seed(request, project);

    const verified = project.evidence.claims.filter((claim) => claim.confidence === "verified" && claim.id !== thin.claimIds[0]);
    const strengthened = { ...thin, body: "Now backed by more of the paper.", claimIds: [...thin.claimIds, verified[0].id, verified[1].id] };
    await page.route("**/api/regenerate", async (route) => {
      const body = route.request().postDataJSON() as { goal: string; claimPolicy: string; target: { kind: string; sectionId: string } };
      expect(body).toMatchObject({ goal: "strengthen", claimPolicy: "open", target: { kind: "story", sectionId: thin.id } });
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
        body: `${JSON.stringify({ type: "section", target: body.target, section: strengthened, evidenceFingerprint: evidenceFingerprint(project.evidence) })}\n`,
      });
    });

    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav button", { hasText: "Evidence health" }).click();
    const row = page.locator(".health-thin li", { hasText: thin.title });
    await row.getByRole("button", { name: "Strengthen" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Strengthen the evidence of a story section" })).toBeVisible();
    await expect(dialog.locator(".regen-strengthen")).toContainText("rests on 1 claim");
    await expect(dialog.getByRole("radio").first()).toBeDisabled();
    await dialog.getByLabel("Gemini API key").fill("test-key");
    await dialog.getByRole("button", { name: "Regenerate", exact: true }).click();
    await page.getByRole("button", { name: "Use this version" }).click();

    // Bölüm artık ince değil: panel onu listeden çıkarmalı.
    await expect(page.locator(".health-thin li", { hasText: thin.title })).toHaveCount(0);
  });

  test("tells the user how fast the chosen model is before sending the section", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-probe"));
    await page.route("**/api/models/probe", async (route) => {
      const body = route.request().postDataJSON() as { promptCharacters: number };
      // Tahmin gerçek bölüm isteminin uzunluğuyla yapılmalı.
      expect(body.promptCharacters).toBeGreaterThan(5_000);
      await route.fulfill({
        json: {
          ok: true,
          verdict: "too-slow",
          message: "Answered in 45.0 s. A section would take about 70 min, longer than the 15 min limit. Pick a faster model.",
        },
      });
    });

    await openStory(page, project.id);
    await page.locator(".regen-trigger").first().click();
    await page.getByLabel("Provider").selectOption("local");
    await page.getByRole("button", { name: "Test model" }).click();
    await expect(page.locator(".regen-probe.probe-too-slow")).toContainText("Pick a faster model.");
  });
});

test.describe("analysis setup", () => {
  test("tests each model once and reports its slowest step before the PDF is sent", async ({ page }) => {
    const requests: Array<{ stages: Array<{ id: string }> }> = [];
    await page.route("**/api/models/probe", async (route) => {
      const body = route.request().postDataJSON() as { stages: Array<{ id: string; label: string }> };
      requests.push(body);
      await route.fulfill({
        json: {
          ok: true,
          verdict: "slow",
          message: "Answered in 2.0 s. The visual story should take about 95 s, close to the 2 min limit.",
          stages: body.stages.map((stage, index) => ({ id: stage.id, label: stage.label, estimateSeconds: 40 + index * 18, limitSeconds: 120, verdict: "fast" })),
        },
      });
    });

    await page.goto("/");
    await page.getByPlaceholder("Gemini API key").fill("test-key");
    await page.getByRole("button", { name: "Test models" }).click();

    const row = page.locator(".team-probe-list > li");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveClass(/probe-slow/);
    await expect(row).toContainText("Evidence, Technical, Report, Visual");
    await expect(row).toContainText("close to the 2 min limit");
    await expect(row.locator(".team-probe-stages")).toContainText("The deep report: about");
    // Tek model dört görevi yapıyor: tek istek, dört tahmin.
    expect(requests).toHaveLength(1);
    expect(requests[0].stages.map((stage) => stage.id)).toEqual(["evidence", "technical", "report", "visual"]);

    // Seçim değişince eski hüküm kaybolmalı.
    await page.getByRole("combobox", { name: "Depth" }).selectOption("deep");
    await expect(row).toHaveCount(0);
  });
});

test.describe("version history", () => {
  test("lists a restore immediately when the panel is reopened", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-history"));
    const changed = structuredClone(project);
    changed.story.sections[0].body = "A version that will be undone.";
    await seed(request, changed, "regenerate");

    await openStory(page, project.id);
    await page.getByRole("button", { name: "Version history" }).click();
    await page.locator(".history-list button").first().click();
    await expect(page.locator(".history-changes")).toContainText("Story section text changed");
    // Neyin değiştiği kelime düzeyinde: eski metin üstü çizili, şimdiki vurgulu.
    await page.getByText("Show the text").first().click();
    const diff = page.locator(".history-diff-field").first();
    // Tamamen yeniden yazılmış metin tek parça görünmeli, ortak küçük kelimelerde bölünmemeli.
    await expect(diff.locator("ins")).toHaveCount(1);
    await expect(diff.locator("ins")).toContainText("A version that will be undone.");
    await expect(diff.locator("del")).toHaveCount(1);
    await page.getByRole("button", { name: "Restore this version" }).click();

    // Hemen yeniden aç: geri yükleme otomatik kayda bırakılsaydı liste eski kalırdı.
    await page.getByRole("button", { name: "Version history" }).click();
    await expect(page.locator(".history-list")).toContainText("Before a restore");
  });
});

test.describe("publishing", () => {
  test("does not call an unchanged project stale, and labels the page as published", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-publish"));

    // Gerçek hatanın sırası: projeyi açmak kaydedilmiş zaman damgasını yeniliyor,
    // yayın o kayıttan alınıyor, ekrandaki proje ise eski damgayı taşıyor.
    // İçerik aynı; panel "değişti" dememeli.
    await openStory(page, project.id);
    await expect.poll(async () => {
      const response = await request.get("/api/library");
      const { projects } = (await response.json()) as { projects: ResearchProject[] };
      return projects.find((item) => item.id === project.id)?.updatedAt;
    }).not.toBe(project.updatedAt);
    const created = await request.post("/api/publications", {
      data: {
        projectId: project.id,
        settings: { include: { deepReport: true, technicalAppendix: true, learning: true, figures: false }, expiresAt: null },
      },
    });
    const { publication } = (await created.json()) as { publication: { path: string } };

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.locator(".publish-item")).toContainText("without the paper's own figures");
    await expect(page.locator(".publish-item .publish-stale")).toHaveCount(0);

    await page.goto(publication.path);
    await expect(page.locator(".viewer-local")).toHaveText("Published story");
    // İndirme gömülü veriden yapılıyor; sayfanın yanında dosya yok.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".viewer-download").click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${project.id}.trace.json`);
  });

  test("serves the same page for a link that was unpublished", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-unpublish"));
    const created = await request.post("/api/publications", {
      data: { projectId: project.id, settings: { include: { deepReport: true, technicalAppendix: true, learning: true, figures: true }, expiresAt: null } },
    });
    const { publication } = (await created.json()) as { publication: { id: string; path: string } };
    await request.patch(`/api/publications?id=${publication.id}`, { data: { status: "unpublished" } });

    const response = await page.goto(publication.path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This story is not available" })).toBeVisible();
  });
});

test.describe("narrative templates", () => {
  test("saves a story's structure and offers it for the next paper", async ({ page, request }) => {
    await seed(request, projectNamed("e2e-template"));
    await openStory(page, "e2e-template");

    await page.getByRole("button", { name: "Save as template" }).click();
    await page.getByLabel("Template name").fill("End-to-end reading group");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("dialog")).toContainText("End-to-end reading group is saved");

    await page.goto("/");
    await expect(page.locator("select option", { hasText: "End-to-end reading group" })).toHaveCount(1);
  });

  test("edits a saved template and keeps its rules while editing", async ({ page, request }) => {
    const created = await request.put("/api/templates", {
      data: {
        ...(await (await request.get("/api/templates")).json()).templates[0],
        id: "e2e-editable",
        name: "Editable group",
        builtIn: false,
      },
    });
    expect(created.ok()).toBe(true);

    await page.goto("/");
    await page.getByRole("combobox", { name: "Narrative template" }).selectOption("e2e-editable");
    await page.getByRole("button", { name: "Edit template" }).click();
    const dialog = page.getByRole("dialog");

    // Kural canlı: yöntem türü her yuvadan kaldırılırsa kayıt kapanıyor.
    const methodChips = dialog.locator(".template-kinds button.active", { hasText: "method" });
    const count = await methodChips.count();
    for (let index = 0; index < count; index += 1) await methodChips.first().click();
    await expect(dialog.getByRole("alert")).toContainText("One section must draw on method claims");
    await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Edit template" }).click();
    await dialog.getByLabel("Template name").fill("Edited group");
    await dialog.getByLabel("Purpose of section 2").fill("Open with the mechanism");
    await dialog.getByRole("button", { name: "Move section 2 up" }).click();
    await expect(dialog.getByLabel("Purpose of section 1")).toHaveValue("Open with the mechanism");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toContainText("Edited group is saved");
    await dialog.getByRole("button", { name: "Done" }).click();

    const { templates } = (await (await request.get("/api/templates")).json()) as { templates: Array<{ id: string; name: string; story: Array<{ purpose: string }> }> };
    const stored = templates.filter((item) => item.id === "e2e-editable");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Edited group");
    expect(stored[0].story[0].purpose).toBe("Open with the mechanism");
    await expect(page.getByRole("combobox", { name: "Narrative template" })).toHaveValue("e2e-editable");
  });

  test("customizes a copy of a built-in template without changing it", async ({ page, request }) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: "Narrative template" }).selectOption("method-walkthrough");
    await page.getByRole("button", { name: "Customize a copy" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Template name")).toHaveValue("Method walkthrough (copy)");
    await dialog.getByRole("button", { name: "Add a section" }).click();
    await dialog.getByLabel("Purpose of section 7").fill("Close with what to try next");
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(dialog).toContainText("is saved");

    const { templates } = (await (await request.get("/api/templates")).json()) as { templates: Array<{ id: string; name: string; builtIn?: boolean; story: unknown[] }> };
    const builtIn = templates.find((item) => item.id === "method-walkthrough")!;
    const copy = templates.find((item) => item.name === "Method walkthrough (copy)")!;
    expect(builtIn.story).toHaveLength(6);
    expect(copy.builtIn).toBe(false);
    expect(copy.story).toHaveLength(7);
  });
});

/**
 * Kapsamı genişleten üç ekran. Ağa giden iki uç (`/api/resolve`,
 * `/api/citations`) taklit ediliyor: korunan şey OpenAlex'in cevabı değil,
 * stüdyonun onu nasıl gösterdiği ve bir sonraki adıma nasıl taşıdığı.
 */
test.describe("wider coverage", () => {
  test("finds a paper by DOI and loads its PDF into the upload box", async ({ page }) => {
    await page.route("**/api/resolve**", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.7 e2e") });
      }
      expect(new URL(route.request().url()).searchParams.get("q")).toBe("10.1101/2021.10.04.463034");
      await route.fulfill({
        json: {
          candidates: [
            { origin: "biorxiv", title: "Protein complex prediction with AlphaFold-Multimer", authors: ["R. Evans"], year: "2022", pdfUrls: ["https://www.biorxiv.org/content/x.full.pdf"], blockedPdfUrls: [] },
            { origin: "openalex", title: "A paywalled follow-up", authors: [], pdfUrls: [], blockedPdfUrls: ["https://publisher.example/x.pdf"] },
          ],
        },
      });
    });

    await page.goto("/?new=1");
    await page.getByLabel("Find a paper by title, DOI, arXiv id or link").fill("10.1101/2021.10.04.463034");
    await page.getByRole("button", { name: "Find the paper" }).click();

    const candidates = page.locator(".paper-candidates li");
    await expect(candidates).toHaveCount(2);
    await expect(candidates.nth(0)).toContainText("bioRxiv");
    // İndirilemeyen aday seçilemez ama kullanıcıya nereden alacağı söylenir.
    await expect(candidates.nth(1).getByRole("button", { name: "Use this" })).toBeDisabled();
    await expect(candidates.nth(1).getByRole("link", { name: "Get the PDF yourself" })).toHaveAttribute("href", "https://publisher.example/x.pdf");

    await candidates.nth(0).getByRole("button", { name: "Use this" }).click();
    await expect(page.locator(".drop-zone.has-file")).toContainText("protein-complex-prediction-with-alphafold-multimer.pdf");
  });

  test("maps three papers in year order and keeps two as a side-by-side", async ({ page, request }) => {
    for (const [id, year] of [["e2e-map-late", "2021"], ["e2e-map-early", "2014"], ["e2e-map-mid", "2017"]] as const) {
      const project = projectNamed(id);
      project.evidence.paper = { ...project.evidence.paper, title: `Map paper ${year}`, year };
      await seed(request, project);
    }

    await page.goto("/?library=1");
    for (const year of ["2021", "2014"]) {
      await page.locator(".library-card", { hasText: `Map paper ${year}` }).locator(".library-select").click();
    }
    await expect(page.getByRole("button", { name: "Compare" })).toBeEnabled();
    await page.locator(".library-card", { hasText: "Map paper 2017" }).locator(".library-select").click();
    await page.getByRole("button", { name: "Map 3 papers" }).click();

    await expect(page.getByRole("heading", { name: "3 papers, in the order they appeared." })).toBeVisible();
    await expect(page.locator(".map-year")).toHaveText(["2014", "2017", "2021"]);
    // Üçü de aynı örnekten türediği için her ölçüt üç makalede de izlenir.
    await expect(page.locator(".map-values").first().locator("tr")).toHaveCount(3);
  });

  test("opens the citation graph and hands a cited work to the paper search", async ({ page, request }) => {
    await seed(request, projectNamed("e2e-citations"));
    const node = (openAlexId: string, title: string, year: number, extra = {}) => ({
      openAlexId, title, year, citationCount: 1200, authors: ["A. Author"], authorCount: 5, url: "https://example.org", pdfAvailable: true, identifier: "arxiv:2010.11929", ...extra,
    });
    await page.route("**/api/citations", (route) =>
      route.fulfill({
        json: {
          ok: true,
          retrievedAt: "2026-09-01T00:00:00.000Z",
          source: "OpenAlex",
          paper: node("W1", "Attention Is All You Need", 2017),
          referenceCount: 28,
          citedByCount: 7608,
          references: [node("W2", "Adam: A Method for Stochastic Optimization", 2015, { identifier: "arxiv:1412.6980" })],
          citedBy: [node("W3", "An Image is Worth 16x16 Words", 2020)],
          note: "n",
          openAlexUrl: "https://openalex.org/W1",
        },
      }),
    );
    let lookedUp: URLSearchParams | undefined;
    await page.route("**/api/resolve**", (route) => {
      lookedUp = new URL(route.request().url()).searchParams;
      return route.fulfill({ json: { candidates: [
        { origin: "arxiv", title: "An Image is Worth 16x16 Words", authors: [], pdfUrls: ["https://arxiv.org/pdf/2010.11929"], blockedPdfUrls: [] },
        { origin: "arxiv", title: "Another Image Paper", authors: [], pdfUrls: ["https://arxiv.org/pdf/2101.00001"], blockedPdfUrls: [] },
      ] } });
    });

    await openStory(page, "e2e-citations");
    await page.getByRole("button", { name: "Citations" }).click();
    await expect(page.locator(".citation-summary")).toContainText("7,608 citing works");
    await expect(page.locator(".citation-map .citation-node")).toHaveCount(2);

    await page.locator(".citation-columns li", { hasText: "16x16" }).getByRole("button", { name: "Analyse" }).click();
    await expect(page.locator(".paper-candidates li")).toHaveCount(2);
    expect(lookedUp?.get("q")).toBe("arxiv:2010.11929");
    expect(lookedUp?.get("expect")).toBe("An Image is Worth 16x16 Words");
  });
});

test.describe("quote check", () => {
  test("says an unchecked project is unchecked, then records a check made with the PDF", async ({ page, request }) => {
    const project = projectNamed("e2e-quotes");
    delete project.excerptCheck;
    await seed(request, project);
    const doubted = project.evidence.claims.find((claim) => claim.confidence === "verified")!;

    await page.route("**/api/verify-excerpts", (route) =>
      route.fulfill({
        json: {
          excerptCheck: { checkedAt: "2026-09-01T00:00:00.000Z", method: "pdftotext", pageCount: 15, checked: 67, unlocated: [{ owner: "claim", id: doubted.id, page: 4 }] },
          downgradedIds: [doubted.id],
        },
      }),
    );

    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav button", { hasText: "Evidence health" }).click();
    // Denetlenmemiş proje "hepsi bulundu" demez.
    await expect(page.locator(".health-stat", { hasText: "quotes not checked" })).toContainText("—");

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Check the quotes against the PDF" }).click();
    await (await chooser).setFiles({ name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 e2e") });

    await expect(page.locator(".health-stat", { hasText: "quotes found on their page" })).toContainText("66/67");
    await expect(page.locator(".health-block", { hasText: "Quotes that were not found" })).toContainText(doubted.statement);
    await expect(page.getByRole("button", { name: "Check again with the PDF" })).toBeVisible();

    // Kayıt kalıcı: sayfa yenilenince de görünür, iddia da needs-review kalır.
    await expect.poll(async () => {
      const saved = (await (await request.get("/api/library")).json()) as { projects: ResearchProject[] };
      const stored = saved.projects.find((item) => item.id === project.id);
      return [stored?.excerptCheck?.checked, stored?.evidence.claims.find((claim) => claim.id === doubted.id)?.confidence];
    }).toEqual([67, "needs-review"]);
  });
});

test.describe("claim review", () => {
  test("records a person's decision, keeps it apart from the model's confidence, and flags the sections that used a rejected claim", async ({ page, request }) => {
    const project = projectNamed("e2e-review");
    delete project.claimReviews;
    await seed(request, project);
    const used = project.story.sections[0].claimIds[0];
    const usedClaim = project.evidence.claims.find((claim) => claim.id === used)!;

    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav button", { hasText: "Review" }).click();
    const card = page.locator(".review-card", { hasText: usedClaim.statement });
    // İsim girilmeden karar verilemez: kimin baktığı kaydın parçası.
    await expect(card.getByRole("button", { name: "Reject" })).toBeDisabled();
    await page.getByPlaceholder("Your name").fill("Ada");
    await card.getByPlaceholder("Note (optional): what you saw on the page").fill("The table says otherwise.");
    await card.getByRole("button", { name: "Reject" }).click();

    await expect(page.locator(".health-block", { hasText: "still rest on a rejected claim" })).toContainText(project.story.sections[0].title);
    await expect(page.locator(".health-stat", { hasText: "rejected" }).first()).toContainText("1");

    await expect.poll(async () => {
      const saved = (await (await request.get("/api/library")).json()) as { projects: ResearchProject[] };
      const stored = saved.projects.find((item) => item.id === project.id);
      return [stored?.claimReviews?.[used]?.status, stored?.claimReviews?.[used]?.by, stored?.evidence.claims.find((claim) => claim.id === used)?.confidence];
    }).toEqual(["rejected", "Ada", usedClaim.confidence]);
  });
});

test.describe("ask the evidence", () => {
  test("shows the claims an answer rests on, and says when the evidence does not cover a question", async ({ page, request }) => {
    const project = projectNamed("e2e-ask");
    await seed(request, project);
    const cited = project.evidence.claims[0];
    let calls = 0;
    await page.route("**/api/ask", async (route) => {
      const body = route.request().postDataJSON() as { question: string; apiKey: string };
      expect(body.apiKey).toBe("test-key");
      calls += 1;
      await route.fulfill({
        json: calls === 1
          ? { answerable: true, answer: "It relies on attention alone.", claimIds: [cited.id], model: "gemini-3.7-flash" }
          : { answerable: false, answer: "The collected evidence says nothing about training cost in dollars.", claimIds: [], model: "gemini-3.7-flash" },
      });
    });

    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav button", { hasText: "Ask" }).click();
    await page.getByLabel("Gemini API key").fill("test-key");
    await page.getByLabel("Your question about the paper").fill("What does the model rely on?");
    await page.getByRole("main").getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".ask-list > li").first()).toContainText("It relies on attention alone.");
    await page.locator(".ask-claims button").first().click();
    await expect(page.locator(".evidence-drawer h3")).toHaveText(cited.statement);

    await page.getByLabel("Your question about the paper").fill("How many dollars did training cost?");
    await page.getByRole("main").getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".ask-list > li").first()).toContainText("Not covered by the collected evidence");
  });
});

test.describe("export menu", () => {
  test("offers every format, downloads a report that keeps quotes and pages, and disables what the project cannot produce", async ({ page, request }) => {
    const project = projectNamed("e2e-export");
    project.interactives = undefined;
    await seed(request, project);
    await openStory(page, project.id);

    await page.getByRole("button", { name: "Export" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveCount(8);
    // Formül oyun alanı olmayan projeden defter üretilemez; seçenek nedenini söyler.
    await expect(menu.getByRole("menuitem", { name: /Jupyter notebook/ })).toBeDisabled();
    await expect(menu.getByRole("menuitem", { name: /Jupyter notebook/ })).toContainText("no formula playground");

    const download = page.waitForEvent("download");
    await menu.getByRole("menuitem", { name: /Markdown report/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("attention-is-all-you-need.md");
    const markdown = readFileSync(await file.path(), "utf8");
    expect(markdown.startsWith("# Attention Is All You Need")).toBe(true);
    expect(markdown).toMatch(/> “.+” — p\\?\. \d+/);
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});

test.describe("library search and tags", () => {
  test("finds a claim across papers, keeps its trust marks, and opens it in its project", async ({ page, request }) => {
    const first = projectNamed("e2e-search-a");
    const found = first.evidence.claims[0];
    found.statement = "Quokka routing doubles throughput on long inputs.";
    await seed(request, first);
    const second = projectNamed("e2e-search-b");
    const doubted = second.evidence.claims[1];
    doubted.statement = "Quokka routing fails without warmup.";
    second.claimReviews = { [doubted.id]: { status: "rejected", by: "Ada", at: "2026-09-01T00:00:00.000Z" } };
    await seed(request, second);

    await page.goto("/?library=1");
    await page.getByRole("group", { name: "Search in" }).getByRole("button", { name: "Claims" }).click();
    await page.getByLabel("Search claims").fill("quokka ROUTING");

    const hits = page.locator(".claim-hit");
    await expect(hits).toHaveCount(2);
    await expect(page.locator(".library-toolbar > span")).toHaveText("2 claims in 2 papers");
    await expect(hits.first()).toContainText("doubles throughput");
    await expect(hits.first().locator(".claim-hit-statement mark")).toHaveText(["Quokka", "routing"]);
    // Reddedilen iddia gizlenmiyor, sona konuyor ve kimin reddettiği görünüyor.
    await expect(hits.nth(1)).toContainText("Rejected by Ada");

    await hits.first().getByRole("button").click();
    await expect(page).toHaveURL(new RegExp(`project=e2e-search-a.*#claim-${found.id}$`));
    await expect(page.locator(".claim-row.selected")).toContainText("Quokka routing doubles throughput");
  });

  test("gathers papers under a tag, filters by it and maps the collection", async ({ page, request }) => {
    for (const year of ["2015", "2018", "2021"]) {
      const project = projectNamed(`e2e-tag-${year}`);
      project.evidence.paper = { ...project.evidence.paper, title: `Tagged paper ${year}`, year };
      await seed(request, project);
    }

    await page.goto("/?library=1");
    for (const [year, typed] of [["2015", "Zeta collection"], ["2018", "#zeta   COLLECTION"], ["2021", "zeta collection"]] as const) {
      const card = page.locator(".library-card", { hasText: `Tagged paper ${year}` });
      await card.getByRole("button", { name: "Add tags" }).click();
      await card.getByPlaceholder("Add a tag").fill(typed);
      await card.getByPlaceholder("Add a tag").press("Enter");
      await card.getByRole("button", { name: "Done" }).click();
      // Farklı yazımlar ayrı bir koleksiyon açmıyor, var olana katılıyor.
      await expect(card.locator(".library-tag")).toHaveText(["Zeta collection"]);
    }

    const collections = page.getByRole("navigation", { name: "Collections" });
    await collections.getByRole("button", { name: /Zeta collection/ }).click();
    await expect(page.locator(".library-card")).toHaveCount(3);

    // Etiket projenin değil kütüphanenin: proje dosyaları değişmiyor, etiketler yeniden yüklemede kalıyor.
    const stored = (await (await request.get("/api/library/tags")).json()) as { projects: Array<{ id: string; tags: string[] }> };
    expect(stored.projects.filter((entry) => entry.id.startsWith("e2e-tag-"))).toEqual(
      ["2015", "2018", "2021"].map((year) => ({ id: `e2e-tag-${year}`, tags: ["Zeta collection"] })),
    );
    const library = (await (await request.get("/api/library")).json()) as { projects: Array<Record<string, unknown>> };
    expect(library.projects.every((project) => !("tags" in project))).toBe(true);
    // Açılış `?library=1` parametresini adresten siliyor; yeniden yüklemek ana sayfaya dönerdi.
    await page.goto("/?library=1");
    await expect(page.locator(".library-card", { hasText: "Tagged paper 2018" }).locator(".library-tag")).toHaveText(["Zeta collection"]);

    await collections.getByRole("button", { name: /Zeta collection/ }).click();
    await page.getByRole("button", { name: "Map these 3 papers" }).click();
    await expect(page.getByRole("heading", { name: "3 papers, in the order they appeared." })).toBeVisible();
    await expect(page.locator(".map-year")).toHaveText(["2015", "2018", "2021"]);
  });

  test("says next to the card why a thirteenth tag is refused", async ({ page, request }) => {
    const project = projectNamed("e2e-full-tags");
    project.evidence.paper = { ...project.evidence.paper, title: "Fully tagged paper" };
    await seed(request, project);
    const twelve = Array.from({ length: 12 }, (_, index) => `Shelf ${index + 1}`);
    expect((await request.put(`/api/library/tags?id=${project.id}`, { data: { tags: twelve } })).ok()).toBe(true);

    await page.goto("/?library=1");
    const card = page.locator(".library-card", { hasText: "Fully tagged paper" });
    await card.getByRole("button", { name: "Edit tags" }).click();
    await card.getByPlaceholder("Add a tag").fill("Shelf 13");
    await card.getByPlaceholder("Add a tag").press("Enter");
    await expect(card.getByRole("alert")).toHaveText("A paper can carry at most 12 tags.");
    await expect(card.locator(".library-tag")).toHaveCount(12);
    // Yazmaya devam etmek uyarıyı kaldırıyor; kayıt hiç değişmedi.
    await card.getByPlaceholder("Add a tag").fill("Shelf");
    await expect(card.getByRole("alert")).toHaveCount(0);
    const stored = (await (await request.get("/api/library/tags")).json()) as { projects: Array<{ id: string; tags: string[] }> };
    expect(stored.projects.find((entry) => entry.id === project.id)?.tags).toEqual(twelve);
  });

  test("removes a tag, and a paper's tags go with it when it is deleted", async ({ page, request }) => {
    for (const id of ["e2e-untag-a", "e2e-untag-b"]) {
      const project = projectNamed(id);
      project.evidence.paper = { ...project.evidence.paper, title: `Untag ${id.slice(-1)}` };
      await seed(request, project);
      expect((await request.put(`/api/library/tags?id=${id}`, { data: { tags: ["Omega shelf", "Keep"] } })).ok()).toBe(true);
    }

    await page.goto("/?library=1");
    const card = page.locator(".library-card", { hasText: "Untag a" });
    await card.getByRole("button", { name: "Edit tags" }).click();
    await card.getByRole("button", { name: "Remove the tag Omega shelf" }).click();
    await card.getByRole("button", { name: "Done" }).click();
    await expect(card.locator(".library-tag")).toHaveText(["Keep"]);
    await expect(page.getByRole("navigation", { name: "Collections" }).getByRole("button", { name: /Omega shelf/ })).toContainText("1");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator(".library-card", { hasText: "Untag b" }).getByTitle("Permanently delete from library").click();
    await expect(page.locator(".library-card", { hasText: "Untag b" })).toHaveCount(0);
    // Silinen makale "Omega shelf" koleksiyonunun son üyesiydi; koleksiyon da kalkıyor.
    await expect(page.getByRole("navigation", { name: "Collections" }).getByRole("button", { name: /Omega shelf/ })).toHaveCount(0);

    await expect.poll(async () => {
      const stored = (await (await request.get("/api/library/tags")).json()) as { projects: Array<{ id: string; tags: string[] }> };
      return stored.projects.filter((entry) => entry.id.startsWith("e2e-untag-"));
    }).toEqual([{ id: "e2e-untag-a", tags: ["Keep"] }]);
  });
});

test.describe("model record", () => {
  test("adds up each model's quotes, lines up the same paper, and says what it left out", async ({ page, request }) => {
    const steady = projectNamed("e2e-record-gemini");
    steady.evidence.paper = { ...steady.evidence.paper, title: "Quokka record paper", doi: undefined };
    steady.generation = { provider: "gemini", model: "gemini-3.7-flash" };
    steady.claimReviews = { [steady.evidence.claims[0].id]: { status: "approved", by: "Ada", at: "2026-09-01T00:00:00.000Z" } };
    await seed(request, steady);

    const shaky = projectNamed("e2e-record-openai");
    shaky.evidence.paper = { ...shaky.evidence.paper, title: "quokka record paper.", doi: undefined };
    shaky.generation = { provider: "openai", model: "e2e-gpt-record" };
    shaky.excerptCheck = {
      ...shaky.excerptCheck!,
      unlocated: [
        { owner: "claim", id: shaky.evidence.claims[0].id, page: 2 },
        { owner: "metric", id: shaky.evidence.metrics[0].id, page: 8 },
      ],
    };
    await seed(request, shaky);

    const unchecked = projectNamed("e2e-record-unchecked");
    unchecked.evidence.paper = { ...unchecked.evidence.paper, title: "Quokka unchecked paper" };
    delete unchecked.excerptCheck;
    await seed(request, unchecked);

    await page.goto("/?library=1");
    await page.getByRole("button", { name: "Model record" }).click();
    await expect(page.getByRole("heading", { name: "How each model’s quotes held up." })).toBeVisible();

    const byModel = page.locator(".record-table-wrap");
    await expect(byModel.locator("tr", { hasText: "Google Gemini · gemini-3.7-flash" })).toContainText("67 of 67");
    await expect(byModel.locator("tr", { hasText: "Google Gemini · gemini-3.7-flash" })).toContainText("1 approved · 0 rejected");
    const openai = byModel.locator("tr", { hasText: "OpenAI · e2e-gpt-record" });
    await expect(openai).toContainText("65 of 67");
    await expect(openai).toContainText("97%");
    await expect(openai).toContainText(/likely \d+(\.\d)?%–\d+(\.\d)?%/);

    // Başlıklar büyük harf ve noktalamada ayrılsa da aynı makale.
    const pair = page.locator(".record-pairs .compare-card", { hasText: "Quokka record paper" });
    await expect(pair.locator("tr")).toHaveCount(2);

    const left = page.locator(".record-excluded li", { hasText: "Quokka unchecked paper" });
    await expect(left).toContainText("never checked against the PDF");
    await left.getByRole("button", { name: "Open" }).click();
    await expect(page).toHaveURL(/project=e2e-record-unchecked/);

    // Model seçerken aynı karne, seçilen modelin satırıyla.
    await page.goto("/");
    await expect(page.locator(".quote-track-record")).toContainText("Google Gemini · gemini-3.7-flash");
    await expect(page.locator(".quote-track-record")).toContainText("67 of 67 quotes found on their page, in 1 paper");
  });
});
