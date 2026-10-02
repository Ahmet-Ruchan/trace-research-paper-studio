import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUT as libraryPut } from "@/app/api/library/route";
import { PUT as tagsPut } from "@/app/api/library/tags/route";
import { POST as probePost } from "@/app/api/models/probe/route";
import { POST as regeneratePost } from "@/app/api/regenerate/route";
import { POST as teamPost } from "@/app/api/team/route";
import { POST as signInRoute } from "@/app/api/team/session/route";
import { DELETE as templateDelete, PUT as templatePut } from "@/app/api/templates/route";
import { messagesFor } from "@/i18n/messages";
import { proxy } from "@/proxy";
import { evidencePassIds, evidencePassLabels } from "./evidence-pipeline";
import { backupImportText, describeBackupImport, emptyBackupSummary } from "./full-backup";
import { describeLearningGaps, learningBlockIds, learningBlockSpec } from "./learning-generation";
import { sectionKindInfo, sectionKinds } from "./section-regeneration";
import { publicError } from "./server/model-runtime";
import { forgetFailedSignIns } from "./server/team-store";
import { builtInTemplates } from "./narrative-templates";
import { errorMessage, UserFacingError, userErrorText } from "./user-error";

/**
 * API'lerin okuyucuya yazdıkları isteği yapanın dilinde: önce seçilen dil
 * (`trace_ui_language` çerezi), yoksa tarayıcının dil sırası. Dil
 * belirtilmeyen istek (testler, ajanlar) İngilizce ve metinler eskisiyle aynı.
 */
const en = messagesFor("en").server;
const tr = messagesFor("tr").server;
const base = "http://127.0.0.1:3000";
const TURKISH = { cookie: "trace_ui_language=tr" };
const TURKISH_BROWSER = { "accept-language": "tr-TR,tr;q=0.9,en;q=0.8" };

const json = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const errorOf = async (response: Response) => ((await response.json()) as { error?: string }).error;

let workspace: string;
let previousDataDirectory: string | undefined;
let previousTemplateDirectory: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-server-language-"));
  previousDataDirectory = process.env.TRACE_DATA_DIR;
  previousTemplateDirectory = process.env.TRACE_TEMPLATE_DIR;
  process.env.TRACE_DATA_DIR = workspace;
  process.env.TRACE_TEMPLATE_DIR = join(workspace, "templates");
  forgetFailedSignIns();
});

afterEach(() => {
  if (previousDataDirectory === undefined) delete process.env.TRACE_DATA_DIR;
  else process.env.TRACE_DATA_DIR = previousDataDirectory;
  if (previousTemplateDirectory === undefined) delete process.env.TRACE_TEMPLATE_DIR;
  else process.env.TRACE_TEMPLATE_DIR = previousTemplateDirectory;
  rmSync(workspace, { recursive: true, force: true });
});

