import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { evidenceFingerprint } from "../src/lib/section-regeneration";
import type { ResearchProject } from "../src/lib/schema";
import { UNDO_WINDOW_MS } from "../src/lib/pending-deletion";
import { TRACE_ACCENT_PALETTE } from "../src/lib/trace-storage";
import { readingDrillFor } from "../src/lib/reading-drill";
import { REWRITE_PRESETS } from "../src/lib/rewrite-presets";
import { completeStep, questionSignature, recordAnswer, studyPath, visitStep, type StudyProgress } from "../src/lib/study-path";
import { emptyTestLibrary } from "./fresh-library";
import type { Profile } from "../src/lib/profile";
import { dayKey as dayKeyOf, type WorkLog } from "../src/lib/work-log";

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

// Her test yalnızca kendi eklediğini görüyor.
test.beforeEach(() => emptyTestLibrary());

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

test.describe("test isolation", () => {
  // İki test sırayla koşuyor: ilkinin bıraktığı hiçbir şey ikincide yok.
  test("leaves a paper, a tag, study progress and a concept alias behind", async ({ request }) => {
    const project = await seed(request, projectNamed("e2e-left-behind"));
    expect((await request.put(`/api/library/tags?id=${project.id}`, { data: { tags: ["Left behind"] } })).ok()).toBe(true);
    const progress = completeStep(undefined, "start", "next", new Date().toISOString());
    expect((await request.put(`/api/library/study?id=${project.id}`, { data: { progress } })).ok()).toBe(true);
    const [a, b] = project.primer!.concepts;
    expect((await request.put("/api/library/aliases", { data: { a: a.term, b: b.term, decision: "same" } })).ok()).toBe(true);
  });

  test("starts the next test with an empty library", async ({ request }) => {
    expect((await (await request.get("/api/library")).json()).projects).toEqual([]);
    expect((await (await request.get("/api/library/study")).json()).projects).toEqual([]);
    expect((await (await request.get("/api/library/tags")).json()).projects).toEqual([]);
    const aliases = await (await request.get("/api/library/aliases")).json();
    expect(aliases.decisions).toEqual([]);
    expect(aliases.names).toEqual([]);
  });
});

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

  test("searches your own notes and highlights across the library, and opens where they are", async ({ page, request }) => {
    const first = await seed(request, projectNamed("e2e-note-search-a"));
    const second = await seed(request, { ...projectNamed("e2e-note-search-b"), evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Second noted paper" } } });
    const at = new Date().toISOString();
    // Eşit puanda en yeni not önce.
    const earlier = new Date(Date.now() - 3_600_000).toISOString();
    const claim = first.evidence.claims[0];
    const notesOf = (notes: unknown[]) => ({ data: { notes } });
    expect((await request.put(`/api/library/notes?id=${first.id}`, notesOf([
      { id: "n1", target: { kind: "section", place: "report", sectionId: first.deepReport!.sections[0].id }, quote: "the scaling keeps the gradients alive", text: "Wombat question for the reading group.", color: "green", createdAt: at, updatedAt: at },
      { id: "n2", target: { kind: "claim", claimId: claim.id }, text: "Is the wombat gain significant?", color: "yellow", createdAt: at, updatedAt: at },
    ]))).ok()).toBe(true);
    expect((await request.put(`/api/library/notes?id=${second.id}`, notesOf([
      { id: "n3", target: { kind: "section", place: "concept", sectionId: second.primer!.concepts[0].id }, quote: "a wombat example of a dot product", color: "pink", createdAt: earlier, updatedAt: earlier },
    ]))).ok()).toBe(true);

    await page.goto("/?library=1");
    await page.getByRole("group", { name: "Search in" }).getByRole("button", { name: "Your notes" }).click();
    await expect(page.locator(".library-empty h2")).toHaveText("Search what you noted.");
    await page.getByLabel("Search your notes").fill("WOMBAT");
    const hits = page.locator(".note-hit");
    await expect(hits).toHaveCount(3);
    await expect(page.locator(".library-toolbar > span")).toHaveText("3 notes in 2 papers");
    await expect(page.locator(".note-hit .claim-hit-source small")).toHaveText(["Deep report", "Claim", "Primer"]);
    await expect(hits.nth(2)).toContainText(second.primer!.concepts[0].term);
    await expect(hits.first().locator("mark")).toHaveText(["Wombat"]);
    await page.getByLabel("Search your notes").fill("wombat reading group");
    await expect(hits).toHaveCount(1);

    // Bölüm notu Lab'in notlarını açıyor; iddia notu iddianın kendisini.
    await hits.first().getByRole("button").click();
    await expect(page.locator(".lab-nav > button.active")).toContainText("Notes (2)");
    await page.goto("/?library=1");
    await page.getByRole("group", { name: "Search in" }).getByRole("button", { name: "Your notes" }).click();
    await page.getByLabel("Search your notes").fill("significant");
    await page.locator(".note-hit").first().getByRole("button").click();
    await expect(page.locator(".claim-row.selected")).toContainText(claim.statement.slice(0, 40));
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
    for (const url of ["/", "/?library=1", `/?project=${project.id}`, `/?project=${project.id}&mode=story`, `/?project=${project.id}&mode=preview`, "/?focus=1", "/?profile=1"]) {
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
    for (const url of ["/", "/?library=1", `/?project=${project.id}`, `/?project=${project.id}&mode=preview`, "/?focus=1", "/?profile=1"]) {
      await page.goto(url);
      await expect(page.locator(".boot-screen")).toHaveCount(0);
      // Izgara sütunları içeriğin en küçük genişliğine göre büyüyüp ekranı aşıyordu.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), url).toBe(0);
    }
  });

  test("keeps the paper header's buttons clear of the mode tabs at every width, with a timer running too", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-header-fit"));
    const measure = () =>
      page.evaluate(() => {
        const box = (element: Element) => element.getBoundingClientRect();
        const tabs = box(document.querySelector(".mode-tabs")!);
        const buttons = [...document.querySelectorAll(".workspace-actions > *, .workspace-actions .studio-nav > *")].map(box).filter((item) => item.width > 0);
        // Aynı satırdaki düğmeler sekmelerin sağında başlıyor; hiçbiri ekrandan taşmıyor.
        const beside = buttons.filter((item) => Math.abs(item.top - tabs.top) < 30);
        return { overlap: beside.some((item) => item.left < tabs.right - 1 && item.right > tabs.left + 1), overflow: document.documentElement.scrollWidth - window.innerWidth };
      });
    for (const running of [false, true]) {
      if (running) {
        await page.goto("/?focus=1");
        await page.getByRole("button", { name: "Start focus" }).click();
      }
      for (const [width, size] of [[390, "larger"], [761, "normal"], [900, "larger"], [1000, "normal"], [1100, "larger"], [1300, "normal"], [1480, "normal"], [1480, "larger"], [1700, "normal"], [1920, "larger"]] as const) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/?project=${project.id}`);
        await page.evaluate((value) => window.localStorage.setItem("trace-text-size", value), size);
        await page.reload();
        await expect(page.locator(".workspace-actions")).toBeVisible();
        expect(await measure(), `${width}px, ${size} text${running ? ", timer running" : ""}`).toEqual({ overlap: false, overflow: 0 });
        // Profil resmi, etiketleri gizleyen kurala takılmıyor (telefonda profil kütüphaneden açılıyor).
        if (width > 600) await expect(page.locator(".workspace-actions .focus-avatar")).toBeVisible();
      }
    }
  });

  test("keeps the paper map's source count below its sections, however many there are", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-nav-fit"));
    for (const [width, height] of [[1483, 812], [1280, 640], [1100, 560]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/?project=${project.id}`);
      const count = page.locator(".lab-nav > .source-count");
      await expect(count).toBeVisible();
      // Konum menünün içinde: menü kaysa da sıra aynı.
      const overlap = await page.evaluate(() => {
        const box = document.querySelector<HTMLElement>(".lab-nav > .source-count")!;
        return [...document.querySelectorAll<HTMLElement>(".lab-nav > button")].some((button) => button.offsetTop + button.offsetHeight > box.offsetTop);
      });
      expect(overlap, `${width}×${height}`).toBe(false);
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

  /**
   * Ölçülecek ekranların verisi: iddia kararları, çalışma kaydı ve unutulan
   * kartlar (Progress, tekrar), aynı kavramı anlatan ikinci bir makale (kavram
   * haritası, okuma sırası) ve okuyucunun bağladığı iki ad.
   */
  async function seedContrastLibrary(request: APIRequestContext, theme: string) {
    const project = projectNamed(`e2e-contrast-${theme}`);
    project.claimReviews = {
      [project.evidence.claims[0].id]: { status: "approved", by: "Ada", at: "2026-09-01T00:00:00.000Z" },
      [project.evidence.claims[1].id]: { status: "rejected", by: "Ada", at: "2026-09-01T00:00:00.000Z" },
    };
    await seed(request, project);
    // Öncül makale: kavramları sözlüğünde tanımlıyor, ön bilgisi yok; okuma sırasında önce geliyor.
    const companion: ResearchProject = {
      ...projectNamed(`e2e-contrast-${theme}-companion`),
      evidence: {
        ...example.evidence,
        paper: { ...example.evidence.paper, title: "Contrast companion", year: "2014" },
        glossary: [...example.evidence.glossary, { term: "Contrast scaled scores", definition: "Scores divided by the square root of their dimension." }],
      },
      primer: undefined,
    };
    await seed(request, companion);
    const concept = project.primer!.concepts[0];
    const question = project.quiz!.questions[0];
    const now = Date.now();
    const iso = (days: number) => new Date(now + days * 86_400_000).toISOString();
    const progress: StudyProgress = {
      ...completeStep(undefined, `concept:${concept.id}`, "next", iso(-20)),
      reviews: [
        { id: `c:${concept.id}`, box: 0, due: iso(-1), lapses: 2, reviews: 3, last: iso(-2) },
        { id: `q:${question.id}`, box: 4, due: iso(3), lapses: 0, reviews: 4, last: iso(-3), sig: questionSignature(question) },
      ],
    };
    expect((await request.put(`/api/library/study?id=${project.id}`, { data: { progress } })).ok()).toBe(true);
    expect((await request.put(`/api/library/study?id=${companion.id}`, { data: { progress: { ...completeStep(undefined, "start", "finish", iso(-9)), finishedAt: iso(-8) } } })).ok()).toBe(true);
    // Kavram haritasındaki okuma sırasında kaydedilmiş iki çalışma: biri sırada, biri dışında.
    for (const item of [
      { id: "arxiv:2001.00002", title: "A saved work on attention", identifier: "arxiv:2001.00002", year: 2018, url: "https://example.org/w", from: [{ projectId: project.id, relation: "reference" }], addedAt: iso(-1) },
      { id: "title:a saved work without a place", title: "A saved work without a place", from: [], addedAt: iso(-1) },
    ]) expect((await request.post("/api/library/reading-list", { data: { item } })).ok()).toBe(true);
    // Notlar ekranı dolu görünsün: vurgu, not ve işaretli iddia.
    const noted = { createdAt: iso(-1), updatedAt: iso(-1) };
    expect((await request.put(`/api/library/notes?id=${project.id}`, { data: { notes: [
      { id: "c1", target: { kind: "section", place: "report", sectionId: project.deepReport!.sections[0].id }, quote: "a highlighted line", text: "Why does this hold?", color: "purple", ...noted },
      { id: "c2", target: { kind: "claim", claimId: project.evidence.claims[0].id }, text: "Check against the ablation.", ...noted },
      { id: "c3", target: { kind: "claim", claimId: project.evidence.claims[1].id }, ...noted },
    ] } })).ok()).toBe(true);
    expect((await request.put("/api/library/aliases", { data: { a: project.primer!.concepts[1].term, b: "Contrast scaled scores", decision: "same" } })).ok()).toBe(true);
    // Çalışma saati ve profil: açık renkli dolgular (koyu yazı) ve koyu olanlar (beyaz yazı), bir alarm, bir yıllık kayıt.
    const { profile } = (await (await request.get("/api/profile")).json()) as { profile: Profile };
    expect((await request.put("/api/profile", {
      data: {
        profile: {
          ...profile,
          firstName: "Ada",
          lastName: "Lovelace",
          title: "PhD student",
          field: "Machine learning",
          bio: "Reading about attention.",
          preferences: { ...profile.preferences, color: "yellow", sound: "none", colors: { focus: "sky", timer: "lilac", stopwatch: "navy", alarm: "burgundy" } },
          alarms: [{ id: "contrast", time: "07:30", label: "Start reading", days: [1, 2, 3, 4, 5], enabled: true, color: "burgundy" }],
        },
      },
    })).ok()).toBe(true);
    const worked = Array.from({ length: 40 }, (_, index) => {
      const begin = now - (index * 7 + 1) * 86_400_000;
      return { id: `contrast-${index}`, start: iso((begin - now) / 86_400_000), end: new Date(begin + (index % 5 + 1) * 40 * 60_000).toISOString(), kind: "focus", label: "Contrast reading" };
    });
    expect((await request.post("/api/profile/sessions", { data: { sessions: worked } })).ok()).toBe(true);
    return project;
  }

  /** Bu tarayıcıdaki sayaçlar: duraklatılmış bir tur, geri sayım, turları olan kronometre ve iki bildirim. */
  const focusStore = (at: number) => JSON.stringify({
    version: 1,
    lastAlive: at,
    alarmCheck: at,
    snoozes: [],
    pending: [],
    focus: { phase: "work", completed: 2, clock: { running: false, since: 0, elapsed: 600_000 }, duration: 1_500_000, waiting: false, finished: false, label: "Chapter 3" },
    timer: { duration: 600_000, clock: { running: false, since: 0, elapsed: 120_000 }, done: false, label: "Tea" },
    stopwatch: { clock: { running: false, since: 0, elapsed: 185_000 }, laps: [60_000, 125_000, 185_000] },
    alerts: [
      { id: "contrast-phase", kind: "phase", title: "Time for a break", body: "Focus round 2 done.", color: "yellow", at, ringUntil: 0, action: "skip-break" },
      { id: "contrast-alarm", kind: "alarm", title: "07:30 · Start reading", body: "Your alarm is ringing.", color: "navy", at, ringUntil: 0, action: "snooze" },
    ],
  });

  for (const theme of ["dark", "light"] as const) {
    test(`keeps every visible text readable in the ${theme} theme`, async ({ page, request }) => {
      test.setTimeout(90_000);
      const project = await seedContrastLibrary(request, theme);
      await page.addInitScript((chosen) => { if (chosen !== "light") window.localStorage.setItem("trace-theme", chosen); }, theme);
      await page.route("**/api/library/aliases/propose", async (route) => {
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposals: [{
              a: { term: "Softmax", paper: project.evidence.paper.title, definition: "Turns scores into weights." },
              b: { term: "Normalised exponential", paper: "Contrast companion", definition: "Turns scores into weights that sum to one." },
              why: "Both definitions describe the same function.",
            }],
            names: 20,
            parts: 2,
            failedParts: 0,
            unread: 0,
            model: "gemini-3.7-flash",
          }),
        });
      });
      type Screen = { name: string; url: string; section?: string; ready?: string; open?: () => Promise<void> };
      const lab = (section: string, ready?: string): Screen => ({ name: section, url: `/?project=${project.id}`, section, ready });
      const screens: Screen[] = [
        { name: "home", url: "/" },
        { name: "library", url: "/?library=1", ready: ".library-card" },
        { name: "lab", url: `/?project=${project.id}` },
        lab("Study"),
        lab("Primer"),
        lab("Concepts", ".concept-rows li"),
        lab("Learn & Try"),
        lab("Claims"),
        lab("Learning health"),
        lab("Review"),
        lab("Notes", ".note-item"),
        lab("Evidence health"),
        { name: "story", url: `/?project=${project.id}&mode=story` },
        { name: "preview", url: `/?project=${project.id}&mode=preview` },
        { name: "progress", url: "/?progress=1", ready: ".stats-table" },
        {
          name: "review cards",
          url: "/?review=1",
          ready: ".review-card",
          // Kartın yanıtı da ölçülsün: açıklama ve "hatırladım" düğmeleri ancak açılınca görünüyor.
          open: async () => { await page.getByRole("button", { name: "Show the answer" }).click(); },
        },
        {
          name: "concept map",
          url: "/?library=1",
          ready: ".alias-proposals li",
          open: async () => {
            await page.getByRole("button", { name: "Concepts", exact: true }).click();
            await expect(page.locator(".reading-order li").first()).toBeVisible();
            const panel = page.getByRole("region", { name: "Names for the same concept" });
            await expect(panel.locator(".alias-links li").first()).toBeVisible();
            await panel.locator(".alias-ask summary").click();
            await panel.getByLabel("Gemini API key").fill("test-key");
            await panel.getByRole("button", { name: "Look for other names" }).click();
          },
        },
        {
          name: "focus",
          url: "/?focus=1",
          ready: ".focus-alert",
          open: async () => {
            await page.evaluate((store) => window.localStorage.setItem("trace-focus-v1", store), focusStore(Date.now()));
            await page.reload();
            await expect(page.locator(".focus-dial-card")).toBeVisible();
          },
        },
        ...(["Timer", "Stopwatch", "Alarms"] as const).map((tab) => ({ name: `focus ${tab}`, url: "/?focus=1", ready: ".focus-settings", open: async () => { await page.getByRole("tab", { name: tab }).click(); } })),
        {
          name: "focus full screen",
          url: "/?focus=1",
          ready: ".focus-stage",
          open: async () => {
            await page.getByRole("tab", { name: "Focus" }).click();
            await page.locator(".focus-hero h1").click();
            await page.keyboard.press("f");
          },
        },
        {
          name: "profile",
          url: "/?profile=1",
          ready: ".work-calendar-grid",
          open: async () => {
            await page.locator(".work-cell.level-3, .work-cell.level-2").first().click();
          },
        },
      ];
      for (const screen of screens) {
        await page.goto(screen.url);
        await expect(page.locator(".boot-screen")).toHaveCount(0);
        if (screen.section) await page.locator(".lab-nav button", { hasText: screen.section }).first().click();
        await screen.open?.();
        // Liste sunucudan geliyor; yüklü bir makinede 400 ms yetmiyordu ve sayfanın yalnızca başlığı ölçülüyordu.
        if (screen.ready) await expect(page.locator(screen.ready).first()).toBeVisible();
        // Geçişler bitsin: renkler yarı yoldayken ölçülmesin.
        await page.waitForTimeout(400);
        const { checked, failures } = await unreadableTexts(page);
        expect(checked, screen.name).toBeGreaterThan(20);
        expect(failures, `${theme} · ${screen.name}`).toEqual([]);
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

  test("carries progress to another device in a file, merging it with what is there", async ({ page, browser, request }) => {
    const project = await seed(request, projectNamed("e2e-study-carry"));
    const created = await request.post("/api/publications", {
      data: { projectId: project.id, settings: { include: { deepReport: true, technicalAppendix: true, learning: true, figures: false }, expiresAt: null } },
    });
    const { publication } = (await created.json()) as { publication: { path: string } };

    // Telefon: yayınlanan sayfada iki adım.
    await page.goto(publication.path);
    await page.locator(".viewer-tabs button", { hasText: "Study" }).click();
    const study = page.locator("section.study");
    await study.getByRole("button", { name: "Begin →" }).click();
    await study.getByRole("button", { name: "Next →" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), study.getByRole("button", { name: "Save progress to a file" }).click()]);
    expect(download.suggestedFilename()).toBe("attention-is-all-you-need.trace-progress.json");
    const file = await download.path();
    const saved = JSON.parse(readFileSync(file, "utf8")) as { kind: string; projectId: string; progress: StudyProgress };
    expect(saved).toMatchObject({ kind: "trace-study-progress", projectId: project.id });
    expect(saved.progress.done).toHaveLength(2);

    // Başka bir cihaz: boş bir tarayıcı, aynı sayfa.
    const other = await browser.newContext();
    const laptop = await other.newPage();
    await laptop.goto(publication.path);
    await laptop.locator(".viewer-tabs button", { hasText: "Study" }).click();
    const there = laptop.locator("section.study");
    await there.getByLabel("Load progress from a file").setInputFiles(file);
    // İkinci adım bir kavramdı: okunan kavram bir tekrar kartı da açtı, o da taşınıyor.
    await expect(there.locator(".study-carry-message")).toHaveText(
      `Progress loaded and merged with what was here: 2 steps done, 0 answers, ${saved.progress.reviews?.length ?? 0} review ${saved.progress.reviews?.length === 1 ? "card" : "cards"}.`,
    );
    await expect(there.locator(".study-bar")).toHaveAttribute("aria-valuenow", "2");

    // Başka bir makalenin dosyası hiçbir şeyi değiştirmiyor.
    await there.getByLabel("Load progress from a file").setInputFiles({
      name: "other.trace-progress.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...saved, projectId: "someone-else", paperTitle: "Another paper" })),
    });
    await expect(there.locator(".study-carry-message")).toHaveText("That file holds progress for another paper: Another paper. Nothing was changed.");
    await other.close();

    // Stüdyo: aynı dosya kütüphanedeki ilerlemeye ekleniyor.
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Study" }).click();
    await page.locator("section.study").getByLabel("Load progress from a file").setInputFiles(file);
    await expect(page.locator("section.study .study-carry-message")).toContainText("2 steps done");
    await expect.poll(async () => {
      const { progress } = (await (await request.get(`/api/library/study?id=${project.id}`)).json()) as { progress?: StudyProgress };
      return progress?.done.length ?? 0;
    }).toBe(2);
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

  test("starts a focus round from Study and from Review, and counts the time on the cards as work for the paper", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-review-time"));
    await studied(request, project, true);
    await page.clock.install();
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Study" }).click();
    const bar = page.getByRole("group", { name: "Focus round" });
    await expect(bar).toContainText("Work through the path in a focus round");
    await bar.getByRole("button", { name: "Start a focus round" }).click();
    await expect(bar.getByRole("status")).toHaveText("Focus round · 25 min left · counted for this paper");
    await bar.getByRole("button", { name: "Open the timer" }).click();
    await expect(page.locator(".focus-task input")).toHaveValue(project.evidence.paper.title);
    await page.getByRole("button", { name: "Stop" }).click();

    // Tekrar: tur buradan da başlıyor; kartlarda geçen süre çalışma sayılıyor.
    await page.goto(`/?project=${project.id}`);
    await page.locator(".study-offer").getByRole("button", { name: "Review 2 cards" }).click();
    await expect(bar).toContainText("Review in a focus round: the time is counted for this paper.");
    await page.clock.runFor(40_000);
    await page.locator(".review-card").getByRole("button", { name: "Skip for now" }).click();
    await page.clock.runFor(20_000);
    await page.locator(".review-card").getByRole("button", { name: "Skip for now" }).click();
    await expect(page.locator(".review-empty")).toContainText("You skipped every card");
    const reviewed = async () => ((await (await request.get("/api/profile/sessions")).json()) as { log: WorkLog }).log.sessions.filter((session) => session.kind === "review");
    await expect.poll(async () => (await reviewed()).map((session) => [session.projectId, session.label])).toEqual([[project.id, project.evidence.paper.title]]);
    const [time] = await reviewed();
    expect(Date.parse(time.end) - Date.parse(time.start)).toBeGreaterThanOrEqual(60_000);
    expect(Date.parse(time.end) - Date.parse(time.start)).toBeLessThan(75_000);

    // Profilde "Review" olarak görünüyor ve makaleye yazılıyor.
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("region", { name: "Time by paper" }).locator("li", { hasText: project.evidence.paper.title }).locator("strong")).toHaveText("1m");
    await expect(page.getByRole("switch", { name: "Count review time as work" })).toHaveAttribute("aria-checked", "true");
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

test.describe("learning statistics", () => {
  // UTC tarihinin okuyucunun tarihinden farklı olduğu bir saat dilimi: gün
  // sınırları UTC'ye göre çizilseydi haftanın günleri bir kayardı.
  const farZone = new Date().getUTCHours() >= 10 ? "Pacific/Kiritimati" : "Pacific/Pago_Pago";
  test.use({ timezoneId: farZone });

  test("counts what the reader studied, remembered and forgot, across the library", async ({ page, request }) => {
    const base = projectNamed("e2e-progress");
    const concept = base.primer!.concepts[0];
    const project = await seed(request, {
      ...base,
      evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Progress paper" } },
      primer: { ...base.primer!, concepts: base.primer!.concepts.map((item) => (item.id === concept.id ? { ...item, term: "Zeta forgotten concept" } : item)) },
    });
    const question = example.quiz!.questions[0];
    const now = Date.now();
    const iso = (days: number) => new Date(now + days * 86_400_000).toISOString();
    const progress: StudyProgress = {
      ...completeStep(undefined, `concept:${concept.id}`, "next", iso(-30)),
      reviews: [
        { id: `c:${concept.id}`, box: 0, due: iso(-1), lapses: 3, reviews: 4, last: iso(-2) },
        { id: `q:${question.id}`, box: 4, due: iso(20), lapses: 0, reviews: 3, last: iso(-3), sig: questionSignature(question) },
      ],
    };
    expect((await request.put(`/api/library/study?id=${project.id}`, { data: { progress } })).ok()).toBe(true);

    await page.goto("/?library=1");
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(page).toHaveURL(/progress=1/);
    await expect(page.locator(".compare-hero h1")).toContainText("You remembered");

    const row = page.locator(".stats-table tbody tr", { hasText: "Progress paper" });
    await expect(row.locator("td").nth(0)).toContainText("Studying · 1 of");
    await expect(row.locator("td").nth(2)).toHaveText("2 · 1 due");
    await expect(row.locator("td").nth(3)).toHaveText("4 of 7");
    await expect(page.getByRole("list", { name: "Cards by the time until their next review" }).locator("li")).toHaveCount(6);
    const week = page.getByRole("list", { name: "Cards due each day this week" }).locator(".stat-bar-label");
    await expect(week).toHaveCount(7);
    const localDay = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short", timeZone: farZone });
    await expect(week.nth(0)).toHaveText("Today");
    await expect(week.nth(2)).toHaveText(localDay.format(new Date(now + 2 * 86_400_000)));
    await expect(page.locator(".stats-hardest li", { hasText: "Zeta forgotten concept" })).toContainText("forgotten 3 of 4 reviews");

    await row.getByRole("button", { name: "Progress paper" }).click();
    await expect(page.locator(".lab-section-header h1")).toHaveText("Progress paper");
  });
});

test.describe("concepts across the library", () => {
  test("links two names for the same concept when the reader says so, and only then", async ({ page, request }) => {
    const named = (id: string, title: string, term: string, other: string) => {
      const base = projectNamed(id);
      return {
        ...base,
        evidence: { ...example.evidence, paper: { ...example.evidence.paper, title }, glossary: [] },
        primer: { ...base.primer!, concepts: base.primer!.concepts.map((concept) => ({ ...concept, term: concept.id === "dot-product" ? term : concept.id === "softmax" ? other : `${concept.term} of ${title}` })) },
      };
    };
    const first = await seed(request, named("e2e-alias-a", "Alias paper one", "Omega scalar product", "Omega normalised exponential"));
    await seed(request, named("e2e-alias-b", "Alias paper two", "Omega dot product", "Omega softmax function"));
    await page.route("**/api/library/aliases/propose", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: [{
            a: { term: "Omega normalised exponential", paper: "Alias paper one", definition: "Turns scores into weights." },
            b: { term: "Omega softmax function", paper: "Alias paper two", definition: "Turns scores into weights that sum to one." },
            why: "Both definitions describe the softmax.",
          }],
          names: 412,
          parts: 3,
          failedParts: 1,
          unread: 0,
          model: "gemini-3.7-flash",
        }),
      });
    });

    await page.goto("/?library=1");
    await page.getByRole("button", { name: "Concepts", exact: true }).click();
    const panel = page.getByRole("region", { name: "Names for the same concept" });
    await expect(page.locator(".shared-concepts > li", { hasText: /omega (dot|scalar) product/i })).toHaveCount(0);

    // Elle: iki ad aynı kavram.
    await panel.getByLabel("First name").fill("Omega dot product");
    await panel.getByLabel("Second name").fill("Omega scalar product");
    await panel.getByRole("button", { name: "Link them" }).click();
    await expect(panel.locator(".alias-links li", { hasText: "Omega dot product" })).toContainText("linked by you");
    const card = page.locator(".shared-concepts > li", { hasText: /omega (dot|scalar) product/i });
    await expect(card.locator(".shared-concept-head span")).toHaveText("2 papers");
    await expect(card.locator(".shared-concept-papers")).toContainText(/as “Omega (dot|scalar) product”/);

    // Modelin önerisi: okuyucu onaylayınca bağlanıyor.
    await panel.locator(".alias-ask summary").click();
    await panel.getByLabel("Gemini API key").fill("test-key");
    await panel.getByRole("button", { name: "Look for other names" }).click();
    const proposal = panel.getByRole("list", { name: "Proposed pairs" }).locator("li");
    await expect(proposal).toContainText("Both definitions describe the softmax.");
    // Büyük bir kütüphane parçalar hâlinde okunuyor; okunamayan parça söyleniyor.
    await expect(panel.locator(".alias-coverage")).toHaveText(
      "412 names, read in 3 parts; names with similar definitions were kept in the same part. 1 of 3 parts could not be read; ask again to try them.",
    );
    await proposal.getByRole("button", { name: "Same concept" }).click();
    await expect(proposal).toHaveCount(0);
    await expect(panel.locator(".alias-links li", { hasText: "Omega softmax function" })).toContainText("proposed by a model, confirmed by you");

    // Lab: kavram artık öteki makalede de.
    await page.goto(`/?project=${first.id}`);
    await page.locator(".lab-nav > button", { hasText: "Concepts" }).click();
    const row = page.locator(".concept-rows li").filter({ has: page.locator("strong", { hasText: /^Omega scalar product$/ }) });
    await expect(row.locator(".concept-status")).toHaveText("In 1 other paper, not studied yet");
    await expect(row.locator(".concept-where")).toHaveText("Alias paper two");

    // Bağlar kaldırılınca eşleşme yine yalnızca ada göre.
    await page.goto("/?library=1");
    await page.getByRole("button", { name: "Concepts", exact: true }).click();
    for (const term of ["Omega dot product", "Omega softmax function"]) {
      await panel.locator(".alias-links li", { hasText: term }).getByRole("button", { name: /Unlink/ }).click();
    }
    await expect(panel.locator(".alias-links li")).toHaveCount(0);
    await expect(page.locator(".shared-concepts > li", { hasText: /omega (dot|scalar) product/i })).toHaveCount(0);
  });

  test("orders the library so a paper comes after the one that defines what it assumes", async ({ page, request }) => {
    const foundations = await seed(request, {
      ...projectNamed("e2e-order-a"),
      evidence: {
        ...example.evidence,
        paper: { ...example.evidence.paper, title: "Omega foundations", year: "2015" },
        glossary: [{ term: "Omega attention", definition: "Attention over zeta-sized windows." }],
      },
    });
    const base = projectNamed("e2e-order-b");
    const applied = await seed(request, {
      ...base,
      evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Omega applied", year: "2019" } },
      primer: { ...base.primer!, concepts: base.primer!.concepts.map((concept) => (concept.id === "softmax" ? { ...concept, term: "Omega attention" } : concept)) },
    });

    // Lab: bu makaleden önce okunacak olan.
    await page.goto(`/?project=${applied.id}`);
    await page.locator(".lab-nav > button", { hasText: "Concepts" }).click();
    const first = page.getByRole("region", { name: "Read first" });
    await expect(first.locator("li")).toHaveCount(1);
    await expect(first.locator("li")).toContainText("Omega foundations");
    await expect(first.locator("li")).toContainText("2015 · defines Omega attention");
    await expect(first.locator(".read-first-status")).toHaveText("Not studied yet");

    // Kütüphane: okuma sırası.
    await page.goto("/?library=1");
    await page.getByRole("button", { name: "Concepts", exact: true }).click();
    const order = page.getByRole("region", { name: "A reading order" });
    // `allTextContents` beklemiyor: önce iki makalenin de listede olması bekleniyor.
    await expect(order.locator(".reading-head button", { hasText: "Omega applied" })).toBeVisible();
    await expect(order.locator(".reading-head button", { hasText: "Omega foundations" })).toBeVisible();
    const titles = await order.locator(".reading-head button").allTextContents();
    expect(titles.indexOf("Omega foundations")).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf("Omega foundations")).toBeLessThan(titles.indexOf("Omega applied"));
    const step = order.locator("li", { has: page.locator(".reading-head button", { hasText: "Omega applied" }) });
    await expect(step.locator(".reading-why")).toHaveText("After Omega foundations: it assumes Omega attention, which that paper defines.");
    await order.locator(".reading-head button", { hasText: "Omega foundations" }).click();
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

test.describe("focus timer and profile", () => {
  /** Profil ayarları: testler dakikalarca beklemesin diye bir dakikalık turlar. */
  async function setProfile(request: APIRequestContext, change: (profile: Profile) => Profile) {
    const { profile } = (await (await request.get("/api/profile")).json()) as { profile: Profile };
    const response = await request.put("/api/profile", { data: { profile: change(profile) } });
    expect(response.ok()).toBe(true);
  }
  const sessions = async (request: APIRequestContext) => ((await (await request.get("/api/profile/sessions")).json()) as { log: WorkLog }).log.sessions;

  test("runs rounds and breaks on its own, keeps running on other screens, and saves the focus time", async ({ page, request }) => {
    await setProfile(request, (profile) => ({
      ...profile,
      firstName: "Ada",
      preferences: { ...profile.preferences, sound: "none", focus: { ...profile.preferences.focus, work: 1, shortBreak: 1, longBreak: 2, longEvery: 2 } },
    }));
    await page.clock.install();
    await page.goto("/?focus=1");
    await expect(page.locator(".focus-hero h1")).toContainText("Ada.");
    await page.getByLabel("What are you working on?").fill("Chapter 3");
    await page.getByRole("button", { name: "Start focus" }).click();
    await page.clock.runFor(2_000);
    const nav = page.locator(".studio-nav-focus");
    await expect(nav).toHaveText("00:58");
    await expect(nav).toHaveAttribute("aria-label", "Focus timer: 00:58 left in focus");

    // Başka bir ekrana geçiliyor; sayaç sürüyor, tur orada bitiyor.
    await page.locator(".library-header-actions .text-button", { hasText: "Library" }).click();
    await expect(page.locator(".library-hero")).toBeVisible();
    await page.clock.runFor(60_000);
    const alert = page.locator(".focus-alert", { hasText: "Time for a break" });
    await expect(alert).toContainText("Focus round 1 done. Your 1-minute short break has started.");
    await expect(nav).toContainText("00:5");
    await expect.poll(async () => (await sessions(request)).map((session) => [session.kind, session.label, Date.parse(session.end) - Date.parse(session.start)])).toEqual([["focus", "Chapter 3", 60_000]]);

    // Moladan atlanıyor; ikinci tur başlıyor. Sayfa yenilense de kaldığı yerden.
    await alert.getByRole("button", { name: "Skip the break" }).click();
    await nav.click();
    await expect(page.locator(".focus-phase")).toContainText("Round 2");
    await page.clock.runFor(20_000);
    await page.reload();
    await expect(page.locator(".focus-time")).toHaveText(/00:(39|40)/);
    await page.getByRole("button", { name: "Pause" }).click();
    await expect.poll(async () => (await sessions(request)).length).toBe(2);
    await expect(page.locator(".focus-today strong").first()).toHaveText("1m");
  });

  test("asks what was done when a round ends, and keeps the note with the round in the calendar and the weekly report", async ({ page, request }) => {
    await setProfile(request, (profile) => ({
      ...profile,
      preferences: { ...profile.preferences, sound: "none", focus: { ...profile.preferences.focus, work: 1, shortBreak: 1, autoStartBreaks: true } },
    }));
    await page.clock.install();
    await page.goto("/?focus=1");
    await page.getByLabel("What are you working on?").fill("Chapter 4");
    await page.getByRole("button", { name: "Start focus" }).click();
    await page.clock.runFor(61_000);
    const alert = page.locator(".focus-alert", { hasText: "Time for a break" });
    await expect(alert).toBeVisible();
    const note = alert.getByLabel("What did you do in this round?");
    await expect(alert.getByRole("button", { name: "Save" })).toBeDisabled();
    await note.fill("Rewrote the related work paragraph.");
    // Boşluk tuşu zamanlayıcıyı durdurmuyor, kutuya yazıyor.
    await note.press("Space");
    await alert.getByRole("button", { name: "Save" }).click();
    await expect(alert.locator(".focus-alert-note-saved")).toHaveText("Noted: Rewrote the related work paragraph.");
    await expect.poll(async () => (await sessions(request)).map((session) => [session.kind, session.label, session.note])).toEqual([["focus", "Chapter 4", "Rewrote the related work paragraph."]]);

    // Bugünün oturumlarında, profilin takviminde ve haftalık raporda.
    await expect(page.locator(".focus-sessions .focus-session-note")).toHaveText("Rewrote the related work paragraph.");
    await page.goto("/?profile=1");
    await expect(page.locator(".profile-sessions .focus-session-note")).toHaveText("Rewrote the related work paragraph.");
    const notes = page.getByRole("list", { name: "Round notes this week" });
    await expect(notes).toContainText("Chapter 4");
    await expect(notes).toContainText("Rewrote the related work paragraph.");
  });

  test("keeps counting in a background tab, and in one the browser froze, but not after the page was gone", async ({ page, request }) => {
    await setProfile(request, (profile) => ({
      ...profile,
      preferences: { ...profile.preferences, sound: "none", focus: { ...profile.preferences.focus, work: 1, autoStartBreaks: false } },
    }));
    await page.clock.install();
    await page.goto("/?focus=1");
    await page.getByRole("button", { name: "Start focus" }).click();
    await page.clock.runFor(1_000);
    const pageNow = () => page.evaluate(() => Date.now());

    // Sekme arka planda: pencere zamanlayıcıları çalışmıyor, sayacı ayrı iş parçacığı ilerletiyor.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.setSystemTime((await pageNow()) + 61_000);
    await expect(page.locator(".focus-alert", { hasText: "Focus round done" })).toBeVisible();
    await expect.poll(async () => (await sessions(request)).map((session) => Date.parse(session.end) - Date.parse(session.start))).toEqual([60_000]);
    await page.getByRole("button", { name: "Stop" }).last().click();

    // Tarayıcı sekmeyi beş dakika dondurdu; sekme açıktı, süre sayılıyor.
    await page.getByRole("tab", { name: "Stopwatch" }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.evaluate(() => document.dispatchEvent(new Event("freeze")));
    await page.clock.setSystemTime((await pageNow()) + 5 * 60_000);
    await expect(page.locator(".focus-time")).toContainText(/^05:0\d/);
    await expect(page.locator(".focus-alert", { hasText: "was paused" })).toHaveCount(0);
    await page.getByRole("button", { name: "Reset" }).click();

    // Donma olmadan beş dakikalık bir boşluk: sayfa kapalıydı ya da makine uyudu; sayılmıyor.
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.clock.setSystemTime((await pageNow()) + 5 * 60_000);
    await expect(page.locator(".focus-alert", { hasText: "Your stopwatch was paused" })).toBeVisible();
    await expect(page.locator(".focus-time")).toContainText(/^00:0\d/);
  });

  test("counts down, says when time is up, and rings an alarm on its minute", async ({ page, request }) => {
    // Alarm 30–90 saniye sonraki dakika başında: test dakikanın hangi saniyesinde başlarsa başlasın çalarken yakalanıyor.
    const at = new Date(Math.ceil((Date.now() + 30_000) / 60_000) * 60_000);
    const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    await setProfile(request, (profile) => ({
      ...profile,
      preferences: { ...profile.preferences, sound: "none", timerSeconds: 5 },
      alarms: [{ id: "e2e-alarm", time, label: "Stand up", days: [], enabled: true, color: "pink" }],
    }));
    await page.clock.install();
    await page.goto("/?focus=1");
    await page.getByRole("tab", { name: "Timer" }).click();
    await expect(page.locator(".focus-time")).toHaveText("00:05");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.clock.runFor(6_000);
    const done = page.locator(".focus-alert", { hasText: "Time’s up" });
    await expect(done).toBeVisible();
    await done.getByRole("button", { name: "One more minute" }).click();
    await expect(page.locator(".focus-time")).toHaveText(/01:00|00:59/);

    await page.clock.runFor(at.getTime() - (await page.evaluate(() => Date.now())) + 5_000);
    const alarm = page.locator(".focus-alert", { hasText: "Stand up" });
    await expect(alarm).toHaveAttribute("role", "alert");
    await alarm.getByRole("button", { name: "Stop" }).click();
    await expect(alarm).toHaveCount(0);
    // Bir kez çalan alarm kapanıyor.
    await page.getByRole("tab", { name: "Alarms" }).click();
    await expect(page.getByRole("switch", { name: `Alarm at ${time}, Stand up` })).toHaveAttribute("aria-checked", "false");
  });

  test("times laps, adds and removes alarms, and remembers colours", async ({ page }) => {
    await page.goto("/?focus=1");
    await page.getByRole("tab", { name: "Stopwatch" }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Lap" }).click();
    await page.getByRole("button", { name: "Lap" }).click();
    await expect(page.locator(".focus-laps tbody tr")).toHaveCount(2);
    await page.getByRole("radiogroup", { name: "Stopwatch colour" }).getByRole("radio", { name: "Navy" }).click();
    await expect(page.locator(".focus-mode")).toHaveAttribute("style", /--focus: #1E3A8A/);

    await page.getByRole("tab", { name: "Alarms" }).click();
    await page.getByLabel("Time", { exact: true }).fill("06:45");
    await page.getByLabel("Label", { exact: true }).fill("Read one paper");
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) await page.getByRole("button", { name: day }).click();
    await page.getByRole("button", { name: "Add the alarm" }).click();
    const item = page.locator(".focus-alarm-list li", { hasText: "Read one paper" });
    await expect(item).toContainText("06:45");
    await expect(item).toContainText("Weekdays");
    await page.reload();
    await page.getByRole("tab", { name: "Stopwatch" }).click();
    await expect(page.locator(".focus-mode")).toHaveAttribute("style", /--focus: #1E3A8A/);
    await page.getByRole("tab", { name: "Alarms" }).click();
    await page.getByRole("button", { name: "Delete the alarm at 06:45" }).click();
    await expect(page.locator(".focus-alarm-list li", { hasText: "Read one paper" })).toHaveCount(0);
  });

  test("keeps a profile, a calendar of worked days in the chosen colour, and the sessions behind each day", async ({ page, request }) => {
    // Tarayıcının saati dün öğlende: gece yarısından hemen sonra koşan test "bugün" için ileride biten
    // bir oturum yazamıyordu (sunucu geri çeviriyor). Günler tarayıcının "bugün"üne göre.
    const noon = new Date();
    noon.setDate(noon.getDate() - 1);
    noon.setHours(12, 0, 0, 0);
    await page.clock.install({ time: noon });
    const start = new Date(noon);
    start.setHours(0, 5, 0, 0);
    const day = (offset: number) => new Date(start.getTime() - offset * 86_400_000);
    const worked = [0, 1, 2, 9].map((offset) => ({ id: `e2e-${offset}`, start: day(offset).toISOString(), end: new Date(day(offset).getTime() + (offset + 1) * 30 * 60_000).toISOString(), kind: "focus", label: `Paper ${offset}` }));
    expect((await request.post("/api/profile/sessions", { data: { sessions: worked } })).ok()).toBe(true);

    await page.goto("/?library=1");
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page).toHaveURL(/profile=1/);
    await page.getByRole("button", { name: "Edit profile" }).click();
    await page.getByLabel("First name").fill("Grace");
    await page.getByLabel("Last name").fill("Hopper");
    await page.getByLabel("Role").fill("Research engineer");
    // Bozuk bir adres kaydedilmiyor: tarayıcı formu göndermiyor, sunucu da geri çeviriyor (birim testi).
    await page.getByLabel("Email").fill("not an email");
    await page.getByRole("button", { name: "Save" }).click();
    expect(await page.getByLabel("Email").evaluate((input) => (input as HTMLInputElement).validity.valid)).toBe(false);
    await expect(page.locator(".profile-form")).toBeVisible();
    await page.getByLabel("Email").fill("grace@example.org");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".profile-about h1")).toHaveText("Grace Hopper");
    await expect(page.getByRole("button", { name: "Profile: Grace Hopper" })).toContainText("GH");

    // Takvim: bugün yarım saat, dün bir saat; seri üç gün.
    const tiles = page.getByRole("region", { name: "Work summary" });
    await expect(tiles.locator(".stat-tile", { hasText: "Streak" }).locator("strong")).toHaveText("3 days");
    const today = page.locator(".work-cell.is-today");
    await expect(today).toHaveAttribute("aria-label", /^30m on /);
    await expect(today).toHaveClass(/level-1/);
    await today.click();
    const sessionsBlock = page.getByRole("region", { name: "Sessions" });
    await expect(sessionsBlock.locator("li")).toHaveCount(1);
    await expect(sessionsBlock).toContainText("Paper 0");

    await page.getByRole("radiogroup", { name: "Calendar colour" }).getByRole("radio", { name: "Purple" }).click();
    await expect(page.locator(".work-calendar")).toHaveAttribute("style", /--focus: #7C3AED/);
    await page.reload();
    await expect(page.locator(".work-calendar")).toHaveAttribute("style", /--focus: #7C3AED/);

    // Elle eklenen süre ve silinen oturum kayda yansıyor.
    await page.locator(".work-cell.is-today").click();
    await sessionsBlock.getByRole("button", { name: /^Delete the session/ }).click();
    await expect(sessionsBlock).toContainText("No work recorded on this day.");
    await expect.poll(async () => (await sessions(request)).map((session) => session.id).sort()).toEqual(["e2e-1", "e2e-2", "e2e-9"]);
    const manual = page.getByRole("form", { name: "Add time by hand" });
    await manual.getByLabel("Day", { exact: true }).fill(dayKeyOf(day(3)));
    await manual.getByLabel("From", { exact: true }).fill("10:00");
    await manual.getByLabel("Label", { exact: true }).fill("Library visit");
    await manual.getByRole("button", { name: "Add", exact: true }).click();
    await expect(manual.getByRole("status")).toContainText("30m added");
    await expect.poll(async () => (await sessions(request)).some((session) => session.kind === "manual" && session.label === "Library visit")).toBe(true);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data" }).click();
    const file = JSON.parse(readFileSync(await (await download).path(), "utf8")) as { kind: string; version: number; profile: Profile; log: WorkLog; library: { papers?: unknown[]; study: unknown; notes: unknown; readingList: unknown } };
    expect(file.kind).toBe("trace-work-data");
    expect(file.version).toBe(2);
    expect(file.profile.firstName).toBe("Grace");
    expect(file.log.sessions).toHaveLength(4);
    expect(file.library).toMatchObject({ papers: [], study: { version: 1 }, notes: { version: 1 }, readingList: { version: 1 } });
  });

  test("writes the weekly backup of everything when the studio opens, and says when on the profile", async ({ page, request }) => {
    const paper = await seed(request, projectNamed("e2e-weekly-backup"));
    await page.goto("/?profile=1");
    const data = page.getByRole("region", { name: "Your data" });
    await expect(data.locator(".profile-weekly-backup")).toContainText("The first one is written as soon as there is something to keep.");
    // Açılıştan birkaç saniye sonra yazılıyor; bir hafta içinde ikincisi yok.
    await expect.poll(async () => ((await (await request.get("/api/backup")).json()) as { backups: unknown[] }).backups.length, { timeout: 15_000 }).toBe(1);
    await page.reload();
    await expect(data.locator(".profile-weekly-backup")).toContainText(/Latest: \w+ \d+, \d{4} \(\d+ kB\)\./);
    const again = (await (await request.post("/api/backup")).json()) as { written: boolean; backups: Array<{ day: string }> };
    expect(again.written).toBe(false);
    expect(again.backups).toHaveLength(1);
    expect(paper.id).toBe("e2e-weekly-backup");
  });

  test("restores everything from one file on an empty computer: papers, notes, reading list and study progress", async ({ page, request }) => {
    const paper = projectNamed("e2e-backup");
    const at = new Date(Date.now() - 86_400_000).toISOString();
    const file = {
      kind: "trace-work-data",
      version: 2,
      log: { version: 1, sessions: [{ id: "moved", kind: "focus", start: at, end: new Date(Date.parse(at) + 25 * 60_000).toISOString(), projectId: paper.id }], archive: {} },
      library: {
        papers: [paper],
        study: { version: 1, projects: [{ id: paper.id, progress: completeStep(undefined, "start", "finish", at) }] },
        notes: { version: 1, projects: [{ id: paper.id, notes: [{ id: "n1", target: { kind: "claim", claimId: paper.evidence.claims[0].id }, text: "Brought from the old laptop.", color: "yellow", createdAt: at, updatedAt: at }] }] },
        readingList: { version: 1, items: [{ id: "arxiv:1607.06450", title: "Layer Normalization", identifier: "arxiv:1607.06450", from: [{ projectId: paper.id, relation: "reference" }], authors: [], addedAt: at }] },
        tags: { version: 1, projects: [{ id: paper.id, tags: ["Moved"] }] },
      },
    };
    await page.goto("/?profile=1");
    const data = page.getByRole("region", { name: "Your data" });
    await expect(data.getByRole("checkbox", { name: /Include the papers themselves/ })).toBeChecked();
    await data.locator("input[type=file]").setInputFiles({ name: "trace-data.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
    await expect(data.getByRole("status")).toHaveText("1 session added, 1 paper added to your library, study progress merged for 1 paper, 1 note added, 1 work added to your reading list, tags merged for 1 paper. Nothing was removed.");

    // Kütüphane, okuma listesi ve not yerinde; sayfa yenilenmeden.
    await page.getByRole("button", { name: "Library" }).first().click();
    await expect(page.locator(".library-card, .library-row").filter({ hasText: paper.evidence.paper.title })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Reading list (1)" })).toBeVisible();
    const notes = await (await request.get(`/api/library/notes?id=${paper.id}`)).json();
    expect(notes.notes.map((item: { text: string }) => item.text)).toEqual(["Brought from the old laptop."]);
  });
});

test.describe("where you stopped", () => {
  const inView = (page: Page, selector: string) =>
    page.evaluate((target) => {
      const box = document.querySelector(target)!.getBoundingClientRect();
      return box.top < window.innerHeight * 0.5 && box.bottom > 0;
    }, selector);

  test("remembers the report section and the story section you reached, and takes you back from the library", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-resume"));
    const report = project.deepReport!.sections;
    const mark = (place: string, id: string) => `[data-note-section="${place}:${id}"]`;
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Deep report" }).click();
    await page.locator(mark("report", report[3].id)).evaluate((element) => element.scrollIntoView({ block: "start" }));
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("trace-reading-positions") ?? ""), { timeout: 8_000 }).toContain(`"sectionId":"${report[3].id}"`);

    // Kütüphane: kartta kaldığın yer; tıklayınca Lab o bölümde açılıyor.
    await page.getByRole("button", { name: "Library" }).first().click();
    const resume = page.getByRole("button", { name: `Continue reading ${project.evidence.paper.title} at 4 of ${report.length}: ${report[3].title}` });
    await expect(resume).toHaveText(`Continue 4/${report.length}`);
    await resume.click();
    await expect(page.locator(".lab-nav > button.active")).toContainText("Deep report");
    await expect.poll(() => inView(page, mark("report", report[3].id))).toBe(true);

    // Hikâye: önizlemede ilerlenen bölüm; yeniden açılınca başta "kaldığın yer".
    const story = project.story.sections;
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.locator(mark("story", story[2].id)).evaluate((element) => element.scrollIntoView({ block: "start" }));
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("trace-reading-positions") ?? ""), { timeout: 8_000 }).toContain(`"sectionId":"${story[2].id}"`);
    await page.goto(`/?project=${project.id}&mode=preview`);
    const bar = page.getByRole("group", { name: "Where you stopped" });
    await expect(bar).toContainText(`You stopped at 3 of ${story.length}: ${story[2].title}.`);
    await bar.getByRole("button", { name: "Continue reading" }).click();
    await expect.poll(() => inView(page, mark("story", story[2].id))).toBe(true);
    await expect(bar).toHaveCount(0);
  });
});

test.describe("reading list", () => {
  test("saves works to read later from the concept suggestions and the citation graph, and places them in the reading order", async ({ page, request }) => {
    await seed(request, {
      ...projectNamed("e2e-reading-a"),
      evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Omega foundations", year: "2015" }, glossary: [{ term: "Omega attention", definition: "Attention over zeta-sized windows." }] },
    });
    const base = projectNamed("e2e-reading-b");
    const applied = await seed(request, {
      ...base,
      evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Omega applied", year: "2019" } },
      primer: { ...base.primer!, concepts: base.primer!.concepts.map((concept) => (concept.id === "softmax" ? { ...concept, term: "Omega attention" } : concept)) },
    });
    const node = (title: string, identifier: string, year: number) => ({ openAlexId: identifier, title, year, citationCount: 40, authors: ["A. Author"], authorCount: 1, pdfAvailable: true, identifier, url: "https://example.org/work" });
    await page.route("**/api/citations", (route) => route.fulfill({ json: {
      ok: true, retrievedAt: "2026-09-01T00:00:00.000Z", source: "OpenAlex", paper: node("Omega applied", "arxiv:1900.00001", 2019),
      referenceCount: 1, citedByCount: 1, note: "", openAlexUrl: "https://openalex.org/W1",
      references: [node("Omega attention explained", "arxiv:2001.00002", 2018)],
      citedBy: [node("A follow-up to Omega", "arxiv:2102.00003", 2021)],
    } }));
    let lookedUp: string | null = null;
    await page.route("**/api/resolve**", (route) => {
      lookedUp = new URL(route.request().url()).searchParams.get("q");
      return route.fulfill({ json: { candidates: [] } });
    });

    // Kavram önerisinden: makalenin varsaydığı kavramı anlatan kaynak.
    await page.goto(`/?project=${applied.id}`);
    await page.locator(".lab-nav > button", { hasText: "Concepts" }).click();
    await page.getByRole("button", { name: "Look in the references" }).click();
    const suggestion = page.locator(".concept-suggestions li", { hasText: "Omega attention explained" });
    await suggestion.getByRole("button", { name: "Read later" }).click();
    await expect(suggestion.getByRole("button", { name: "On your list" })).toHaveAttribute("aria-pressed", "true");

    // Atıf grafiğinden: aynı çalışma zaten listede; ona atıf yapan bir çalışma da ekleniyor.
    await page.getByRole("button", { name: "Citations" }).click();
    await expect(page.locator(".citation-columns li", { hasText: "Omega attention explained" }).getByRole("button", { name: "On your list" })).toBeVisible();
    await page.locator(".citation-columns li", { hasText: "A follow-up to Omega" }).getByRole("button", { name: "Read later" }).click();
    await expect(page.locator(".citation-columns li", { hasText: "A follow-up to Omega" }).getByRole("button", { name: "On your list" })).toBeVisible();
    await page.locator(".citation-columns li", { hasText: "Omega attention explained" }).getByRole("button", { name: "On your list" }).click();
    await page.locator(".citation-columns li", { hasText: "Omega attention explained" }).getByRole("button", { name: "Read later" }).click();
    await expect.poll(async () => ((await (await request.get("/api/library/reading-list")).json()) as { items: Array<{ title: string; from: unknown[] }> }).items.map((item) => [item.title, item.from.length])).toEqual([
      ["A follow-up to Omega", 1],
      ["Omega attention explained", 1],
    ]);

    // Kütüphane: okuma listesi, okuma sırasında yerinde.
    await page.goto("/?library=1");
    await page.getByRole("button", { name: "Reading list (2)" }).click();
    const order = page.getByRole("region", { name: "A reading order" });
    await expect(order.locator("ol > li")).toHaveCount(4);
    const titles = order.locator("ol > li").locator(".reading-head button, .reading-head .reading-title");
    await expect(titles).toHaveText(["Omega foundations", "Omega attention explained", "Omega applied", "A follow-up to Omega"]);
    await expect(order.locator("li.is-saved").first().locator(".reading-why")).toHaveText("Before Omega applied: that paper builds on it.");
    await expect(order.locator("li.is-saved").last().locator(".reading-why")).toHaveText("After Omega applied: it cites that paper.");
    await order.getByRole("button", { name: "Remove A follow-up to Omega from your reading list" }).click();
    await expect(order.locator("li.is-saved")).toHaveCount(1);
    await order.locator("li.is-saved").getByRole("button", { name: "Analyze it" }).click();
    await expect.poll(() => lookedUp).toBe("arxiv:2001.00002");
  });
});

test.describe("sharing the reading list", () => {
  test("shares the list as it is now with a link, updates it, and takes it down", async ({ page, request, context }) => {
    const project = await seed(request, projectNamed("e2e-share-list"));
    const add = (title: string, identifier: string) => request.post("/api/library/reading-list", { data: { item: { id: identifier, title, identifier, authors: ["A. Author"], year: 2014, from: [{ projectId: project.id, relation: "reference" }], addedAt: new Date().toISOString() } } });
    expect((await add("Neural Machine Translation by Jointly Learning to Align and Translate", "arxiv:1409.0473")).ok()).toBe(true);
    await page.goto("/?library=1");
    await page.getByRole("button", { name: "Reading list (1)" }).click();
    const panel = page.getByRole("region", { name: "Share the reading list" });
    await panel.getByLabel("Title").fill("Seminar reading");
    await panel.getByRole("button", { name: "Share a link" }).click();
    await expect(panel.locator(".reading-share-message")).toHaveText("The link is ready.");
    const link = panel.getByLabel("Link to Seminar reading");
    const url = await link.inputValue();
    expect(url).toMatch(/\/r\/[a-f0-9]{20}$/);
    await expect(panel.locator(".reading-share-state")).toHaveText("Live");

    const reader = await context.newPage();
    await reader.goto(url);
    await expect(reader.locator("h1")).toHaveText("Seminar reading");
    await expect(reader.locator("li h2 a")).toHaveAttribute("href", "https://arxiv.org/abs/1409.0473");
    await expect(reader.locator("li .why")).toHaveText(`${project.evidence.paper.title} builds on it.`);

    // Eklenen çalışma güncelleyince görünüyor.
    expect((await add("Long Short-Term Memory", "10.1162/neco.1997.9.8.1735")).ok()).toBe(true);
    await reader.reload();
    await expect(reader.locator("li")).toHaveCount(1);
    await panel.getByRole("button", { name: "Update to the current list" }).click();
    await expect(panel.locator(".reading-share-message")).toHaveText("The link shows the list as it is now.");
    await reader.reload();
    await expect(reader.locator("li")).toHaveCount(2);

    await panel.getByRole("button", { name: "Take down" }).click();
    await expect(panel.locator(".reading-share-state")).toHaveText("Taken down");
    const gone = await reader.goto(url);
    expect(gone?.status()).toBe(404);
    await expect(reader.locator("h1")).toHaveText("This reading list is not available");
    await reader.close();
  });
});

test.describe("reader notes", () => {
  /** Bir bölümün ilk uzun metin düğümünden ilk `length` karakteri seçer, okuyucunun sürüklemesi gibi. */
  async function selectIn(page: Page, selector: string, length = 34) {
    return page.evaluate(({ selector, length }) => {
      const root = document.querySelector(selector)!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text | null;
      while (node && node.data.trim().length < length + 5) node = walker.nextNode() as Text | null;
      const range = document.createRange();
      const start = node!.data.search(/\S/);
      range.setStart(node!, start);
      range.setEnd(node!, start + length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString().replace(/\s+/g, " ").trim();
    }, { selector, length });
  }
  const stored = async (request: APIRequestContext, id: string) => ((await (await request.get(`/api/library/notes?id=${id}`)).json()) as { notes: Array<{ quote?: string; text: string; color: string; target: { kind: string } }> }).notes;
  const painted = (page: Page, color: string) => page.evaluate((name) => (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(name)?.size ?? 0, `trace-note-${color}`);

  test("highlights and notes text in the report and the story, notes a claim, and exports them for Obsidian, never into the project", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-notes"));
    const report = project.deepReport!.sections[0];
    const claim = project.evidence.claims[0];
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Deep report" }).click();

    // Rapor: seçilen metin yeşille vurgulanıyor.
    const first = await selectIn(page, `[data-note-section="report:${report.id}"] .report-analysis`);
    const bar = page.getByRole("toolbar", { name: "Highlight the selected text" });
    await bar.getByRole("button", { name: "Highlight in green" }).click();
    await expect(bar).toHaveCount(0);
    await expect.poll(() => stored(request, project.id)).toEqual([expect.objectContaining({ quote: first, color: "green", text: "", target: { kind: "section", place: "report", sectionId: report.id } })]);
    await expect.poll(() => painted(page, "green")).toBe(1);

    // Başka bir yer: vurgulayıp not yazılıyor.
    const second = await selectIn(page, `[data-note-section="report:${project.deepReport!.sections[1].id}"] .report-analysis`, 20);
    await bar.getByRole("button", { name: "Note" }).click();
    const form = page.getByRole("form", { name: "Note on the highlight" });
    await form.getByLabel("Your note").fill("Compare with the BLEU table.");
    await form.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await stored(request, project.id)).map((note) => [note.quote, note.text])).toEqual([[first, ""], [second, "Compare with the BLEU table."]]);
    await expect.poll(() => painted(page, "yellow")).toBe(1);

    // İddia: not ve "önemli" işareti; iddia listesinde yıldız.
    await page.locator(".lab-nav > button", { hasText: "Claims" }).click();
    await page.locator(".claim-row").first().locator("button").first().click();
    const notes = page.getByRole("region", { name: "Your notes on this claim" });
    await notes.getByLabel("A note on this claim").fill("Is this true for short sequences too?");
    await notes.getByRole("button", { name: "Save note" }).click();
    await notes.getByRole("button", { name: "Mark as important" }).click();
    await expect(notes.getByRole("button", { name: "Marked as important" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".claim-row").first().getByLabel("You noted this claim")).toBeVisible();

    // Notlar: sırayla, düzenleniyor, siliniyor, Obsidian'a çıkıyor.
    await page.locator(".lab-nav > button", { hasText: "Notes (4)" }).click();
    const groups = page.locator(".notes-group h3");
    await expect(groups).toHaveText([report.title, project.deepReport!.sections[1].title, claim.statement]);
    const noted = page.locator(".notes-group").nth(1).locator(".note-item");
    await noted.getByRole("button", { name: "Edit" }).click();
    await noted.getByLabel("Edit the note").fill("Compare with Table 2.");
    await noted.getByRole("button", { name: "Save" }).click();
    await noted.getByRole("radio", { name: "purple" }).click();
    await expect.poll(async () => (await stored(request, project.id)).find((note) => note.quote === second)).toMatchObject({ text: "Compare with Table 2.", color: "purple" });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "For Obsidian" }).click()]);
    expect(download.suggestedFilename()).toBe("attention-is-all-you-need-notes.md");
    const markdown = readFileSync((await download.path())!, "utf8");
    expect(markdown).toContain("tags: [trace, paper-notes]");
    expect(markdown).toContain(`> [!quote] Highlight\n> ${second}\n\nCompare with Table 2.`);
    expect(markdown).toContain("Is this true for short sequences too?");
    await page.locator(".notes-group").first().getByRole("button", { name: "Delete this note" }).click();
    await expect.poll(async () => (await stored(request, project.id)).length).toBe(3);

    // Hikâye önizlemesi: orada da seçilip vurgulanıyor; yenilenince vurgular yerinde.
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const story = project.story.sections[0];
    await selectIn(page, `[data-note-section="story:${story.id}"]`, 24);
    await bar.getByRole("button", { name: "Highlight in blue" }).click();
    await expect.poll(async () => (await stored(request, project.id)).length).toBe(4);
    await page.reload();
    await expect.poll(() => painted(page, "blue")).toBe(1);

    // Proje dosyasında hiçbiri yok.
    const saved = JSON.stringify(await (await request.get(`/api/library?id=${project.id}`)).json());
    expect(saved).not.toContain("Compare with Table 2.");
    expect(saved).not.toContain("short sequences too");
  });

  test("highlights with H in the last colour chosen, and opens a note with N", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-notes-keys"));
    const [first, second, third] = project.deepReport!.sections;
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Deep report" }).click();

    // Seçim yokken harfler bir şey yapmıyor.
    await page.locator(".lab-main").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("h");
    const quoteOne = await selectIn(page, `[data-note-section="report:${first.id}"] .report-analysis`, 20);
    await page.keyboard.press("h");
    await expect.poll(() => stored(request, project.id)).toEqual([expect.objectContaining({ quote: quoteOne, color: "yellow" })]);
    await expect(page.getByRole("toolbar", { name: "Highlight the selected text" })).toHaveCount(0);

    // Araç çubuğunda seçilen renk H'nin rengi oluyor.
    await selectIn(page, `[data-note-section="report:${second.id}"] .report-analysis`, 20);
    const bar = page.getByRole("toolbar", { name: "Highlight the selected text" });
    await expect(bar.getByRole("button", { name: "Highlight in yellow" })).toHaveAttribute("aria-keyshortcuts", "H");
    await bar.getByRole("button", { name: "Highlight in pink" }).click();
    const quoteThree = await selectIn(page, `[data-note-section="report:${third.id}"] .report-analysis`, 20);
    await page.keyboard.press("H");
    await expect.poll(async () => (await stored(request, project.id)).map((note) => note.color)).toEqual(["yellow", "pink", "pink"]);
    expect((await stored(request, project.id))[2].quote).toBe(quoteThree);

    // N: vurgulayıp not kutusu; yazılan "n" kutuya gitmiyor.
    const quoteFour = await selectIn(page, `[data-note-section="report:${first.id}"] .report-analysis`, 34);
    await page.keyboard.press("n");
    const form = page.getByRole("form", { name: "Note on the highlight" });
    await expect(form.getByLabel("Your note")).toBeFocused();
    await expect(form.getByLabel("Your note")).toHaveValue("");
    await page.keyboard.type("hold on, check this");
    await form.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await stored(request, project.id)).at(-1)).toMatchObject({ quote: quoteFour, text: "hold on, check this" });
    expect(await stored(request, project.id)).toHaveLength(4);
  });

  test("highlights in a Study step and in a Primer concept too, and shows them in the Story preview and the notes", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-notes-study"));
    const path = studyPath(project, readingDrillFor(project));
    const section = path.steps.find((step) => step.kind === "section")!;
    if (section.kind !== "section") throw new Error("no section step");
    const concept = project.primer!.concepts[0];
    await page.goto(`/?project=${project.id}`);
    await page.locator(".study-offer").getByRole("button", { name: "Start studying" }).click();
    const study = page.locator("section.study");
    await study.locator(".study-outline summary").click();
    await study.locator(".study-outline button", { hasText: section.title }).click();

    // Study'deki bölüm hikâyenin aynı bölümü: vurgu orada da.
    const fromStudy = await selectIn(page, `.study-prose[data-note-section="story:${section.sectionId}"]`, 28);
    const bar = page.getByRole("toolbar", { name: "Highlight the selected text" });
    await bar.getByRole("button", { name: "Highlight in blue" }).click();
    await expect.poll(() => stored(request, project.id)).toEqual([expect.objectContaining({ quote: fromStudy, color: "blue", target: { kind: "section", place: "story", sectionId: section.sectionId } })]);
    await expect.poll(() => painted(page, "blue")).toBe(1);

    // Primer'de bir kavram.
    await page.locator(".lab-nav > button", { hasText: "Primer" }).click();
    const fromPrimer = await selectIn(page, `[data-note-section="concept:${concept.id}"]`, 22);
    await bar.getByRole("button", { name: "Highlight in pink" }).click();
    await expect.poll(async () => (await stored(request, project.id)).map((note) => [note.quote, note.target])).toEqual([
      [fromStudy, { kind: "section", place: "story", sectionId: section.sectionId }],
      [fromPrimer, { kind: "section", place: "concept", sectionId: concept.id }],
    ]);
    await expect.poll(() => painted(page, "pink")).toBe(1);

    // Notlarda Primer kendi başlığıyla; "Show it" kavramı açıyor.
    await page.locator(".lab-nav > button", { hasText: "Notes (2)" }).click();
    await expect(page.locator(".notes-group .notes-place")).toHaveText(["Story", "Primer"]);
    await expect(page.locator(".notes-group h3")).toHaveText([section.title, concept.term]);
    await page.locator(".notes-group").nth(1).getByRole("button", { name: "Show it" }).click();
    await expect(page.locator(`[data-note-section="concept:${concept.id}"]`)).toBeVisible();
    await expect.poll(() => painted(page, "pink")).toBe(1);

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect.poll(() => painted(page, "blue")).toBe(1);
  });
});

