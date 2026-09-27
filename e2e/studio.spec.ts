import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { evidenceFingerprint } from "../src/lib/section-regeneration";
import type { ResearchProject } from "../src/lib/schema";
import { UNDO_WINDOW_MS } from "../src/lib/pending-deletion";
import { TRACE_ACCENT_PALETTE } from "../src/lib/trace-storage";
import { readingDrillFor } from "../src/lib/reading-drill";
import { REWRITE_PRESETS } from "../src/lib/rewrite-presets";
import { completeStep, recordAnswer, studyPath, type StudyProgress } from "../src/lib/study-path";

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

/** Destek kaynakları ve şablon analiz formunda "More options" altında kapalı duruyor. */
async function openMoreOptions(page: Page) {
  await page.locator("summary", { hasText: "More options" }).click();
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

  test("turns a quick request into the instruction the model receives", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-presets"));
    const section = project.story.sections[0];
    const preset = (id: string) => REWRITE_PRESETS.story.find((item) => item.id === id)!.instruction;
    let sent = "";

    await page.route("**/api/regenerate", async (route) => {
      sent = (route.request().postDataJSON() as { instruction: string }).instruction;
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
        body: `${JSON.stringify({ type: "section", target: { kind: "story", sectionId: section.id }, section: { ...section, body: "Simpler, with an analogy." }, evidenceFingerprint: evidenceFingerprint(project.evidence) })}\n`,
      });
    });

    await openStory(page, project.id);
    await page.locator(".regen-trigger").first().click();
    const dialog = page.getByRole("dialog");
    const quick = dialog.getByRole("group", { name: "Quick requests" });
    const field = dialog.getByRole("textbox", { name: /What should change/ });

    await field.fill("Keep the timeline.");
    await quick.getByRole("button", { name: "More technical" }).click();
    await quick.getByRole("button", { name: "With an analogy" }).click();
    // "Simpler" ile "More technical" birlikte gönderilmiyor.
    await quick.getByRole("button", { name: "Simpler" }).click();
    await expect(quick.getByRole("button", { name: "Simpler" })).toHaveAttribute("aria-pressed", "true");
    await expect(quick.getByRole("button", { name: "More technical" })).toHaveAttribute("aria-pressed", "false");
    await expect(field).toHaveValue(["Keep the timeline.", preset("analogy"), preset("simpler")].join("\n"));

    await dialog.getByLabel("Gemini API key").fill("test-key");
    await dialog.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(page.locator(".regen-preview").nth(1)).toContainText("Simpler, with an analogy.");
    expect(sent).toBe(["Keep the timeline.", preset("analogy"), preset("simpler")].join("\n"));
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
    await expect(row).toContainText("Evidence, Technical, Report, Visual, Teaching");
    await expect(row).toContainText("close to the 2 min limit");
    await expect(row.locator(".team-probe-stages")).toContainText("The deep report: about");
    // Tek model beş görevi yapıyor: tek istek, beş tahmin.
    expect(requests).toHaveLength(1);
    expect(requests[0].stages.map((stage) => stage.id)).toEqual(["evidence", "technical", "report", "visual", "teaching"]);

    // Seçim değişince eski hüküm kaybolmalı.
    await page.getByRole("combobox", { name: "Depth" }).selectOption("deep");
    await expect(row).toHaveCount(0);
  });

  test("remembers the last choices in this browser, but never a key", async ({ page }) => {
    await page.goto("/");
    const more = page.locator("details.setup-more");
    await expect(more).not.toHaveAttribute("open");
    await page.getByRole("combobox", { name: "Reader" }).selectOption("expert");
    await page.getByRole("combobox", { name: "Depth" }).selectOption("deep");
    await page.getByRole("combobox", { name: "Language" }).selectOption("tr");
    await page.getByRole("combobox", { name: "Model provider" }).selectOption("anthropic");
    await page.getByRole("combobox", { name: "Anthropic Claude model" }).selectOption("claude-haiku-4-5");
    await page.getByPlaceholder("Claude API key").fill("sk-ant-e2e-never-stored");
    await openMoreOptions(page);
    await page.getByRole("combobox", { name: "Narrative template" }).selectOption("method-walkthrough");

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Reader" })).toHaveValue("expert");
    await expect(page.getByRole("combobox", { name: "Depth" })).toHaveValue("deep");
    await expect(page.getByRole("combobox", { name: "Language" })).toHaveValue("tr");
    await expect(page.getByRole("combobox", { name: "Model provider" })).toHaveValue("anthropic");
    await expect(page.getByRole("combobox", { name: "Anthropic Claude model" })).toHaveValue("claude-haiku-4-5");
    // Şablon seçiliyse "More options" açık geliyor; özet satırı da adını söylüyor.
    await expect(more).toHaveAttribute("open");
    await expect(more.locator("summary")).toContainText("Method walkthrough");
    await expect(page.getByRole("combobox", { name: "Narrative template" })).toHaveValue("method-walkthrough");
    await expect(page.getByPlaceholder("Claude API key")).toHaveValue("");
    const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
    expect(stored).toContain("claude-haiku-4-5");
    expect(stored).not.toContain("sk-ant-e2e-never-stored");
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
    await openMoreOptions(page);
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
    await openMoreOptions(page);
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

    await page.locator(".library-card", { hasText: "Untag b" }).getByTitle("Delete from library").click();
    await expect(page.locator(".library-card", { hasText: "Untag b" })).toHaveCount(0);
    // Geri alma süresini beklemeden silmek.
    await page.getByRole("button", { name: "Delete now" }).click();
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
    await expect(byModel.locator("tr", { hasText: "Google Gemini · gemini-3.7-flash" })).toContainText("75 of 75");
    await expect(byModel.locator("tr", { hasText: "Google Gemini · gemini-3.7-flash" })).toContainText("1 approved · 0 rejected");
    const openai = byModel.locator("tr", { hasText: "OpenAI · e2e-gpt-record" });
    await expect(openai).toContainText("73 of 75");
    await expect(openai).toContainText("97.3%");
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
    await expect(page.locator(".quote-track-record")).toContainText("75 of 75 quotes found on their page, in 1 paper");
  });
});