describe("API hataları isteği yapanın dilinde", () => {
  it("ekip: yanlış parola ve kısa parola", async () => {
    expect(await errorOf(await teamPost(json("/api/team", "POST", { name: "Ada", password: "short" })))).toBe("A password has at least 10 characters.");
    expect(await errorOf(await teamPost(json("/api/team", "POST", { name: "Ada", password: "short" }, TURKISH)))).toBe("Parola en az 10 karakter olmalı.");
    await teamPost(json("/api/team", "POST", { name: "Ada", password: "correct horse battery" }));

    const wrong = { name: "Ada", password: "wrong password!" };
    const english = await signInRoute(json("/api/team/session", "POST", wrong));
    expect(english.status).toBe(401);
    expect(await errorOf(english)).toBe("The name or the password is wrong.");
    const turkish = await signInRoute(json("/api/team/session", "POST", wrong, TURKISH));
    expect(turkish.status).toBe(401);
    expect(await errorOf(turkish)).toBe("Ad ya da parola yanlış.");
    // Seçilen dil tarayıcının dil sırasından önce geliyor.
    expect(await errorOf(await signInRoute(json("/api/team/session", "POST", wrong, { ...TURKISH_BROWSER, cookie: "trace_ui_language=en" })))).toBe(
      "The name or the password is wrong.",
    );
  });

  it("vekil: oturumsuz istek", async () => {
    await teamPost(json("/api/team", "POST", { name: "Ada", password: "correct horse battery" }));
    const english = proxy(new NextRequest(`${base}/api/library`));
    expect(await english?.json()).toEqual({ error: "Sign in to the studio first." });
    const turkish = proxy(new NextRequest(`${base}/api/library`, { headers: TURKISH_BROWSER }));
    expect(turkish?.status).toBe(401);
    expect(await turkish?.json()).toEqual({ error: "Önce stüdyoya giriş yap." });
    expect(await proxy(new NextRequest(`${base}/`, { headers: TURKISH }))?.text()).toBeUndefined();
  });

  it("kütüphane: bulunamayan proje ve bozuk gövde", async () => {
    const missing = (headers?: Record<string, string>) => tagsPut(json("/api/library/tags?id=nowhere", "PUT", { tags: ["later"] }, headers));
    const english = await missing();
    expect(english.status).toBe(404);
    expect(await errorOf(english)).toBe("The project is not in the library.");
    const turkish = await missing(TURKISH_BROWSER);
    expect(turkish.status).toBe(404);
    expect(await errorOf(turkish)).toBe("Proje kütüphanede değil.");

    expect(await errorOf(await libraryPut(json("/api/library", "PUT", "{ not json", TURKISH)))).toBe("İstek geçerli bir JSON değil.");
    expect(await errorOf(await libraryPut(json("/api/library", "PUT", "{ not json")))).toBe("The request is not valid JSON.");
    expect(await errorOf(await templateDelete(new Request(`${base}/api/templates?id=Bad Id`, { method: "DELETE", headers: TURKISH })))).toBe("Geçerli bir şablon kimliği gerekli.");
  });

  it("kütüphane kodunun fırlattığı anahtarlı hata rotada çevriliyor", async () => {
    const shadow = { ...builtInTemplates[0], builtIn: false };
    const english = await templatePut(json("/api/templates", "PUT", shadow));
    expect(await errorOf(english)).toBe("That id belongs to a built-in template; choose another name.");
    const turkish = await templatePut(json("/api/templates", "PUT", shadow, TURKISH));
    expect(turkish.status).toBe(400);
    expect(await errorOf(turkish)).toBe("Bu kimlik hazır bir şablonun; başka bir ad seç.");

    // Yerel model adresi: yalnızca bu makine.
    const probe = (headers?: Record<string, string>) =>
      probePost(json("/api/models/probe", "POST", { assignment: { provider: "local", model: "qwen3:8b" }, apiKey: "http://169.254.169.254/v1" }, headers));
    expect(await errorOf(await probe())).toMatch(/^Only an address on this machine is accepted .*"169\.254\.169\.254" is not one\./);
    expect(await errorOf(await probe(TURKISH))).toMatch(/^Yalnızca bu makinedeki bir adres kabul ediliyor .*“169\.254\.169\.254” bunlardan biri değil\./);

    // Anahtarı boş bulut sağlayıcısı.
    const keyless = (headers?: Record<string, string>) => probePost(json("/api/models/probe", "POST", { assignment: { provider: "gemini", model: "gemini-3.7-flash" } }, headers));
    expect(await errorOf(await keyless())).toBe("Gemini API key is required.");
    expect(await errorOf(await keyless(TURKISH_BROWSER))).toBe("Gemini API anahtarı gerekli.");
  });

  it("yeniden üretim isteği geçersizse", async () => {
    const english = await regeneratePost(json("/api/regenerate", "POST", {}));
    expect(english.status).toBe(400);
    expect(await errorOf(english)).toMatch(/^The regeneration request is not valid: /);
    expect(await errorOf(await regeneratePost(json("/api/regenerate", "POST", {}, TURKISH)))).toMatch(/^Yeniden üretim isteği geçersiz: /);
  });
});