test.describe("read aloud", () => {
  /** Tarayıcının konuşma motoru yerine: okunanı kaydediyor; `__hold` doluyken parça bitmiyor. */
  async function fakeSpeech(page: Page) {
    await page.addInitScript(() => {
      type Spoken = { text: string; lang: string; rate: number };
      const state = window as unknown as { __spoken: Spoken[]; __hold: boolean; __paused: boolean; __cancels: number };
      state.__spoken = [];
      state.__hold = true;
      state.__paused = false;
      state.__cancels = 0;
      class Utterance {
        text: string;
        lang = "";
        rate = 1;
        voice: unknown = null;
        onend: (() => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      let current: Utterance | null = null;
      const finish = (utterance: Utterance) => {
        const tick = () => {
          if (current !== utterance) return;
          if (state.__hold || state.__paused) return void setTimeout(tick, 20);
          current = null;
          utterance.onend?.();
        };
        setTimeout(tick, 20);
      };
      Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          speak(utterance: Utterance) {
            state.__spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate });
            current = utterance;
            finish(utterance);
          },
          cancel() {
            state.__cancels += 1;
            current = null;
          },
          pause() {
            state.__paused = true;
          },
          resume() {
            state.__paused = false;
          },
          getVoices: () => [],
        },
      });
    });
  }
  const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: Array<{ text: string; lang: string; rate: number }> }).__spoken);

  test("reads the story aloud from a section, with pause, next, speed and stop", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-read-aloud"));
    const sections = project.story.sections;
    await fakeSpeech(page);
    await page.goto(`/?project=${project.id}&mode=preview`);
    await page.getByRole("button", { name: `Listen from “${sections[1].title}”` }).click();

    const bar = page.getByRole("region", { name: "Read aloud" });
    await expect(bar).toContainText(`Reading 2 of ${sections.length}`);
    await expect(bar.locator("strong")).toHaveText(sections[1].title);
    await expect.poll(async () => (await spoken(page))[0]).toMatchObject({ lang: project.language, rate: 1 });
    expect((await spoken(page))[0].text.startsWith(sections[1].title)).toBe(true);
    const reading = page.locator(`[data-note-section="story:${sections[1].id}"]`);
    await expect(reading).toHaveAttribute("data-reading", "true");
    // Kaydırınca bölümün sınıfı değişiyor; işaret kalıyor.
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    await expect(reading).toHaveAttribute("data-reading", "true");

    await bar.getByRole("button", { name: "Pause" }).click();
    await expect(bar.getByRole("button", { name: "Resume" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __paused: boolean }).__paused)).toBe(true);
    await bar.getByRole("button", { name: "Resume" }).click();

    // Hız bir sonraki parçadan geçerli; bölüm atlanınca sonraki bölümün başı okunuyor.
    await bar.getByLabel("Speed").selectOption("1.5");
    await bar.getByRole("button", { name: "Next section" }).click();
    await expect(bar.locator("strong")).toHaveText(sections[2].title);
    await expect.poll(async () => (await spoken(page)).at(-1)).toMatchObject({ rate: 1.5 });
    expect((await spoken(page)).at(-1)!.text.startsWith(sections[2].title)).toBe(true);

    // Parçalar bitince sırayla ilerliyor; durdurunca çubuk kapanıyor.
    const before = (await spoken(page)).length;
    await page.evaluate(() => { (window as unknown as { __hold: boolean }).__hold = false; });
    await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(before + 1);
    await page.evaluate(() => { (window as unknown as { __hold: boolean }).__hold = true; });
    await bar.getByRole("button", { name: "Stop reading" }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.locator("[data-reading]")).toHaveCount(0);
  });

  test("reads the deep report to the end, and offers nothing where the browser cannot speak", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-read-aloud-report"));
    const report = project.deepReport!.sections;
    await fakeSpeech(page);
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Deep report" }).click();
    await page.getByRole("button", { name: `Listen from “${report.at(-1)!.title}”` }).click();
    const bar = page.getByRole("region", { name: "Read aloud" });
    await expect(bar).toContainText(`Reading ${report.length} of ${report.length}`);
    await page.evaluate(() => { (window as unknown as { __hold: boolean }).__hold = false; });
    // Son bölümün sonunda okuma kendiliğinden bitiyor.
    await expect(bar).toHaveCount(0);
    expect((await spoken(page)).map((item) => item.text).join(" ")).toContain(report.at(-1)!.analysis[0].slice(0, 40));

    const plain = await page.context().newPage();
    await plain.addInitScript(() => {
      Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
    });
    await plain.goto(`/?project=${project.id}&mode=preview`);
    await expect(plain.locator(".story-section").first()).toBeVisible();
    await expect(plain.locator(".listen-button")).toHaveCount(0);
    await plain.close();
  });
});

