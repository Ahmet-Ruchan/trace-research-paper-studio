import { getProvider } from "./model-providers";
import { researchProjectSchema, type ResearchProject } from "./schema";
import { foldForSearch } from "./search-text";

/**
 * Modellerin alıntı karnesi.
 *
 * Her yeni analizde modelin yazdığı her alıntı, atıf yaptığı sayfada aranıyor
 * (`excerptCheck`). Proje hangi modelin yazdığını da tutuyor (`generation`).
 * İkisi birleşince kütüphanenin kendisi bir ölçüm oluyor: hangi model kaç
 * alıntıyı sayfasında bulunabilir yazdı?
 *
 * Bulunamayan alıntı her zaman uydurma değil: tablolar, denklemler ve taranmış
 * sayfalar metin çıkarmada kayboluyor. Bu yüzden karne "uydurdu" demiyor,
 * "sayfasında bulundu" diyor. Arayüz de bunu söylemeli.
 *
 * Yanlış veri, hiç veri olmamasından kötü. Bir projenin sayıları ancak
 * güvenilirse sayılıyor; değilse proje nedeniyle birlikte ayrı listeleniyor:
 * - Denetim hiç yapılmadıysa "hepsi bulundu" sayılmaz.
 * - Denetim kaydı 400 bulunamayan alıntıda kesiliyor; o sınırdaki bir kayıt
 *   oranı olduğundan iyi gösterirdi.
 * - Denetimden sonra kanıt değiştiyse kayıt artık bu kanıtı anlatmıyor.
 *   Referanslar denetimin saydığı gibi yeniden sayılıyor; tutmazsa dışarıda.
 * - Hangi modelin yazdığı bilinmiyorsa kime yazılacağı tahmin edilmiyor.
 */

/** `excerptCheckSchema.unlocated` üst sınırı. Bu sayıya ulaşan kayıt kesilmiş olabilir. */
export const UNLOCATED_LIMIT = 400;

export type ModelIdentity = { key: string; provider: string; model: string };

export type ModelTally = ModelIdentity & {
  checked: number;
  found: number;
  approved: number;
  rejected: number;
};

export type ExclusionReason = "model-not-recorded" | "not-checked" | "check-truncated" | "changed-since-check" | "stage-unknown";

/** Stüdyo ve ajan köprüsü aynı cümleyi söylesin; nasıl düzeltileceği her yüzeyin kendi işi. */
export const exclusionDescriptions: Record<ExclusionReason, string> = {
  "not-checked": "Its quotes were never checked against the PDF.",
  "model-not-recorded": "The project does not say which model wrote it.",
  "check-truncated": "Its check stopped listing missing quotes at 400, so its rate would look better than it is.",
  "changed-since-check": "The evidence changed after its quotes were checked.",
  "stage-unknown": "Two models wrote its evidence, and some claims cannot be traced to the stage that wrote them.",
};

export type ProjectQuoteRecord =
  | { status: "counted"; project: ResearchProject; tallies: ModelTally[] }
  | { status: "excluded"; project: ResearchProject; reason: ExclusionReason };

/** Model seçicideki atama ile projedeki kayıt aynı anahtara iner; boşluklar sayılmaz. */
export function modelIdentity(assignment: { provider: string; model: string } | undefined): ModelIdentity | undefined {
  const provider = assignment?.provider.trim();
  const model = assignment?.model.trim();
  if (!provider || !model) return undefined;
  return { key: `${provider}:${model}`, provider, model };
}

export function modelLabel(model: Pick<ModelIdentity, "provider" | "model">) {
  const provider = model.provider === "native-agent" ? "Agent" : getProvider(model.provider)?.label ?? model.provider;
  return `${provider} · ${model.model}`;
}

/**
 * Model ekibinde alıntıları iki model yazıyor. Dört kanıt aşamasından
 * "methods" ve "results" teknik modelde, "overview" ve "limitations" kanıt
 * modelinde çalışıyor (`api/generate`). Her aşama kendi önekiyle kimlik
 * veriyor (`validateEvidencePass`), metrikler "results"tan, sözlük
 * "overview"dan geliyor. Önek tanınmazsa tahmin edilmiyor.
 */
function claimRole(claimId: string): "evidence" | "technical" | undefined {
  if (claimId.startsWith("overview-") || claimId.startsWith("limit-")) return "evidence";
  if (claimId.startsWith("method-") || claimId.startsWith("result-")) return "technical";
  return undefined;
}

type Owner = "claim" | "metric" | "glossary";