test.describe("reading comfort", () => {
  /** Görünür metnin en küçük boyutu; SVG ve formül alt/üst simgeleri kendi ölçeklerinde. */
  async function smallestText(page: Page) {
    return page.evaluate(() => {
      let smallest = Infinity;
      let where = "";
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const element = node.parentElement;
        if (!node.textContent?.trim() || !element || element.closest("svg, math")) continue;
        const style = getComputedStyle(element);
        const size = parseFloat(style.fontSize);
        const box = element.getBoundingClientRect();
        if (!size || !box.width || !box.height || style.visibility === "hidden") continue;
        if (size < smallest) { smallest = size; where = `${element.className || element.tagName}: ${node.textContent.trim().slice(0, 30)}`; }
      }
      return { smallest, where };
    });
  }

  test("keeps every visible text at 12 px or more on the main screens", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-type-floor"));
    for (const url of ["/", "/?library=1", `/?project=${project.id}`, `/?project=${project.id}&mode=story`, `/?project=${project.id}&mode=preview`]) {
      await page.goto(url);
      await expect(page.locator(".boot-screen")).toHaveCount(0);
      const { smallest, where } = await smallestText(page);
      expect(smallest, `${url} · ${where}`).toBeGreaterThanOrEqual(12);
    }
  });

  test("puts the claim kind above the statement instead of on top of it", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-claim-row"));
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav button", { hasText: "Claims" }).first().click();
    const row = page.locator(".claim-row").first();
    const kind = await row.locator(".claim-kind").boundingBox();
    const text = await row.locator("p").boundingBox();
    expect(kind && text && kind.y + kind.height <= text.y + 1).toBe(true);
    await expect(row.locator(".claim-page")).toHaveText(/^p\. \d+$/);
  });

  test("fits the phone screen at the largest text size", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-phone-larger"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => window.localStorage.setItem("trace-text-size", "larger"));
    for (const url of ["/", "/?library=1", `/?project=${project.id}`, `/?project=${project.id}&mode=preview`]) {
      await page.goto(url);
      await expect(page.locator(".boot-screen")).toHaveCount(0);
      // Izgara sütunları içeriğin en küçük genişliğine göre büyüyüp ekranı aşıyordu.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), url).toBe(0);
    }
  });

  test("lets the reader choose a larger text size and remembers it", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-text-size"));
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav button", { hasText: "Claims" }).first().click();
    const statement = page.locator(".claim-row p").first();
    const before = parseFloat(await statement.evaluate((element) => getComputedStyle(element).fontSize));

    await page.getByRole("button", { name: "Text size" }).click();
    // Örnek "Aa" başlıktaki düğme kurallarına takılıp gizlenmiyor; etiketle çakışmıyor.
    const larger = page.getByRole("menuitemradio", { name: /Larger/ });
    await expect(larger.locator(".text-size-sample")).toBeVisible();
    const sample = await larger.locator(".text-size-sample").boundingBox();
    const label = await larger.locator("strong").boundingBox();
    expect(sample && label && sample.x + sample.width <= label.x).toBe(true);
    await larger.click();
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "larger");
    await expect(page.getByRole("menu", { name: "Text size" })).toHaveCount(0);
    expect(parseFloat(await statement.evaluate((element) => getComputedStyle(element).fontSize))).toBeCloseTo(before * 1.25, 1);

    // Seçim tarayıcıda kalıyor ve sayfa çizilmeden uygulanıyor.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "larger");
    await page.getByRole("button", { name: "Text size" }).click();
    await expect(page.getByRole("menuitemradio", { name: /Larger/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: /Default/ }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-text-size", /.+/);
  });
});