test.describe("search in a paper", () => {
  test("finds a word across one paper's concepts, claims, sections, glossary and notes, and goes where it is", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-paper-search"));
    const concept = project.primer!.concepts.find((item) => item.term === "Softmax")!;
    const at = new Date().toISOString();
    expect((await request.put(`/api/library/notes?id=${project.id}`, { data: { notes: [{ id: "n1", target: { kind: "section", place: "report", sectionId: project.deepReport!.sections[1].id }, text: "Softmax saturates: ask in the seminar.", color: "yellow", createdAt: at, updatedAt: at }] } })).ok()).toBe(true);
    await page.goto(`/?project=${project.id}`);
    await expect(page.locator(".lab-section-header h1")).toBeVisible();

    // "/" aramayı açıyor ve kutuya odaklanıyor.
    await page.keyboard.press("/");
    const box = page.getByRole("textbox", { name: "Search this paper" });
    await expect(box).toBeFocused();
    await box.fill("softmax");
    const results = page.locator(".paper-search-results li");
    await expect(results.first()).toContainText("Primer");
    await expect(results.first().locator("strong")).toHaveText("Softmax");
    await expect(page.locator(".paper-search .section-intro").first()).toContainText(/\d+ matches: .*primer.*your note/);
    await results.first().getByRole("button").click();
    await expect(page.locator(".lab-nav > button.active")).toContainText("Primer");
    await expect(page.locator(`[data-note-section="concept:${concept.id}"]`)).toBeVisible();

    // Not, bulunduğu rapor bölümüne götürüyor.
    await page.locator(".lab-nav > button", { hasText: "Search" }).click();
    await page.getByRole("textbox", { name: "Search this paper" }).fill("saturates seminar");
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText("Your note");
    await results.first().getByRole("button").click();
    await expect(page.locator(".lab-nav > button.active")).toContainText("Deep report");
    await expect.poll(() => page.evaluate((id) => {
      const box = document.querySelector(`[data-note-section="report:${id}"]`)!.getBoundingClientRect();
      return box.top < window.innerHeight && box.bottom > 0;
    }, project.deepReport!.sections[1].id)).toBe(true);

    // Sözlük terimi ve iddia.
    const term = project.evidence.glossary[0].term;
    await page.locator(".lab-nav > button", { hasText: "Search" }).click();
    await page.getByRole("textbox", { name: "Search this paper" }).fill(term);
    await page.locator(".paper-search-results li", { hasText: "Glossary" }).first().getByRole("button").click();
    await expect(page.locator(".lab-nav > button.active")).toContainText("Glossary");
    const claim = project.evidence.claims[0];
    await page.locator(".lab-nav > button", { hasText: "Search" }).click();
    await page.getByRole("textbox", { name: "Search this paper" }).fill(claim.statement.split(" ").slice(0, 6).join(" "));
    await page.locator(".paper-search-results li", { hasText: "Claim" }).first().getByRole("button").click();
    await expect(page.locator(".claim-row.selected")).toBeVisible();
  });
});