describe("sağlayıcı hatasının söylenişi", () => {
  it("İngilizcesi eskisi gibi, Türkçesi aynı sınıflandırmayla", () => {
    const refused = Object.assign(new Error("401 API key not valid"), { providerId: "gemini", modelId: "gemini-3.7-flash", taskRole: "evidence" });
    expect(publicError(refused, false, "openai")).toBe("The Google Gemini API key is invalid, or not authorised for this model.");
    expect(publicError(refused, false, "openai", tr.errors)).toBe("Google Gemini API anahtarı geçersiz ya da bu model için yetkili değil.");

    const slow = Object.assign(new Error("timeout"), { name: "TimeoutError", providerId: "local", modelId: "qwen3:8b", taskRole: "teaching" });
    expect(publicError(slow, false, "gemini")).toBe(
      "Local model (qwen3:8b) · teaching task did not finish within 15 minutes. Completed stages were kept; you can try again. A smaller or non-thinking local model, or a cloud provider, will finish sooner.",
    );
    expect(publicError(slow, false, "gemini", tr.errors)).toMatch(/^Yerel model \(qwen3:8b\) · öğretim görevi 15 dakika içinde bitmedi\./);

    expect(publicError(new Error("anything"), true, "gemini", tr.errors)).toBe("Üretim iptal edildi.");
    const offline = Object.assign(new UserFacingError("localServerUnreachable", "http://127.0.0.1:11434/v1"), { incompatibleModel: true });
    expect(publicError(offline, false, "local")).toBe(offline.message);
    expect(publicError(offline, false, "local", tr.errors)).toMatch(/^http:\/\/127\.0\.0\.1:11434\/v1 adresinde yanıt veren bir yerel model sunucusu yok\./);
  });

  it("anahtarlı hatanın mesajı İngilizce, rotada seçilen dilde", () => {
    const error = new UserFacingError("sourceStatus", 404);
    expect(error.message).toBe("The source responded with 404.");
    expect(errorMessage(error, userErrorText, "fallback")).toBe(error.message);
    expect(errorMessage(error, tr.errors, "yedek")).toBe("Kaynak 404 koduyla yanıt verdi.");
    expect(errorMessage(new Error("raw provider text"), tr.errors, "yedek")).toBe("raw provider text");
    expect(errorMessage("not an error", tr.errors, "yedek")).toBe("yedek");
  });
});

/**
 * Ağır modüllerin adları (`learning-generation`, `section-regeneration`,
 * `evidence-pipeline`, `full-backup`) sözlükte de yazılı; tarayıcı paketine
 * girmesinler diye. İngilizce kopyanın kaynağıyla aynı kaldığı burada.
 */
describe("sözlükteki İngilizce, kütüphanenin İngilizcesiyle aynı", () => {
  it("öğrenme blokları", () => {
    for (const block of learningBlockIds) {
      const spec = learningBlockSpec(block);
      expect(en.learningLayer.writing(block)).toBe(`${spec.title}.`);
      expect(en.learningLayer.relinking(block)).toBe(`Relinking ${spec.noun}.`);
      expect(en.learningLayer.reconnecting(block)).toBe(`Reconnecting for ${spec.noun}.`);
      expect(en.learningLayer.alreadyHas(block)).toBe(`This project already has ${spec.noun}. Regenerate its items one by one instead.`);
    }
    const failed = [
      { block: "quiz" as const, reason: "The teaching model's key was refused." },
      { block: "primer" as const, reason: "The teaching model's key was refused." },
      { block: "derivations" as const, reason: "The teaching model did not answer in time." },
    ];
    for (const gaps of [[], failed.slice(0, 1), failed.slice(0, 2), failed]) expect(en.learningLayer.gaps(gaps)).toBe(describeLearningGaps(gaps));
    expect(tr.learningLayer.gaps(failed.slice(0, 2))).toMatch(/^Öğrenme katmanı eksik; yazılamayanlar: test ve ön bilgi\./);
  });

  it("bölüm türleri ve kanıt katmanları", () => {
    for (const kind of sectionKinds) {
      const { label, noun } = sectionKindInfo(kind);
      expect(en.regenerate.preparing(kind)).toBe(`Preparing the ${label}.`);
      expect(en.regenerate.passed(kind)).toBe(`The ${noun} passed the evidence check.`);
      expect(en.regenerate.notFound(kind, "x")).toBe(`There is no ${label} with id "x" in this project.`);
    }
    for (const pass of evidencePassIds) expect(en.generate.extracting(pass)).toBe(`Extracting ${evidencePassLabels[pass]}.`);
  });

  it("içe aktarma özeti", () => {
    const summary = { ...emptyBackupSummary(), papersAdded: 2, papersKept: 1, studyMerged: 1, notesAdded: 3, readingAdded: 4, tagsMerged: 2, aliasesAdded: 1, withoutPaper: 1, papersUnreadable: 1 };
    expect(en.backupImport).toEqual(expect.objectContaining({ profileAdopted: backupImportText.profileAdopted }));
    for (const [sessions, adopted, library] of [[0, false, undefined], [1, true, summary]] as const) {
      expect(describeBackupImport(sessions, adopted, library, en.backupImport)).toBe(describeBackupImport(sessions, adopted, library));
    }
    expect(describeBackupImport(1, true, { ...emptyBackupSummary(), papersAdded: 2 }, tr.backupImport)).toBe(
      "1 oturum eklendi, dosyadaki profil alındı, kütüphanene 2 makale eklendi. Hiçbir şey silinmedi.",
    );
  });
});