export function projectQuoteRecord(project: ResearchProject): ProjectQuoteRecord {
  const excluded = (reason: ExclusionReason): ProjectQuoteRecord => ({ status: "excluded", project, reason });
  const generation = project.generation;
  const evidenceModel = modelIdentity(generation?.assignments?.evidence ?? generation);
  const technicalModel = modelIdentity(generation?.assignments?.technical ?? generation);
  if (!evidenceModel || !technicalModel) return excluded("model-not-recorded");

  const check = project.excerptCheck;
  if (!check) return excluded("not-checked");
  if (check.unlocated.length >= UNLOCATED_LIMIT) return excluded("check-truncated");

  const oneModel = evidenceModel.key === technicalModel.key;
  const modelFor = (owner: Owner, id: string) => {
    if (oneModel) return evidenceModel;
    const role = owner === "metric" ? "technical" : owner === "glossary" ? "evidence" : claimRole(id);
    return role === "technical" ? technicalModel : role === "evidence" ? evidenceModel : undefined;
  };

  const tallies = new Map<string, ModelTally>();
  const tally = (model: ModelIdentity) => {
    const existing = tallies.get(model.key);
    if (existing) return existing;
    const created = { ...model, checked: 0, found: 0, approved: 0, rejected: 0 };
    tallies.set(model.key, created);
    return created;
  };

  // Denetimin saydığı gibi: makale kaynağına atıf yapan her referans bir kez.
  const paperSources = new Set(project.evidence.sources.filter((source) => source.type === "paper").map((source) => source.id));
  const owners = new Map<string, ModelIdentity>();
  let counted = 0;
  const count = (owner: Owner, id: string, sourceId: string | undefined) => {
    const model = modelFor(owner, id);
    if (!model) return false;
    owners.set(`${owner}\u0000${id}`, model);
    if (sourceId === undefined || !paperSources.has(sourceId)) return true;
    tally(model).checked += 1;
    counted += 1;
    return true;
  };
  for (const claim of project.evidence.claims) {
    for (const reference of claim.sourceRefs) if (!count("claim", claim.id, reference.sourceId)) return excluded("stage-unknown");
  }
  for (const metric of project.evidence.metrics) count("metric", metric.id, metric.sourceRef.sourceId);
  for (const item of project.evidence.glossary) count("glossary", item.term, item.sourceRef?.sourceId);
  if (counted !== check.checked) return excluded("changed-since-check");

  const missing = new Map<string, number>();
  for (const item of check.unlocated) {
    const model = owners.get(`${item.owner}\u0000${item.id}`);
    if (!model) return excluded("changed-since-check");
    missing.set(model.key, (missing.get(model.key) ?? 0) + 1);
  }
  for (const entry of tallies.values()) {
    entry.found = entry.checked - (missing.get(entry.key) ?? 0);
    if (entry.found < 0) return excluded("changed-since-check");
  }

  const reviews = project.claimReviews ?? {};
  for (const claim of project.evidence.claims) {
    if (!Object.hasOwn(reviews, claim.id)) continue;
    const model = owners.get(`claim\u0000${claim.id}`);
    if (!model) continue;
    tally(model)[reviews[claim.id].status] += 1;
  }

  return { status: "counted", project, tallies: [...tallies.values()] };
}

/**
 * %95 Wilson aralığı. Üç alıntının üçü de bulunduysa oran %100 ama kanıt
 * %44'le de uyumlu; aralık, az denetlenmiş bir modelin çok denetlenmiş
 * birini geçmesini engelliyor.
 */
export function wilsonInterval(found: number, checked: number, z = 1.96) {
  if (checked <= 0) return undefined;
  const rate = found / checked;
  const zz = z * z;
  const centre = rate + zz / (2 * checked);
  const spread = z * Math.sqrt((rate * (1 - rate)) / checked + zz / (4 * checked * checked));
  const denominator = 1 + zz / checked;
  return {
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
  };
}

export type ModelRow = ModelIdentity & {
  papers: number;
  checked: number;
  found: number;
  approved: number;
  rejected: number;
  rate: number;
  low: number;
  high: number;
};

export type SamePaperEntry = ModelIdentity & { project: ResearchProject; checked: number; found: number };
export type SamePaperGroup = { title: string; entries: SamePaperEntry[] };

export type ModelRecord = {
  models: ModelRow[];
  samePaper: SamePaperGroup[];
  excluded: Array<{ project: ResearchProject; reason: ExclusionReason }>;
  counted: number;
};