test.describe("study time", () => {
  test.use({ timezoneId: "Europe/Istanbul" });

  test("counts the time on the Study path as work for the paper, up to twenty minutes a step", async ({ page, request }) => {
    const project = await seed(request, { ...projectNamed("e2e-study-time"), evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Study time paper" } } });
    const T = new Date("2026-09-16T10:00:00+03:00").getTime();
    await page.clock.install({ time: T });
    await page.goto(`/?project=${project.id}`);
    await page.locator(".study-offer").getByRole("button", { name: "Start studying" }).click();
    const study = page.locator("section.study");
    await expect(study.locator(".study-title")).toHaveText("What this paper asks");
    await page.clock.fastForward("03:00");
    await study.getByRole("button", { name: "Begin →" }).click();
    // Bir adımda yarım saat: yirmi dakikası sayılıyor.
    await page.clock.fastForward("30:00");
    await study.getByRole("button", { name: /Next →|I've read it/ }).first().click();
    await page.clock.fastForward("02:00");
    await page.locator(".lab-nav > button", { hasText: "Overview" }).click();

    const studied = async () => {
      const { log } = (await (await request.get("/api/profile/sessions")).json()) as { log: WorkLog };
      return log.sessions.filter((session) => session.kind === "study");
    };
    await expect.poll(async () => Math.round((await studied()).reduce((sum, session) => sum + Date.parse(session.end) - Date.parse(session.start), 0) / 60_000)).toBe(25);
    const sessions = await studied();
    expect(sessions.every((session) => session.projectId === project.id && session.label === "Study time paper")).toBe(true);
    // Sınırı aşan adımdan sonra yeni bir oturum: arada sayılmayan on dakika var.
    expect(sessions).toHaveLength(2);
    expect(Math.abs(Date.parse(sessions[0].start) - T)).toBeLessThan(5_000);

    await page.goto("/?profile=1");
    await expect(page.locator(".paper-time")).toContainText("Study time paper");
  });
});

test.describe("cards from highlights", () => {
  const progressOf = async (request: APIRequestContext, id: string) => ((await (await request.get(`/api/library/study?id=${id}`)).json()) as { progress?: StudyProgress }).progress;

  test("turns a highlight into a fill-in-the-blank card that comes back in Review, and drops it with the highlight", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-highlight-cards"));
    const at = new Date().toISOString();
    const first = "Positional encoding gives the model the order of the tokens.";
    const second = "The model reaches 28.4 BLEU on the English-to-German task.";
    const highlight = (id: string, quote: string) => ({ id, target: { kind: "section", place: "report", sectionId: project.deepReport!.sections[0].id }, quote, text: "", color: "yellow", createdAt: at, updatedAt: at });
    expect((await request.put(`/api/library/notes?id=${project.id}`, { data: { notes: [highlight("note-a", first), highlight("note-b", second)] } })).ok()).toBe(true);

    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Notes (2)" }).click();
    const items = page.locator(".note-item");
    await items.nth(0).getByRole("button", { name: "Make a review card" }).click();
    const maker = items.nth(0).getByRole("group", { name: "A review card from this highlight" });
    const words = maker.getByRole("radiogroup", { name: "The word to hide" });
    await expect(words.getByRole("radio", { name: "Positional encoding" })).toHaveAttribute("aria-checked", "true");
    await words.getByRole("radio", { name: "tokens" }).click();
    await expect(maker.locator(".note-card-preview")).toHaveText("Positional encoding gives the model the order of the _____.");
    await words.getByRole("radio", { name: "Positional encoding" }).click();
    await maker.getByRole("button", { name: "Add to review" }).click();
    await expect(items.nth(0).locator(".note-card-status")).toHaveText("In review, hiding “Positional encoding”: it comes back tomorrow.");

    await items.nth(1).getByRole("button", { name: "Make a review card" }).click();
    await expect(items.nth(1).getByRole("radio", { name: "28.4" })).toBeVisible();
    await items.nth(1).getByRole("radio", { name: "28.4" }).click();
    await items.nth(1).getByRole("button", { name: "Add to review" }).click();
    await expect.poll(async () => (await progressOf(request, project.id))?.reviews?.map((review) => [review.id, review.cloze?.answer])).toEqual([["h:note-a", "Positional encoding"], ["h:note-b", "28.4"]]);

    // Kartları bugüne çekip tekrar: biri yazarak bilindi, öteki yanlış yazıldı.
    const progress = (await progressOf(request, project.id))!;
    const past = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    const due = { ...progress, reviews: progress.reviews!.map((review) => ({ ...review, due: past(review.id === "h:note-a" ? 2 : 1) })) };
    expect((await request.put(`/api/library/study?id=${project.id}`, { data: { progress: due } })).ok()).toBe(true);
    await page.goto("/?library=1");
    await page.locator(".library-review").click();
    const card = page.locator(".review-card");
    await expect(card.locator(".review-kind")).toHaveText("Highlight");
    await expect(card.locator(".review-prompt")).toHaveText(`Fill in the blank in your highlight from “${project.deepReport!.sections[0].title}”.`);
    await expect(card.locator("blockquote")).toHaveText("_____ gives the model the order of the tokens.");
    await card.getByLabel("The missing word").fill("positional  encoding");
    await card.getByRole("button", { name: "Check" }).click();
    await expect(card.locator(".review-card-foot")).toContainText("Remembered. This card comes back in 3 days.");
    await expect(card.locator(".cloze-blank")).toHaveText("Positional encoding");
    await card.getByRole("button", { name: "Next card" }).click();

    await expect(card.locator("blockquote")).toHaveText("The model reaches _____ BLEU on the English-to-German task.");
    await card.getByLabel("The missing word").fill("41.8");
    await card.getByRole("button", { name: "Check" }).click();
    await expect(card.locator(".cloze-said")).toHaveText("You wrote “41.8”.");
    await card.getByRole("group", { name: "Did you remember it?" }).getByRole("button", { name: "Not yet" }).click();
    await expect(card.locator(".review-card-foot")).toContainText("Not yet. This card comes back tomorrow.");
    await card.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator(".review-empty")).toContainText("You remembered 1 of 2 cards.");

    // Vurgu silinince kartı da gidiyor.
    await page.goto(`/?project=${project.id}`);
    await page.locator(".lab-nav > button", { hasText: "Notes (2)" }).click();
    await expect(items.nth(1).locator(".note-card-status")).toHaveText("In review, hiding “28.4”: it comes back tomorrow.");
    await items.nth(1).getByRole("button", { name: "Delete this note" }).click();
    await expect.poll(async () => (await progressOf(request, project.id))?.reviews?.map((review) => review.id)).toEqual(["h:note-a"]);
  });
});

test.describe("weekly report", () => {
  test.use({ timezoneId: "Europe/Istanbul" });

  test("sets this week against last week by the same moment, by day and by paper, and shows the hours worked", async ({ page, request }) => {
    const project = await seed(request, { ...projectNamed("e2e-weekly"), evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Weekly paper" } } });
    const span = (id: string, day: string, from: string, to: string, projectId?: string) => ({
      id,
      kind: "focus",
      start: new Date(`${day}T${from}:00+03:00`).toISOString(),
      end: new Date(`${day}T${to}:00+03:00`).toISOString(),
      ...(projectId ? { projectId } : {}),
    });
    const response = await request.post("/api/profile/sessions", {
      data: {
        sessions: [
          span("w1", "2026-09-07", "09:00", "11:00", project.id), // geçen pazartesi
          span("w2", "2026-09-09", "10:00", "11:00"), // geçen çarşamba, bu saatten önce
          span("w3", "2026-09-09", "16:00", "18:00", project.id), // geçen çarşamba, bu saatten sonra
          span("w4", "2026-09-14", "09:00", "12:00", project.id),
          span("w5", "2026-09-16", "13:00", "14:30"),
        ],
      },
    });
    expect(response.ok()).toBe(true);
    // Tarayıcının saati 16 Eylül 2026 çarşamba 15:00.
    await page.clock.install({ time: new Date("2026-09-16T15:00:00+03:00") });
    await page.goto("/?profile=1");
    const report = page.getByRole("region", { name: "Week by week" });
    await expect(report.locator(".week-figures")).toContainText("This week4h 30msince Sep 14");
    await expect(report.locator(".week-figures .is-last")).toContainText("5h");
    await expect(report.locator(".week-figures .is-last small")).toHaveText("3h by this time");
    await expect(report.locator(".week-change")).toHaveText("1h 30m more than last week by this time (+50%).");
    await expect(report.getByRole("list", { name: "Day by day" }).locator("li").first()).toHaveAttribute("aria-label", "Mon: 3h this week, 2h last week");
    await expect(report.getByRole("list", { name: "Day by day" }).locator("li").nth(3)).toHaveAttribute("aria-label", "Thu: still to come this week, 0m last week");

    const table = report.locator(".week-papers table");
    await expect(table.locator("tbody tr").first()).toHaveText(/Weekly paper\s*3h\s*4h/);
    await expect(table.locator("tr.is-other")).toHaveText(/Other work\s*1h 30m\s*1h/);
    await expect(report.locator(".hour-pattern .focus-note")).toHaveText("Over the last 4 weeks, 63% of your work fell between 9:00 and 12:00, and Monday was your busiest day.");
    await expect(report.locator(".hour-row").first().locator(".work-cell").nth(10)).toHaveAttribute("title", "Monday, 10:00–11:00: 2h");
    await table.getByRole("button", { name: "Weekly paper" }).click();
    await expect(page.locator(".lab-section-header h1")).toHaveText("Weekly paper");
  });
});

test.describe("calendar file and weekly summary", () => {
  test.use({ timezoneId: "Europe/Istanbul" });

  test("downloads the sessions as a calendar file, and sums up the last week once when a new one starts", async ({ page, request }) => {
    const project = await seed(request, { ...projectNamed("e2e-ics"), evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Calendar paper" } } });
    const span = (id: string, day: string, from: string, to: string, extra: Record<string, string> = {}) => ({ id, kind: "focus", start: new Date(`${day}T${from}:00+03:00`).toISOString(), end: new Date(`${day}T${to}:00+03:00`).toISOString(), ...extra });
    expect((await request.post("/api/profile/sessions", { data: { sessions: [
      span("c1", "2026-09-07", "09:00", "10:00"),
      span("c2", "2026-09-14", "09:00", "11:00", { projectId: project.id, note: "Drafted the method, part 1." }),
      span("c3", "2026-09-16", "14:00", "15:30"),
    ] } })).ok()).toBe(true);
    // Saat 22 Eylül pazartesi: geçen hafta 14–20 Eylül.
    await page.clock.install({ time: new Date("2026-09-22T09:00:00+03:00") });
    await page.goto("/?library=1");
    const summary = page.locator(".focus-alert", { hasText: "Your week" });
    await expect(summary).toContainText("Last week you worked 3h 30m on 2 days, 2h 30m more than the week before. Your best day was Monday (2h).");
    await summary.getByRole("button", { name: "See the weekly report" }).click();
    await expect(page.getByRole("region", { name: "Week by week" })).toBeVisible();
    await expect(summary).toHaveCount(0);
    // Aynı hafta için bir kez.
    await page.reload();
    await expect(page.getByRole("region", { name: "Week by week" })).toBeVisible();
    await page.waitForTimeout(2_000);
    await expect(summary).toHaveCount(0);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Calendar file" }).click()]);
    expect(download.suggestedFilename()).toBe("trace-work-2026-09-22.ics");
    const ics = readFileSync((await download.path())!, "utf8");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain("UID:c2@trace");
    expect(ics).toContain("SUMMARY:Calendar paper · Focus");
    expect(ics).toContain("DESCRIPTION:What I did: Drafted the method\\, part 1.");
  });
});

test.describe("weekly learning goal", () => {
  test.use({ timezoneId: "Europe/Istanbul" });

  test("sets a goal of papers and cards for the week, and counts the papers finished and the cards reviewed", async ({ page, request }) => {
    const project = await seed(request, { ...projectNamed("e2e-weekly-goal"), evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Goal paper" } } });
    // Pazar çalışılmış (kart pazartesi vadeli), salı bitirilmiş; bu hafta pazartesi başlıyor.
    const studied = recordAnswer(undefined, project.quiz!.questions[0], { correct: false, attempts: 1, revealed: true }, new Date("2026-09-13T10:00:00+03:00").toISOString());
    const progress = visitStep(studied, "finish", new Date("2026-09-15T10:00:00+03:00").toISOString());
    expect((await request.put(`/api/library/study?id=${project.id}`, { data: { progress } })).ok()).toBe(true);
    await page.clock.install({ time: new Date("2026-09-16T15:00:00+03:00") });
    await page.goto("/?profile=1");

    const goals = page.getByRole("group", { name: "Learning this week" });
    await expect(goals.locator(".week-goal").first()).toContainText("1");
    await expect(goals.locator(".focus-note")).toHaveText("Set a weekly goal for papers and cards under Goals and preferences.");
    const preferences = page.getByRole("region", { name: "Goals and preferences" });
    await preferences.getByRole("button", { name: "More papers to finish a week" }).click();
    await preferences.getByRole("spinbutton", { name: "Cards to review a week" }).fill("3");
    await expect.poll(async () => ((await (await request.get("/api/profile")).json()) as { profile: Profile }).profile.preferences.weeklyGoals).toEqual({ papers: 1, cards: 3 });

    await expect(goals.getByRole("progressbar", { name: "Papers finished" })).toHaveAttribute("aria-valuetext", "1 of 1, goal met");
    await expect(goals.getByRole("progressbar", { name: "Cards reviewed" })).toHaveAttribute("aria-valuetext", "0 of 3");
    await expect(goals.locator(".focus-note")).toHaveText("3 cards to go in 5 days: about 1 a day.");

    // Kart tekrar edilince haftanın sayısına giriyor.
    await page.goto("/?library=1");
    await page.locator(".library-review").click();
    const card = page.locator(".review-card");
    const question = example.quiz!.questions[0];
    await card.getByText(question.options.find((option) => option.correct)!.label, { exact: true }).click();
    await card.getByRole("button", { name: "Check answer" }).click();
    await expect(card.locator(".review-card-foot")).toContainText("Remembered.");
    await expect.poll(async () => ((await (await request.get(`/api/library/study?id=${project.id}`)).json()) as { progress: StudyProgress }).progress.reviewDays).toEqual([{ day: "2026-09-16", reviewed: 1, remembered: 1 }]);

    await page.goto("/?profile=1");
    await expect(goals.getByRole("progressbar", { name: "Cards reviewed" })).toHaveAttribute("aria-valuetext", "1 of 3");
    await expect(goals.locator(".week-goal").nth(1)).toContainText("1 remembered");
    await expect(goals.locator(".focus-note")).toHaveText("2 cards to go in 5 days: about 1 a day.");
  });
});

test.describe("focus on a paper", () => {
  async function setProfile(request: APIRequestContext, change: (profile: Profile) => Profile) {
    const { profile } = (await (await request.get("/api/profile")).json()) as { profile: Profile };
    expect((await request.put("/api/profile", { data: { profile: change(profile) } })).ok()).toBe(true);
  }
  const sessions = async (request: APIRequestContext) => ((await (await request.get("/api/profile/sessions")).json()) as { log: WorkLog }).log.sessions;

  test("counts the time for a paper named on the timer or started from its Lab, and shows it there and on the profile", async ({ page, request }) => {
    const project = await seed(request, { ...projectNamed("e2e-focus-paper"), evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Focus paper" } } });
    await setProfile(request, (profile) => ({ ...profile, preferences: { ...profile.preferences, sound: "none" } }));
    await page.clock.install();
    await page.goto("/?focus=1");
    const field = page.getByLabel("What are you working on?");
    await field.fill("Focus");
    await expect(page.locator(".focus-linked")).toHaveCount(0);
    await field.fill("focus paper");
    await expect(page.locator(".focus-linked")).toHaveText("The time is counted for this paper in your library.");
    await page.getByRole("button", { name: "Start focus" }).click();
    await page.clock.runFor(3 * 60_000);
    await page.getByRole("button", { name: "Pause" }).click();
    await expect.poll(async () => (await sessions(request)).map((session) => [session.projectId, session.label])).toEqual([[project.id, "focus paper"]]);
    await page.getByRole("button", { name: "Stop" }).click();

    // Lab: makaleye ayrılan zaman ve buradan başlatılan tur.
    await page.goto(`/?project=${project.id}`);
    const offer = page.getByRole("region", { name: "Time on this paper" });
    await expect(offer.locator("strong")).toHaveText("3m on this paper");
    await offer.getByRole("button", { name: "Start a focus round" }).click();
    await page.clock.runFor(2 * 60_000);
    await expect(offer.locator("strong")).toHaveText("5m on this paper");
    await expect(offer.getByRole("button", { name: /Focus round on this paper/ })).toBeVisible();

    // Profil: makale başına süre; makaleye tıklayınca açılıyor.
    await page.getByRole("button", { name: "Profile" }).click();
    const byPaper = page.getByRole("region", { name: "Time by paper" });
    await expect(byPaper.locator("li", { hasText: "Focus paper" }).locator("strong")).toHaveText("5m");
    await byPaper.getByRole("button", { name: "Focus paper" }).click();
    await expect(page.locator(".lab-section-header h1")).toHaveText("Focus paper");
  });

  test("starts and pauses from the keyboard, opens a full-screen timer, and keeps the background sound chosen", async ({ page, request }) => {
    await setProfile(request, (profile) => ({ ...profile, preferences: { ...profile.preferences, sound: "none" } }));
    await page.clock.install();
    await page.goto("/?focus=1");
    await page.locator(".focus-hero h1").click();
    await page.keyboard.press("Space");
    await page.clock.runFor(2_000);
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.keyboard.press("f");
    const stage = page.getByRole("dialog", { name: "Full-screen timer" });
    await expect(stage).toBeVisible();
    await expect(stage.locator(".focus-stage-time")).toHaveText("24:58");
    await expect(stage.locator(".focus-stage-phase")).toHaveText("Focus · Round 1");
    await page.keyboard.press("Space");
    await expect(stage.getByRole("button", { name: "Resume" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(stage).toHaveCount(0);
    await page.keyboard.press("3");
    await expect(page.getByRole("tab", { name: "Stopwatch" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Space");
    await page.clock.runFor(1_500);
    await page.keyboard.press("l");
    await expect(page.locator(".focus-laps tbody tr")).toHaveCount(1);
    // Yazarken kısayol çalışmıyor.
    await page.getByLabel("Label", { exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    await page.keyboard.press("1");
    await page.getByLabel("Background sound").selectOption("rain");
    await expect(page.getByRole("button", { name: "Listen" })).toBeEnabled();
    await expect.poll(async () => ((await (await request.get("/api/profile")).json()) as { profile: Profile }).profile.preferences.ambient).toBe("rain");
  });

  test("offers the due review cards in a short break, from full screen too, and saves what was remembered", async ({ page, request }) => {
    const project = await seed(request, projectNamed("e2e-break-review"));
    // Üç gün önce çalışılmış gibi: soru ve kavram bugün vadeli.
    const at = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const question = project.quiz!.questions[0];
    const concept = project.primer!.concepts[0];
    const progress = completeStep(recordAnswer(undefined, question, { correct: false, attempts: 1, revealed: true }, at), `concept:${concept.id}`, "start", at);
    expect((await request.put(`/api/library/study?id=${project.id}`, { data: { progress } })).ok()).toBe(true);
    await setProfile(request, (profile) => ({ ...profile, preferences: { ...profile.preferences, sound: "none", focus: { ...profile.preferences.focus, work: 1, shortBreak: 3 } } }));
    await page.clock.install();
    await page.goto("/?focus=1");
    await page.getByRole("button", { name: "Start focus" }).click();
    const review = page.getByRole("region", { name: "Review in the break" });
    await page.clock.runFor(30_000);
    await expect(review).toHaveCount(0);

    // İlk mola: öneri geliyor; okuyucu dinlenmeyi seçiyor.
    await page.clock.runFor(31_000);
    await expect(review).toContainText("2 review cards are due.");
    await review.getByRole("button", { name: "Just rest" }).click();
    await expect(review).toHaveCount(0);

    // İkinci mola başka bir mola: öneri yeniden; tam ekrandan açılıyor.
    await page.getByRole("region", { name: "Focus rounds" }).getByRole("button", { name: "Skip the break" }).click();
    await page.clock.runFor(61_000);
    await expect(review).toContainText("2 review cards are due.");
    await page.getByRole("button", { name: "Full screen" }).click();
    const stage = page.getByRole("dialog", { name: "Full-screen timer" });
    await stage.getByRole("button", { name: "Review 2 cards in this break" }).click();
    await expect(stage).toHaveCount(0);

    for (let index = 0; index < 2; index += 1) {
      await expect(review.locator(".review-count")).toHaveText(`${index + 1} / 2`);
      await expect(review.locator(".break-review-paper")).toHaveText(project.evidence.paper.title);
      if ((await review.locator(".review-kind").textContent()) === "Question") {
        await review.getByText(question.options.find((option) => option.correct)!.label, { exact: true }).click();
        await review.getByRole("button", { name: "Check answer" }).click();
      } else {
        await expect(review.locator(".review-concept h2")).toHaveText(concept.term);
        await review.getByRole("button", { name: "Show the answer" }).click();
        await review.getByRole("button", { name: "I remembered it" }).click();
      }
      await expect(review.locator(".review-card-foot")).toContainText("Remembered. This card comes back in 3 days.");
      await review.getByRole("button", { name: index ? "Done" : "Next card" }).click();
    }
    await expect(review).toContainText("You remembered 2 of 2 cards. Enjoy the rest of your break.");
    await expect.poll(async () => {
      const { progress: saved } = (await (await request.get(`/api/library/study?id=${project.id}`)).json()) as { progress: StudyProgress };
      return saved.reviews!.map((item) => [item.id, item.box]).sort();
    }).toEqual([[`c:${concept.id}`, 1], [`q:${question.id}`, 1]]);
    // Mola bitince özet de kalkıyor; molada geçen süre çalışma sayılmıyor.
    await page.clock.runFor(3 * 60_000);
    await expect(review).toHaveCount(0);
    await expect(page.locator(".focus-phase-chip")).toHaveText("Focus");
    await expect.poll(async () => (await sessions(request)).map((session) => Date.parse(session.end) - Date.parse(session.start))).toEqual([60_000, 60_000]);
  });
});