test.describe("undoable deletion", () => {
  const listed = async (request: APIRequestContext, id: string) =>
    ((await (await request.get("/api/library")).json()) as { projects: ResearchProject[] }).projects.some((item) => item.id === id);

  test("brings a deleted paper back with its tags, and never deletes it later", async ({ page, request }) => {
    const project = projectNamed("e2e-undo");
    project.evidence.paper = { ...project.evidence.paper, title: "Undo me paper" };
    await seed(request, project);
    expect((await request.put(`/api/library/tags?id=${project.id}`, { data: { tags: ["Keep me"] } })).ok()).toBe(true);

    await page.goto("/?library=1");
    const card = page.locator(".library-card", { hasText: "Undo me paper" });
    await card.getByTitle("Delete from library").click();
    await expect(card).toHaveCount(0);
    const toast = page.getByRole("status").filter({ hasText: "Undo me paper" });
    await expect(toast).toContainText("Deleted");
    await toast.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(card).toHaveCount(1);
    await expect(card.locator(".library-tag")).toHaveText(["Keep me"]);
    await expect(toast).toHaveCount(0);

    // Geri alınan silme süre dolunca da gitmiyor.
    await page.waitForTimeout(UNDO_WINDOW_MS + 1_000);
    expect(await listed(request, project.id)).toBe(true);
  });

  test("undoes with the keyboard, but not while the user is typing", async ({ page, request }) => {
    const project = projectNamed("e2e-undo-keys");
    project.evidence.paper = { ...project.evidence.paper, title: "Keyboard undo paper" };
    await seed(request, project);
    await page.goto("/?library=1");
    const card = page.locator(".library-card", { hasText: "Keyboard undo paper" });
    await card.getByTitle("Delete from library").click();
    await expect(card).toHaveCount(0);
    // Arama kutusundayken Ctrl/⌘+Z kullanıcının kendi yazısını geri alıyor, silmeyi değil.
    const search = page.getByLabel("Search papers");
    await search.fill("keyboard");
    await search.press("ControlOrMeta+z");
    // Bildirimin içinde ve tam adla: kart düğmeleri de makale başlığındaki "Undo"yu taşıyabiliyor.
    await expect(page.getByRole("status").getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await search.fill("");
    await search.blur();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(card).toHaveCount(1);
  });

  test("finishes a pending deletion when the user leaves the library or closes the page", async ({ page, request }) => {
    for (const id of ["e2e-leave-screen", "e2e-leave-page"]) {
      const project = projectNamed(id);
      project.evidence.paper = { ...project.evidence.paper, title: `Leaving ${id}` };
      await seed(request, project);
    }
    await page.goto("/?library=1");

    await page.locator(".library-card", { hasText: "Leaving e2e-leave-screen" }).getByTitle("Delete from library").click();
    await page.getByRole("button", { name: "Home" }).first().click();
    await expect.poll(() => listed(request, "e2e-leave-screen")).toBe(false);

    await page.goto("/?library=1");
    await page.locator(".library-card", { hasText: "Leaving e2e-leave-page" }).getByTitle("Delete from library").click();
    // Sayfadan ayrılmak: istek sayfa kapanırken de tamamlanıyor (keepalive).
    await page.goto("about:blank");
    await expect.poll(() => listed(request, "e2e-leave-page")).toBe(false);
  });
});

test.describe("accent colour as text", () => {
  /** Tarayıcının çizdiği iki rengi tuvale boyayıp sRGB olarak okur; kontrast gerçek renklerle. */
  function contrast(page: Page, foreground: string, background: string) {
    return page.evaluate(([foreground, background]) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
          .map((value) => value / 255)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [light, dark] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
      return (light + 0.05) / (dark + 0.05);
    }, [foreground, background] as const);
  }

  /** `--accent` bu renkken metnin gerçekten aldığı renk. */
  function inkFor(page: Page, accent: string) {
    return page.evaluate((accent) => {
      const host = document.createElement("div");
      host.style.setProperty("--accent", accent);
      const text = document.createElement("span");
      text.style.color = "var(--accent-ink)";
      host.append(text);
      document.body.append(host);
      const drawn = getComputedStyle(text).color;
      host.remove();
      return drawn;
    }, accent);
  }

  test("keeps every paper colour readable as text on paper and on cards", async ({ page }) => {
    await page.goto("/?library=1");
    await expect(page.locator(".boot-screen")).toHaveCount(0);
    for (const accent of ["#e75b37", ...TRACE_ACCENT_PALETTE]) {
      const ink = await inkFor(page, accent);
      for (const background of ["#f2efe7", "#fbfaf6"]) {
        expect(await contrast(page, ink, background), `${accent} → ${ink} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("keeps every paper colour readable as text in the dark theme", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("trace-theme", "dark"));
    await page.goto("/?library=1");
    await expect(page.locator(".boot-screen")).toHaveCount(0);
    for (const accent of ["#e75b37", ...TRACE_ACCENT_PALETTE]) {
      const ink = await inkFor(page, accent);
      for (const background of ["#161714", "#1e201c", "#232521"]) {
        expect(await contrast(page, ink, background), `${accent} → ${ink} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("draws a pale paper colour's card label in the readable tone", async ({ page, request }) => {
    const project = projectNamed("e2e-pale-accent");
    project.story.accent = "#FACC15";
    project.evidence.paper = { ...project.evidence.paper, title: "Pale accent paper" };
    await seed(request, project);
    await page.goto("/?library=1");
    const card = page.locator(".library-card", { hasText: "Pale accent paper" });
    const label = await card.locator(".library-card-copy > span").evaluate((element) => getComputedStyle(element).color);
    const surface = await card.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await contrast(page, label, surface), label).toBeGreaterThanOrEqual(4.5);
    // Kapaktaki dolgu ise makalenin kendi rengi olarak kalıyor.
    expect(await card.locator(".library-cover").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(250, 204, 21)");
  });
});

test.describe("colour themes", () => {
  const PAPER = { light: "rgb(242, 239, 231)", dark: "rgb(22, 23, 20)" };
  const paper = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  /**
   * Görünür her metnin kendi zeminine karşıtlığı (WCAG AA: 4,5:1, büyük metin
   * 3:1). Zemin, yarı saydam katmanlar üst üste boyanarak bulunuyor; resim ya
   * da degrade zeminli, soluk (devre dışı) ve dekoratif metinler sayılmıyor.
   */
  function unreadableTexts(page: Page) {
    return page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      const rgba = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = "#000";
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const data = context.getImageData(0, 0, 1, 1).data;
        return [data[0], data[1], data[2], data[3] / 255];
      };
      const luminance = ([r, g, b]: number[]) => [r, g, b]
        .map((value) => value / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
      const blend = (top: number[], bottom: number[]) => [0, 1, 2].map((index) => top[index] * top[3] + bottom[index] * (1 - top[3])).concat(1);
      const ground = (element: Element) => {
        const layers: number[][] = [];
        for (let current: Element | null = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.backgroundImage !== "none" && !style.backgroundImage.startsWith("linear")) return undefined;
          const color = rgba(style.backgroundColor);
          if (color[3] > 0) {
            layers.push(color);
            if (color[3] >= 1) break;
          }
        }
        let result = rgba(getComputedStyle(document.documentElement).backgroundColor);
        for (const layer of layers.reverse()) result = blend(layer, result);
        return result;
      };
      const failures = new Set<string>();
      let checked = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const element = node.parentElement;
        if (!element || !node.textContent?.trim()) continue;
        if (element.closest("svg, math, [aria-hidden='true'], .excerpt-page, .figure-frame, .library-cover, .code-sketches, [disabled], .boot-screen")) continue;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height || style.visibility === "hidden" || parseFloat(style.fontSize) === 0) continue;
        let opacity = 1;
        for (let current: Element | null = element; current; current = current.parentElement) opacity *= parseFloat(getComputedStyle(current).opacity);
        if (opacity < 0.95) continue;
        const background = ground(element);
        if (!background) continue;
        const foreground = blend(rgba(style.color), background);
        const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        const ratio = (high + 0.05) / (low + 0.05);
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        checked += 1;
        if (ratio < (large ? 3 : 4.5)) failures.add(`${ratio.toFixed(2)}:1 ${String(element.className || element.tagName).slice(0, 40)} "${node.textContent.trim().slice(0, 28)}"`);
      }
      return { checked, failures: [...failures] };
    });
  }

  test("switches to dark, keeps it from the first paint on, and back to light", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-dark-theme"));
    await page.goto(`/?project=${project.id}`);
    expect(await paper(page)).toBe(PAPER.light);

    await page.getByRole("button", { name: "Text size and theme" }).click();
    await page.getByRole("menuitemradio", { name: /Dark/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("menu", { name: "Text size and theme" })).toHaveCount(0);
    expect(await paper(page)).toBe(PAPER.dark);

    // Açılış betiği özniteliği uygulama çizilmeden yazıyor: beyaz bir parlama yok.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { themeAtLoad: string | null }).themeAtLoad = document.documentElement.getAttribute("data-theme");
      });
    });
    await page.reload();
    expect(await page.evaluate(() => (window as unknown as { themeAtLoad: string | null }).themeAtLoad)).toBe("dark");
    await page.getByRole("button", { name: "Text size and theme" }).click();
    await expect(page.getByRole("menuitemradio", { name: /Dark/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: /Light/ }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    expect(await paper(page)).toBe(PAPER.light);
    expect(await page.evaluate(() => window.localStorage.getItem("trace-theme"))).toBeNull();
  });

  test("follows the device when the theme is set to System", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    // Varsayılan açık tema: cihaz karanlık olsa da kullanıcı seçmeden değişmiyor.
    expect(await paper(page)).toBe(PAPER.light);
    await page.getByRole("button", { name: "Text size and theme" }).click();
    await page.getByRole("menuitemradio", { name: /System/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    expect(await paper(page)).toBe(PAPER.dark);
    await page.emulateMedia({ colorScheme: "light" });
    expect(await paper(page)).toBe(PAPER.light);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`keeps every visible text readable in the ${theme} theme`, async ({ page, request }) => {
      const project = projectNamed(`e2e-contrast-${theme}`);
      project.claimReviews = {
        [project.evidence.claims[0].id]: { status: "approved", by: "Ada", at: "2026-09-01T00:00:00.000Z" },
        [project.evidence.claims[1].id]: { status: "rejected", by: "Ada", at: "2026-09-01T00:00:00.000Z" },
      };
      await seed(request, project);
      await page.addInitScript((chosen) => { if (chosen !== "light") window.localStorage.setItem("trace-theme", chosen); }, theme);
      const screens: Array<[string, string?]> = [
        ["/"],
        ["/?library=1"],
        [`/?project=${project.id}`],
        [`/?project=${project.id}`, "Claims"],
        [`/?project=${project.id}`, "Review"],
        [`/?project=${project.id}`, "Evidence health"],
        [`/?project=${project.id}&mode=story`],
        [`/?project=${project.id}&mode=preview`],
      ];
      for (const [url, section] of screens) {
        await page.goto(url);
        await expect(page.locator(".boot-screen")).toHaveCount(0);
        if (section) await page.locator(".lab-nav button", { hasText: section }).first().click();
        // Kütüphane listesi sunucudan geliyor; yüklü bir makinede 400 ms yetmiyordu ve sayfanın yalnızca başlığı ölçülüyordu.
        if (url.includes("library=1")) await expect(page.locator(".library-card").first()).toBeVisible();
        // Geçişler bitsin: renkler yarı yoldayken ölçülmesin.
        await page.waitForTimeout(400);
        const { checked, failures } = await unreadableTexts(page);
        expect(checked, `${url} ${section ?? ""}`).toBeGreaterThan(20);
        expect(failures, `${theme} · ${url} ${section ?? ""}`).toEqual([]);
      }
    });
  }
});

test.describe("library order and layout", () => {
  function paperTitled(id: string, title: string, year: string) {
    const project = projectNamed(id);
    project.evidence.paper = { ...project.evidence.paper, title, year };
    return project;
  }

  test("sorts by title or by the paper's year, shows a compact list, and remembers both", async ({ page, request }) => {
    await seed(request, paperTitled("e2e-order-beta", "Ordering probe Beta", "NeurIPS 2021"));
    await seed(request, paperTitled("e2e-order-alpha", "ordering probe alpha", "2015"));
    await seed(request, paperTitled("e2e-order-gamma", "Ordering probe Gamma", "2019"));
    await page.goto("/?library=1");
    await page.getByPlaceholder("Search title, author, venue or tag").fill("Ordering probe");
    const titles = page.locator(".library-card h2");
    const sort = page.getByRole("combobox", { name: "Sort" });

    await sort.selectOption("title");
    await expect(titles).toHaveText(["ordering probe alpha", "Ordering probe Beta", "Ordering probe Gamma"]);
    await sort.selectOption("newest");
    await expect(titles).toHaveText(["Ordering probe Beta", "Ordering probe Gamma", "ordering probe alpha"]);
    await sort.selectOption("oldest");
    await expect(titles).toHaveText(["ordering probe alpha", "Ordering probe Gamma", "Ordering probe Beta"]);
    await expect(page.locator(".library-toolbar")).toContainText("3 results");

    const card = page.locator(".library-card").first();
    const gridHeight = (await card.boundingBox())!.height;
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".library-grid")).toHaveClass(/is-list/);
    expect((await card.boundingBox())!.height).toBeLessThan(gridHeight / 1.5);

    // Uygulama `?library=1`'i adresten siliyor; yenileme ana sayfaya dönerdi.
    await page.goto("/?library=1");
    await expect(sort).toHaveValue("oldest");
    await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".library-grid")).toHaveClass(/is-list/);
  });
});

