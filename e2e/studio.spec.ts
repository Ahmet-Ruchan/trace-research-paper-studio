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
});