function titleKey(title: string) {
  return foldForSearch(title).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Aynı makale: DOI'si ya da noktalamadan arınmış başlığı aynı olan projeler.
 * İkisinden biri yetiyor, çünkü arXiv ve dergi DOI'leri aynı makale için
 * farklı olabiliyor. Başlık benzerliğine bakılmıyor; yakın başlıklar farklı
 * makaleler olabilir.
 */
function samePaperGroups(records: Array<Extract<ProjectQuoteRecord, { status: "counted" }>>) {
  const parent = records.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const firstByKey = new Map<string, number>();
  records.forEach((record, index) => {
    const paper = record.project.evidence.paper;
    const keys = [`title:${titleKey(paper.title)}`, paper.doi?.trim() ? `doi:${paper.doi.trim().toLowerCase()}` : undefined];
    for (const key of keys) {
      if (!key || key === "title:") continue;
      const first = firstByKey.get(key);
      if (first === undefined) firstByKey.set(key, index);
      else parent[find(index)] = find(first);
    }
  });

  const groups = new Map<number, SamePaperEntry[]>();
  records.forEach((record, index) => {
    const entries = groups.get(find(index)) ?? [];
    for (const tally of record.tallies) {
      if (tally.checked) entries.push({ key: tally.key, provider: tally.provider, model: tally.model, project: record.project, checked: tally.checked, found: tally.found });
    }
    groups.set(find(index), entries);
  });
  return [...groups.values()]
    .filter((entries) => new Set(entries.map((entry) => entry.key)).size > 1)
    .map((entries) => ({ title: entries[0].project.evidence.paper.title, entries }));
}

export function modelRecord(projects: readonly ResearchProject[]): ModelRecord {
  const records = projects.map(projectQuoteRecord);
  const counted = records.filter((record): record is Extract<ProjectQuoteRecord, { status: "counted" }> => record.status === "counted");

  const rows = new Map<string, Omit<ModelRow, "rate" | "low" | "high"> & { projects: Set<string> }>();
  for (const record of counted) {
    for (const tally of record.tallies) {
      const row = rows.get(tally.key) ?? { ...tally, checked: 0, found: 0, approved: 0, rejected: 0, papers: 0, projects: new Set<string>() };
      row.checked += tally.checked;
      row.found += tally.found;
      row.approved += tally.approved;
      row.rejected += tally.rejected;
      row.projects.add(record.project.id);
      rows.set(tally.key, row);
    }
  }

  const models = [...rows.values()]
    .filter((row) => row.checked > 0)
    .map(({ projects: ids, ...row }) => {
      const interval = wilsonInterval(row.found, row.checked)!;
      return { ...row, papers: ids.size, rate: row.found / row.checked, ...interval };
    })
    // En kötü olası orana göre: az kanıtla %100 alan model, çok kanıtla %98 alanı geçemez.
    .sort((left, right) => right.low - left.low || right.checked - left.checked || left.key.localeCompare(right.key));

  return {
    models,
    samePaper: samePaperGroups(counted),
    excluded: records.flatMap((record) => (record.status === "excluded" ? [{ project: record.project, reason: record.reason }] : [])),
    counted: counted.length,
  };
}

/**
 * Ajan köprüsünün (`trace-agent.mjs record`) yazdığı biçim: projelerin
 * tamamı değil, yalnızca bir ajanın kullanıcıya aktaracağı sayılar ve
 * nedenler. Alan adları kendini anlatıyor, çünkü okuyan bir model.
 */
export function modelRecordSummary(record: ModelRecord) {
  // Kayan nokta artığı ("0.9999999999999998") okuyan modeli yanıltmasın.
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return {
    counted: record.counted,
    models: record.models.map((row) => ({
      model: modelLabel(row),
      provider: row.provider,
      modelId: row.model,
      papers: row.papers,
      quotesChecked: row.checked,
      quotesFound: row.found,
      rate: round(row.rate),
      likelyLow: round(row.low),
      likelyHigh: round(row.high),
      claimsApproved: row.approved,
      claimsRejected: row.rejected,
    })),
    samePaper: record.samePaper.map((group) => ({
      title: group.title,
      entries: group.entries.map((entry) => ({
        projectId: entry.project.id,
        model: modelLabel(entry),
        quotesChecked: entry.checked,
        quotesFound: entry.found,
        rate: round(entry.found / entry.checked),
      })),
    })),
    notCounted: record.excluded.map((item) => ({
      projectId: item.project.id,
      title: item.project.evidence.paper.title,
      reason: item.reason,
      detail: exclusionDescriptions[item.reason],
    })),
  };
}

/**
 * Diskten okunmuş ham projelerden karne. Şemaya uymayan dosya sayılmıyor ama
 * sessizce de kaybolmuyor: kaç tane olduğu raporlanıyor.
 */
export function libraryModelRecord(inputs: readonly unknown[]) {
  const projects: ResearchProject[] = [];
  for (const input of inputs) {
    const parsed = researchProjectSchema.safeParse(input);
    if (parsed.success) projects.push(parsed.data);
  }
  return { projects: inputs.length, unreadable: inputs.length - projects.length, ...modelRecordSummary(modelRecord(projects)) };
}