test.describe("lab on a phone", () => {
  test("moves between sections from a labelled menu instead of a row of icons", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-phone-lab"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?project=${project.id}`);
    const sections = page.getByRole("combobox", { name: "Section" });
    await expect(sections).toBeVisible();
    await expect(page.locator(".lab-nav > button").first()).toBeHidden();
    await sections.selectOption({ label: "Claims" });
    await expect(page.locator(".claim-row").first()).toBeVisible();
    await expect(sections).toHaveValue("claims");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);

    // Geniş ekranda liste yerinde; menü gizli.
    await page.setViewportSize({ width: 1280, height: 860 });
    await expect(sections).toBeHidden();
    await expect(page.locator(".lab-nav > button", { hasText: "Claims" })).toBeVisible();
  });
});

test.describe("learning layer", () => {
  function withoutLearning(id: string) {
    const project = projectNamed(id) as Partial<ResearchProject>;
    delete project.primer;
    delete project.quiz;
    delete project.misreadings;
    delete project.derivations;
    delete project.interactives;
    delete project.applicationGuide;
    return { ...project, depth: "standard" } as ResearchProject;
  }

  test("offers to add the learning layer to a project without one, and keeps the previous version", async ({ page, request }) => {
    const project = await seed(request, withoutLearning("e2e-learning-layer"));
    const sent: Array<{ blocks: string[]; apiKey: string; assignment: { provider: string } }> = [];
    await page.route("**/api/learning", async (route) => {
      sent.push(route.request().postDataJSON());
      const events = [
        { type: "progress", stage: "story", progress: 40, title: "Writing the quiz.", detail: "Part 2/3 of the learning layer." },
        {
          type: "learning",
          blocks: { primer: example.primer, quiz: example.quiz, misreadings: example.misreadings, derivations: example.derivations },
          failed: [],
          evidenceFingerprint: evidenceFingerprint(project.evidence),
        },
      ];
      await route.fulfill({ status: 200, headers: { "Content-Type": "application/x-ndjson" }, body: events.map((event) => JSON.stringify(event)).join("\n") + "\n" });
    });

    await page.goto(`/?project=${project.id}`);
    // Ön bilgisi olmayan projede Lab'de "Primer" yok; öneri genel bakışta.
    await expect(page.locator(".lab-nav > button", { hasText: "Primer" })).toHaveCount(0);
    const offer = page.getByRole("region", { name: "Learning layer" });
    await expect(offer).toContainText("missing the primer, the quiz, the common misreadings and the derivations");
    await offer.getByRole("button", { name: "Add the learning layer" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".learning-plan li")).toHaveText([/Primer/, /Quiz/, /Common misreadings/, /Derivations/]);
    await dialog.getByLabel("Gemini API key").fill("test-key");
    await dialog.getByRole("button", { name: "Write the learning layer" }).click();
    await expect(dialog).toContainText("Added the primer, the quiz, the common misreadings and the derivations.");
    expect(sent[0]).toMatchObject({ blocks: ["primer", "quiz", "misreadings", "derivations"], apiKey: "test-key", assignment: { provider: "gemini" } });

    await dialog.getByRole("button", { name: "Start with the primer" }).click();
    await expect(page.locator(".primer")).toBeVisible();
    await expect(page.locator(".lab-nav > button", { hasText: "Primer" })).toHaveClass(/active/);

    // Kaydedildi, önceki sürüm geçmişte; öneri kayboldu.
    await expect.poll(async () => {
      const { projects } = (await (await request.get("/api/library")).json()) as { projects: ResearchProject[] };
      return projects.find((item) => item.id === project.id)?.quiz?.questions.length;
    }).toBe(example.quiz!.questions.length);
    await page.locator(".lab-nav > button", { hasText: "Overview" }).click();
    await expect(page.getByRole("region", { name: "Learning layer" })).toHaveCount(0);
    await page.getByRole("button", { name: "Version history" }).click();
    await expect(page.locator(".history-list")).toContainText("Before the learning layer was added");
  });

  test("shows what a hurried reader gets wrong, and asks them to think before showing why", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-misreadings"));
    const item = project.misreadings!.items[0];
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Learn & Try" }).click();
    const block = page.locator("section.misreadings");
    await expect(block.locator("h3")).toHaveText(project.misreadings!.title);
    await expect(block.locator(".misreading")).toHaveCount(project.misreadings!.items.length);
    const first = block.locator(".misreading").first();
    await expect(first.locator(".misreading-trap")).toHaveText("An interpretation read as a result");
    await expect(first.locator(".misreading-text")).toHaveText(`Tempting to conclude: ${item.misreading}`);
    await expect(first.locator(".misreading-sentence")).toHaveText(item.misreading);
    await expect(first).not.toContainText(item.correction);
    await first.getByRole("button", { name: "Why this is wrong" }).click();
    await expect(first.locator(".misreading-correction")).toContainText(item.correction);
    await first.locator(".evidence-note summary").click();
    await expect(first.locator(".evidence-note")).toContainText(project.evidence.claims.find((claim) => claim.id === item.claimIds[0])!.statement);
  });

  test("asks for a prediction before it shows a chart or the next step of a derivation", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-predict"));
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Learn & Try" }).click();

    // Grafik, tahminden sonra açılıyor; cevap formülden hesaplanmış.
    const scaling = page.locator("section.playground", { hasText: "Why the scaling is necessary" });
    await expect(scaling.locator(".playground-chart")).toHaveCount(0);
    const predict = scaling.getByRole("group", { name: "Predict first" });
    await expect(predict).toContainText("as Key dimension d_k goes from 1 to 512");
    await expect(predict.getByRole("button", { name: "Check and show the chart" })).toBeDisabled();
    await predict.getByRole("group", { name: "unscaled", exact: true }).getByRole("button", { name: "It rises", exact: true }).click();
    await predict.getByRole("group", { name: "scaled", exact: true }).getByRole("button", { name: "It falls", exact: true }).click();
    await predict.getByRole("button", { name: "Check and show the chart" }).click();
    await expect(scaling.locator(".playground-chart")).toBeVisible();
    const results = scaling.locator(".predict-results");
    await expect(results).toContainText("1 of 2 predictions right.");
    await expect(results.locator("li.is-right")).toContainText("You called it. It rises: from 0.7311 to 1.0000.");
    await expect(results.locator("li.is-wrong")).toContainText("Not quite. It stays about the same: 0.7311 throughout.");

    const complexity = page.locator("section.playground", { hasText: "When self-attention becomes expensive" });
    await expect(complexity.getByRole("group", { name: /cross\?$/ })).toBeVisible();
    await complexity.getByRole("button", { name: "Just show the chart" }).click();
    await expect(complexity.locator(".playground-chart")).toBeVisible();
    await expect(complexity.locator(".predict-results")).toHaveCount(0);

    // Türetim: sıradaki adım adaylar arasından seçiliyor.
    const steps = project.derivations!.find((item) => item.id === "deriv-scaling")!.steps;
    const derivation = page.locator("article.derivation", { hasText: "Where dividing by √d_k comes from" }).first();
    const choose = (text: string) => derivation.getByRole("group", { name: "Which step comes next?" }).getByRole("button", { name: text, exact: true }).click();
    await choose(steps[1].plain);
    await expect(derivation.locator(".derivation-step").nth(1).locator(".derivation-verdict")).toHaveText("You called it.");
    await choose(steps[5].plain);
    await expect(derivation.locator(".derivation-step").nth(2).locator(".derivation-verdict")).toHaveText(`You picked “${steps[5].plain}”: true, but that is step 6.`);
    await derivation.getByRole("button", { name: "Just show it" }).click();
    await choose(steps[4].plain);
    // Son adımda seçilecek aday kalmıyor.
    await expect(derivation.getByRole("group", { name: "Which step comes next?" })).toHaveCount(0);
    await derivation.locator(".derivation-more").click();
    await expect(derivation.locator(".derivation-score")).toHaveText("You called 2 of 3 steps before seeing them.");
  });

  test("tells the reader which numbers are illustrative and which are the paper's", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-illustrative"));
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Learn & Try" }).click();
    const simulation = page.locator("section.simulation", { hasText: "Attention weights, step by step" });
    await expect(simulation.locator(".illustrative-note")).toHaveText("Illustrative values, not from the paper");
    // Makalenin kendi tablosu ve oyun alanları işaretsiz.
    await expect(page.locator("section.playground .illustrative-note, section.explorer .illustrative-note")).toHaveCount(0);
  });

  test("gives a wrong answer a second chance and says where the paper settles it", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-quiz-retry"));
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Learn & Try" }).click();

    const quiz = page.locator("section.quiz", { hasText: project.quiz!.title });
    const question = quiz.locator(".quiz-question").nth(1);
    const source = project.quiz!.questions[1];
    const wrong = source.options.find((option) => !option.correct)!;
    const right = source.options.find((option) => option.correct)!;
    await question.getByText(wrong.label, { exact: true }).click();
    await question.getByRole("button", { name: "Check answer" }).click();

    // Yanlış: neden yanlış olduğu ve nereye bakılacağı; doğru şık henüz gösterilmiyor.
    await expect(question.locator(".quiz-verdict")).toContainText("Not quite");
    await expect(question).toContainText(wrong.explanation);
    await expect(question.locator(".quiz-option.is-correct")).toHaveCount(0);
    await expect(question).not.toContainText(right.explanation);
    const reread = question.locator(".quiz-reread a").first();
    await expect(reread).toHaveAttribute("href", /^#section-/);

    await question.getByRole("button", { name: "Try again" }).click();
    await question.getByText(right.label, { exact: true }).click();
    await question.getByRole("button", { name: "Check again" }).click();
    await expect(question.locator(".quiz-verdict")).toContainText("Correct on attempt 2");
    await expect(quiz.locator(".quiz-score")).toHaveText("0 of 1 right on the first try");

    // Bağlantı hikâyenin o bölümüne götürüyor.
    const target = (await reread.getAttribute("href"))!;
    await reread.click();
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await expect(page.locator(target)).toBeVisible();
  });

  test("drills reading the evidence, even for a project without a learning layer", async ({ page, request }) => {
    const bare = projectNamed("e2e-drill") as Partial<ResearchProject>;
    for (const block of ["primer", "quiz", "derivations", "interactives", "applicationGuide"] as const) delete bare[block];
    const project = await seed(request, bare as ResearchProject);
    const drill = readingDrillFor(project)!;

    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Learn & Try" }).click();
    const section = page.locator("section.quiz", { hasText: "Read it like a reviewer" });
    await expect(section.locator(".quiz-question")).toHaveCount(drill.questions.length);

    const first = section.locator(".quiz-question").first();
    await first.getByText(drill.questions[0].options.find((option) => option.correct)!.label, { exact: true }).click();
    await first.getByRole("button", { name: "Check answer" }).click();
    await expect(first.locator(".quiz-verdict")).toContainText("Correct");
    await expect(section.locator(".quiz-score")).toHaveText("1 of 1 right on the first try");
  });

  test("opens a term's definition where it is used, and lists what to know before a section", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-terms"));
    await page.goto(`/?project=${project.id}&mode=preview`);
    const scaling = page.locator("section.story-section", { hasText: "Why the scaling was necessary" });
    await expect(scaling.locator(".term-chips")).toContainText("Before this section:");
    await expect(scaling.locator(".term-chip")).toHaveText(["Dot product", "Softmax", "Variance and scale"]);

    const softmax = project.primer!.concepts.find((concept) => concept.term === "Softmax")!;
    await scaling.getByRole("button", { name: "Softmax", exact: true }).first().click();
    const card = scaling.locator(".term-prerequisites .term-card");
    await expect(card).toContainText(softmax.intuition);
    await expect(card).toContainText("Why this paper needs it:");
    await card.getByRole("button", { name: "Close the definition" }).click();
    await expect(card).toHaveCount(0);

    // Sözlük terimi anlatının içinde: ilk geçtiği yerde bir düğme, tanımı paragrafın altında.
    const mark = page.locator(".story-section .term-mark", { hasText: /^self-attention$/i }).first();
    await mark.click();
    await expect(mark).toHaveAttribute("aria-expanded", "true");
    const selfAttention = project.evidence.glossary.find((item) => item.term === "Self-attention")!;
    await expect(page.locator(".story-section .term-card").first()).toContainText(selfAttention.definition);

    // Derin raporda da.
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Deep report" }).click();
    expect(await page.locator(".report-analysis .term-mark").count()).toBeGreaterThan(0);
  });

  test("shows the teaching role in the model team, able to run on any provider", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Model team" }).click();
    const card = page.locator(".task-assignment-card", { hasText: "Teaching and learning material" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("combobox").first().locator("option", { hasText: "Local model" })).not.toHaveAttribute("disabled");
  });
});

test.describe("study mode", () => {
  test("walks the paper step by step, remembers where the reader stopped, and says what to read again", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-study"));
    const path = studyPath(project, readingDrillFor(project));
    const firstSection = path.steps.find((step) => step.kind === "section")!;
    if (firstSection.kind !== "section") throw new Error("no section step");
    const question = path.questions.get(firstSection.checkId!)!;
    const wrong = question.options.find((option) => !option.correct)!;

    await page.goto(`/?project=${project.id}`);
    const offer = page.locator(".study-offer");
    await expect(offer).toContainText(`A guided path in ${path.steps.length} steps`);
    await offer.getByRole("button", { name: "Start studying" }).click();

    const study = page.locator("section.study");
    await expect(study.locator(".study-title")).toHaveText("What this paper asks");
    await expect(study).toContainText(project.evidence.researchQuestion);
    await study.getByRole("button", { name: "Begin →" }).click();
    await expect(study.locator(".study-title")).toHaveText(path.steps[1].kind === "concept" ? path.steps[1].title : "");

    // Doğrudan ilk bölüme; bölüm bir soruyla bitiyor.
    await study.locator(".study-outline summary").click();
    await study.locator(".study-outline button", { hasText: firstSection.title }).click();
    await expect(study.locator(".study-title")).toHaveText(firstSection.title);
    const check = study.locator(".study-check");
    await expect(check).toContainText("Check yourself");
    await expect(study.getByRole("button", { name: "Skip the question →" })).toBeVisible();
    await check.getByText(wrong.label, { exact: true }).click();
    await check.getByRole("button", { name: "Check answer" }).click();
    await expect(check.locator(".quiz-verdict")).toContainText("Not quite");
    await check.getByRole("button", { name: "Show the answer" }).click();
    await expect(check.locator(".quiz-verdict")).toContainText("The answer");
    await study.getByRole("button", { name: "Next →" }).click();
    const secondStep = path.steps[path.steps.indexOf(firstSection) + 1];
    await expect(study.locator(".study-title")).toHaveText(secondStep.kind === "section" ? secondStep.title : "");

    // İlerleme kütüphanede; proje dosyasında değil.
    await expect.poll(async () => {
      const response = await request.get(`/api/library/study?id=${project.id}`);
      const { progress } = (await response.json()) as { progress: { current?: string; answers: Array<{ id: string; revealed: boolean }> } | null };
      return progress && { current: progress.current, answers: progress.answers.map((answer) => [answer.id, answer.revealed]) };
    }).toEqual({ current: secondStep.id, answers: [[question.id, true]] });
    const stored = await (await request.get("/api/library")).json() as { projects: Array<Record<string, unknown>> };
    expect(JSON.stringify(stored.projects.find((item) => item.id === project.id))).not.toContain("studyProgress");

    // Yeniden açınca kaldığı yerden; önceki yanıt hatırlanıyor.
    await page.reload();
    await expect(page.locator(".study-offer")).toContainText(`2 of ${path.steps.length - 1} steps done`);
    await page.locator(".study-offer").getByRole("button", { name: "Continue studying" }).click();
    await expect(study.locator(".study-title")).toHaveText(secondStep.kind === "section" ? secondStep.title : "");
    await study.getByRole("button", { name: "← Back" }).click();
    await expect(study.locator(".study-saved")).toHaveText("Last time: you asked for the answer.");

    // Sonuç: kaçan sorunun bölümü "yeniden bak" listesinde.
    await study.locator(".study-outline summary").click();
    await study.locator(".study-outline button", { hasText: "How it went" }).click();
    const revisit = study.locator(".study-revisit");
    await expect(revisit).toContainText("Worth another look");
    await expect(revisit.locator("button", { hasText: firstSection.title })).toBeVisible();
    await expect(study.locator(".study-result").nth(1)).toHaveText(`0 of 1 question right on the first try; ${path.questions.size - 1} not answered yet.`);
    await revisit.locator("button", { hasText: firstSection.title }).click();
    await expect(study.locator(".study-title")).toHaveText(firstSection.title);

    // Baştan başlamak yolu ve yanıtları siliyor; yanıtlanan sorunun tekrar kartı kalıyor.
    await study.locator(".study-outline summary").click();
    await study.locator(".study-outline button", { hasText: "How it went" }).click();
    await study.getByRole("button", { name: "Start over" }).click();
    await study.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(study.locator(".study-title")).toHaveText("What this paper asks");
    await expect.poll(async () => {
      const { progress } = (await (await request.get(`/api/library/study?id=${project.id}`)).json()) as { progress: StudyProgress | null };
      return progress && { done: progress.done, answers: progress.answers.length, reviews: progress.reviews?.map((review) => review.id) };
    }).toEqual({ done: [], answers: 0, reviews: [`q:${question.id}`] });
  });

  test("lets the reader explain a section in their own words and shows what the evidence says about it", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-explain"));
    const explanation = "Attention scores are dot products divided by the square root of d_k. The paper measured that without this scaling training fails completely.";
    const secondExplanation = "Scores are dot products scaled by one over the square root of d_k; the authors only suspect that large values would hurt training.";
    let sent: { target: { kind: string; sectionId: string }; text: string } | undefined;
    let checks = 0;
    await page.route("**/api/explain", async (route) => {
      sent = route.request().postDataJSON() as typeof sent;
      checks += 1;
      const feedback = checks === 1
        ? {
            summary: "The formula is right; the paper never measured a failure without the scaling.",
            covered: [{ claimId: "claim-method-05", note: "Your first sentence gives the scaled dot product." }],
            missed: [],
            misstated: [{ quote: "The paper measured that without this scaling training fails completely.", claimId: "claim-interpretation-01", correction: "The authors only suspect it; the scaling is a precaution." }],
            unsupported: [],
          }
        : {
            summary: "Both points, and the scaling is now a precaution.",
            covered: [{ claimId: "claim-method-05", note: "The formula." }, { claimId: "claim-interpretation-01", note: "Now a suspicion, as in the paper." }],
            missed: [],
            misstated: [],
            unsupported: [],
          };
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback, coverage: { covered: feedback.covered.length, total: 2 }, model: "gemini-3.7-flash" }),
      });
    });
    const savedExplanations = async () => {
      const { progress } = (await (await request.get(`/api/library/study?id=${project.id}`)).json()) as { progress?: StudyProgress };
      return progress?.explanations?.map((item) => item.text) ?? [];
    };

    await page.goto(`/?project=${project.id}`);
    await page.locator(".study-offer").getByRole("button", { name: "Start studying" }).click();
    const study = page.locator("section.study");
    await study.locator(".study-outline summary").click();
    await study.locator(".study-outline button", { hasText: "Why the scaling was necessary" }).click();
    const panel = study.locator("details.explain");
    await panel.locator("summary").click();
    await expect(panel.getByRole("button", { name: "Check my explanation" })).toBeDisabled();
    await panel.getByLabel("Your explanation").fill(explanation);
    await panel.getByLabel("Gemini API key").fill("test-key");
    await panel.getByRole("button", { name: "Check my explanation" }).click();

    const result = panel.getByRole("region", { name: "How your explanation compares with the evidence" });
    await expect(result.locator(".explain-coverage")).toHaveText("1 of 2 claims this section rests on are in your explanation.");
    await expect(result.locator(".explain-group.is-misstated")).toContainText("“The paper measured that without this scaling training fails completely.”");
    await expect(result).toContainText("Checked by gemini-3.7-flash against the evidence only; it has not read the paper.");
    expect(sent).toMatchObject({ target: { kind: "story", sectionId: "story-attention" }, text: explanation });

    // İddiaya tıklamak kanıt çekmecesini açıyor.
    await result.locator(".explain-group.is-covered button").click();
    await expect(page.locator(".evidence-drawer")).toContainText(project.evidence.claims.find((claim) => claim.id === "claim-method-05")!.statement);

    // Anlatış çalışma kaydında; projede değil.
    await expect.poll(savedExplanations).toEqual([explanation]);
    await expect(panel.locator(".explain-history > summary")).toHaveText("Your earlier explanations (1)");

    // Bir süre sonra yeniden: neyin eklendiğini kod karşılaştırıyor.
    await panel.getByLabel("Your explanation", { exact: true }).fill(secondExplanation);
    await panel.getByRole("button", { name: "Check my explanation" }).click();
    const change = result.getByRole("region", { name: "Since your last explanation" });
    await expect(change.locator(".explain-change-coverage")).toHaveText("1 of 2 → 2 of 2 claims conveyed.");
    await expect(change.locator(".explain-group.is-covered")).toContainText(project.evidence.claims.find((claim) => claim.id === "claim-interpretation-01")!.statement);
    await expect.poll(savedExplanations).toEqual([explanation, secondExplanation]);

    // Sayfa yeniden açılınca geçmiş orada, en yenisi önce; istenirse unutuluyor.
    // (Adres seçili iddiayı taşıyor; sayfa onun bölümünde açılıyor, çalışmaya menüden dönülüyor.)
    await page.reload();
    await page.locator(".lab-nav > button", { hasText: "Study" }).click();
    const again = page.locator("section.study details.explain");
    await again.locator("summary").first().click();
    const history = again.locator(".explain-history");
    await history.locator("summary").click();
    await expect(history.locator(".explain-history-text")).toHaveText([secondExplanation, explanation]);
    await expect(history.locator(".explain-history-meta").first()).toContainText("conveyed 2 of 2 claims");
    await history.getByRole("button", { name: "Forget these" }).click();
    await history.getByRole("group", { name: "Forget these explanations" }).getByRole("button", { name: "Forget" }).click();
    await expect(again.locator(".explain-history")).toHaveCount(0);
    await expect.poll(savedExplanations).toEqual([]);
  });

  test("works in a published page too, keeping progress in the reader's browser", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-study-published"));
    const created = await request.post("/api/publications", {
      data: {
        projectId: project.id,
        settings: { include: { deepReport: true, technicalAppendix: true, learning: true, figures: false }, expiresAt: null },
      },
    });
    const { publication } = (await created.json()) as { publication: { path: string } };
    const path = studyPath(project, readingDrillFor(project));

    await page.goto(publication.path);
    await page.locator(".viewer-tabs button", { hasText: "Study" }).click();
    const study = page.locator("section.study");
    await expect(study).toContainText("Your progress stays in this browser.");
    await study.getByRole("button", { name: "Begin →" }).click();
    await study.getByRole("button", { name: "Next →" }).click();
    await expect(study.locator(".study-meta")).toContainText(`Step 3 of ${path.steps.length}`);

    await page.reload();
    await page.locator(".viewer-tabs button", { hasText: "Study" }).click();
    await expect(page.locator("section.study .study-meta")).toContainText(`Step 3 of ${path.steps.length}`);
    await expect(page.locator("section.study .study-bar")).toHaveAttribute("aria-valuenow", "2");
  });
});

test.describe("review", () => {
  /** Üç gün önce çalışılmış gibi: yanlış yanıtlanan soru ve okunan kavram bugün vadeli. */
  const threeDaysAgo = () => new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  async function studied(request: APIRequestContext, project: ResearchProject, withConcept: boolean) {
    const at = threeDaysAgo();
    let progress: StudyProgress = recordAnswer(undefined, project.quiz!.questions[0], { correct: false, attempts: 1, revealed: true }, at);
    if (withConcept) progress = completeStep(progress, `concept:${project.primer!.concepts[0].id}`, "start", at);
    const response = await request.put(`/api/library/study?id=${project.id}`, { data: { progress } });
    expect(response.ok()).toBe(true);
  }

  test("brings back what was studied, across the library, mixing papers", async ({ page, request }) => {
    const first = await seed(request, projectNamed("e2e-review-a"));
    const second = await seed(request, { ...projectNamed("e2e-review-b"), evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "A second paper to review" } } });
    await studied(request, first, true);
    await studied(request, second, false);

    await page.goto("/?library=1");
    const badge = page.locator(".library-review");
    await expect(badge).toContainText("3");
    await expect(badge).toContainText("cards to review");
    await badge.click();
    await expect(page.locator(".compare-hero h1")).toHaveText("3 cards to review from 2 papers.");

    const papers: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const card = page.locator(".review-card");
      await expect(card.locator(".review-count")).toHaveText(`${index + 1} / 3`);
      papers.push((await card.locator(".review-paper").textContent()) ?? "");
      if ((await card.locator(".review-kind").textContent()) === "Question") {
        const question = example.quiz!.questions[0];
        await card.getByText(question.options.find((option) => option.correct)!.label, { exact: true }).click();
        await card.getByRole("button", { name: "Check answer" }).click();
        await expect(card.locator(".review-card-foot")).toContainText("Remembered. This card comes back in 3 days.");
      } else {
        await expect(card.locator(".review-concept h2")).toHaveText(example.primer!.concepts[0].term);
        await card.getByRole("button", { name: "Show the answer" }).click();
        await expect(card).toContainText(example.primer!.concepts[0].intuition);
        await card.getByRole("button", { name: "Not yet" }).click();
        await expect(card.locator(".review-card-foot")).toContainText("Not yet. This card comes back tomorrow.");
      }
      await card.getByRole("button", { name: index < 2 ? "Next card" : "Finish" }).click();
    }
    // Aynı makalenin kartları arka arkaya gelmiyor.
    expect(papers[0]).not.toBe(papers[1]);
    await expect(page.locator(".compare-hero h1")).toHaveText("Done for now.");
    await expect(page.locator(".review-empty")).toContainText("You remembered 2 of 3 cards.");
    await expect(page.locator(".review-empty")).toContainText("The next review is tomorrow.");

    // Sonuçlar makalelerin kaydına yazıldı; kütüphane artık vadeli kart göstermiyor.
    await expect.poll(async () => {
      const { progress } = (await (await request.get(`/api/library/study?id=${first.id}`)).json()) as { progress: StudyProgress };
      return progress.reviews!.map((review) => [review.id, review.box]).sort();
    }).toEqual([[`c:${first.primer!.concepts[0].id}`, 0], [`q:${first.quiz!.questions[0].id}`, 1]]);
    await page.getByRole("button", { name: "Library" }).first().click();
    await expect(page.locator(".library-review")).toContainText("to review · next tomorrow");
  });

  test("reviews one paper from its Lab, and starting the path over keeps the cards", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-review-lab"));
    await studied(request, project, true);

    await page.goto(`/?project=${project.id}`);
    await page.locator(".study-offer").getByRole("button", { name: "Review 2 cards" }).click();
    await expect(page.locator(".landing-eyebrow")).toContainText(`Review · ${project.evidence.paper.title}`);
    await expect(page.locator(".compare-hero h1")).toHaveText("2 cards to review.");
    await page.locator(".review-card").getByRole("button", { name: "Skip for now" }).click();
    await page.locator(".review-card").getByRole("button", { name: "Skip for now" }).click();
    await expect(page.locator(".review-empty")).toContainText("You skipped every card; they stay due.");
    await page.getByRole("button", { name: "Back to the paper" }).first().click();
    await expect(page.locator(".study-offer")).toBeVisible();

    await page.locator(".study-offer").getByRole("button", { name: "Continue studying" }).click();
    const study = page.locator("section.study");
    await study.locator(".study-outline summary").click();
    await study.locator(".study-outline button", { hasText: "How it went" }).click();
    await study.getByRole("button", { name: "Start over" }).click();
    await study.getByRole("button", { name: "Clear", exact: true }).click();
    await expect.poll(async () => {
      const { progress } = (await (await request.get(`/api/library/study?id=${project.id}`)).json()) as { progress: StudyProgress | null };
      return progress && { done: progress.done, answers: progress.answers.length, reviews: progress.reviews?.length };
    }).toEqual({ done: [], answers: 0, reviews: 2 });
  });
});

test.describe("learning health", () => {
  test("finds what a reader cannot learn from, and opens the fix with the request filled in", async ({ page, request }) => {
    const project = projectNamed("e2e-learning-health");
    const [first, ...rest] = project.derivations!;
    project.derivations = [{ ...first, steps: first.steps.map((step, index) => (index === 1 ? { ...step, rationale: step.plain } : step)) }, ...rest];
    await seed(request, project);
    let sent: { target: { kind: string }; claimPolicy: string; instruction: string } | undefined;
    await page.route("**/api/regenerate", async (route) => {
      sent = route.request().postDataJSON() as typeof sent;
      await route.fulfill({ status: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Not in this test." }) });
    });

    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Learning health" }).click();
    const panel = page.locator(".learning-health");
    const unchecked = panel.locator(".health-block", { hasText: "Sections no question checks" });
    await expect(unchecked).toContainText("A recipe running from 12 hours to 3.5 days");
    await expect(panel.locator(".health-block", { hasText: "Derivation steps that only restate their formula" })).toContainText(first.title);
    await expect(panel.locator(".health-stat", { hasText: "Sections a question checks" })).toContainText("7/8");

    await unchecked.getByRole("button", { name: "Point a question here" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Regenerate quiz question" })).toBeVisible();
    await expect(dialog.locator("textarea")).toHaveValue(/tests the section "A recipe running from 12 hours to 3\.5 days"/);
    await expect(dialog.getByRole("radio", { name: /Choose from all evidence/ })).toBeChecked();
    await dialog.getByLabel("Gemini API key").fill("test-key");
    await dialog.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect.poll(() => sent?.claimPolicy).toBe("open");
    expect(sent!.target.kind).toBe("quiz");
    expect(sent!.instruction).toContain("claim-method-09");
    await dialog.getByRole("button", { name: "Close" }).click();

    await panel.getByRole("button", { name: "Rewrite derivation" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Regenerate derivation" })).toBeVisible();
    await expect(page.getByRole("dialog").locator("textarea")).toHaveValue(/Give every step a rationale/);
  });
});

test.describe("concepts across the library", () => {
  test("orders the library so a paper comes after the one that defines what it assumes", async ({ page, request }) => {
    const foundations = await seed(request, {
      ...projectNamed("e2e-order-a"),
      evidence: {
        ...example.evidence,
        paper: { ...example.evidence.paper, title: "Zeta foundations", year: "2015" },
        glossary: [{ term: "Zeta attention", definition: "Attention over zeta-sized windows." }],
      },
    });
    const base = projectNamed("e2e-order-b");
    const applied = await seed(request, {
      ...base,
      evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Zeta applied", year: "2019" } },
      primer: { ...base.primer!, concepts: base.primer!.concepts.map((concept) => (concept.id === "softmax" ? { ...concept, term: "Zeta attention" } : concept)) },
    });

    // Lab: bu makaleden önce okunacak olan.
    await page.goto(`/?project=${applied.id}`);
    await page.locator(".lab-nav > button", { hasText: "Concepts" }).click();
    const first = page.getByRole("region", { name: "Read first" });
    await expect(first.locator("li")).toHaveCount(1);
    await expect(first.locator("li")).toContainText("Zeta foundations");
    await expect(first.locator("li")).toContainText("2015 · defines Zeta attention");
    await expect(first.locator(".read-first-status")).toHaveText("Not studied yet");

    // Kütüphane: okuma sırası.
    await page.goto("/?library=1");
    await page.getByRole("button", { name: "Concepts", exact: true }).click();
    const order = page.getByRole("region", { name: "A reading order" });
    // `allTextContents` beklemiyor: önce iki makalenin de listede olması bekleniyor.
    await expect(order.locator(".reading-head button", { hasText: "Zeta applied" })).toBeVisible();
    await expect(order.locator(".reading-head button", { hasText: "Zeta foundations" })).toBeVisible();
    const titles = await order.locator(".reading-head button").allTextContents();
    expect(titles.indexOf("Zeta foundations")).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf("Zeta foundations")).toBeLessThan(titles.indexOf("Zeta applied"));
    const step = order.locator("li", { has: page.locator(".reading-head button", { hasText: "Zeta applied" }) });
    await expect(step.locator(".reading-why")).toHaveText("After Zeta foundations: it assumes Zeta attention, which that paper defines.");
    await order.locator(".reading-head button", { hasText: "Zeta foundations" }).click();
    await expect(page.locator(".lab-section-header h1")).toHaveText(foundations.evidence.paper.title);
  });

  test("says where the reader already studied a concept, suggests cited papers for the rest, and maps the library", async ({ page, request }) => {
    // Kütüphane diğer testlerin kopyalarını da taşıyor; bu iki makaleye özgü adlar eşleşmeyi yalnızca onlarla sınırlıyor.
    const rename = (project: ResearchProject, terms: Record<string, string>) => ({
      ...project,
      primer: { ...project.primer!, concepts: project.primer!.concepts.map((concept) => ({ ...concept, term: terms[concept.id] ?? concept.term })) },
    });
    const first = await seed(request, rename(projectNamed("e2e-concepts-a"), { softmax: "Zeta softmax", "dot-product": "Zeta dot product" }));
    const second = await seed(request, {
      ...rename(projectNamed("e2e-concepts-b"), { softmax: "Zeta softmax", "dot-product": "Zeta dot products", variance: "Zeta variance only here" }),
      evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Zeta dot products: a second paper" } },
    });
    const progress = completeStep(undefined, "concept:softmax", "concept:variance", new Date().toISOString());
    expect((await request.put(`/api/library/study?id=${second.id}`, { data: { progress } })).ok()).toBe(true);
    await page.route("**/api/citations", async (route) => {
      const node = (title: string, year: number, citationCount: number, abstract?: string) => ({ openAlexId: title, title, year, citationCount, authors: [], authorCount: 0, pdfAvailable: true, identifier: title, ...(abstract ? { abstract } : {}) });
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: true, retrievedAt: new Date().toISOString(), source: "OpenAlex", paper: node(first.evidence.paper.title, 2017, 1),
          referenceCount: 4, citedByCount: 0, citedBy: [], note: "", openAlexUrl: "",
          references: [
            node("Layer Normalization", 2016, 10_000), node("Deep Residual Learning for Image Recognition", 2016, 200_000),
            node("Adam: A Method for Stochastic Optimization", 2015, 100_000), node("Zeta Dot Products: A Second Paper", 2018, 12),
            node("A Deep Reinforced Model for Abstractive Summarization", 2017, 900, "Attentional, RNN-based encoder-decoder models for abstractive summarization have achieved good performance. We go further."),
          ],
        }),
      });
    });

    await page.goto(`/?project=${first.id}`);
    await page.locator(".lab-nav > button", { hasText: "Concepts" }).click();
    // Satırlar terimle seçiliyor: ikinci makalenin başlığı da "Zeta dot products" diye başlıyor.
    const row = (term: string) => page.locator(".concept-rows li").filter({ has: page.locator("strong", { hasText: new RegExp(`^${term}$`) }) });
    const softmax = row("Zeta softmax");
    await expect(softmax.locator(".concept-status")).toHaveText("Studied in another paper");
    await expect(softmax.locator(".concept-where")).toHaveText("Zeta dot products: a second paper ✓");
    await expect(row("Zeta dot product").locator(".concept-status")).toHaveText("In 1 other paper, not studied yet");

    await page.getByRole("button", { name: "Look in the references" }).click();
    const suggestion = page.locator(".concept-suggestions li", { hasText: "Layer Normalization" });
    await expect(suggestion.locator(".concept-for")).toHaveText("Residual connections and layer normalisation");
    await expect(suggestion).toContainText("the title names “layer normalization”");
    await expect(suggestion.getByRole("button", { name: "Analyze it" })).toBeVisible();
    await expect(page.locator(".concept-suggestions li", { hasText: "Deep Residual Learning" })).toHaveCount(0);
    // Başlıkta değil özette anılan kavram: eşleşme ayrı etiketle ve özetteki cümlesiyle.
    const fromAbstract = page.locator(".concept-suggestions li", { hasText: "A Deep Reinforced Model" });
    await expect(fromAbstract.locator(".concept-for")).toHaveText("Encoder-decoder and auto-regression");
    await expect(fromAbstract).toContainText("its abstract names “encoder decoder”");
    await expect(fromAbstract.locator(".concept-excerpt")).toHaveText("Attentional, RNN-based encoder-decoder models for abstractive summarization have achieved good performance.");
    // Kütüphanede zaten olan bir çalışma analiz edilmiyor, açılıyor.
    const owned = page.locator(".concept-suggestions li", { hasText: "Zeta Dot Products: A Second Paper" });
    await expect(owned.locator(".concept-for")).toHaveText("Zeta dot product");
    await expect(owned).toContainText("already in your library");
    await expect(owned.getByRole("link", { name: "Open it" })).toHaveAttribute("href", `/?project=${second.id}`);
    await expect(owned.getByRole("button", { name: "Analyze it" })).toHaveCount(0);

    // Ön bilgide de: kavramın kütüphanedeki izi.
    await page.locator(".lab-nav > button", { hasText: "Primer" }).click();
    await page.locator(".primer-item button", { hasText: "Zeta softmax" }).click();
    await expect(page.locator(".primer-item.is-open .concept-note")).toContainText("You studied this in Zeta dot products: a second paper");

    // Kütüphanenin kavram haritası.
    await page.goto("/?library=1");
    await page.getByRole("button", { name: "Concepts", exact: true }).click();
    const zeta = page.locator(".shared-concepts > li", { hasText: /zeta softmax/i });
    await expect(zeta.locator(".shared-concept-head span")).toHaveText("2 papers");
    await expect(zeta.locator(".shared-concept-papers button")).toHaveCount(2);
    await expect(zeta.locator(".shared-concept-papers button.is-studied")).toContainText("Zeta dot products: a second paper");
    await zeta.locator(".shared-concept-papers button", { hasText: "Attention Is All You Need" }).click();
    await expect(page.locator(".lab-section-header h1")).toHaveText(first.evidence.paper.title);
  });
});
