import { z } from "zod";
import {
  documentTaskRoles,
  providerCatalog,
  providerReadsDocuments,
  resolveProviderModel,
  withTeachingRole,
  type ModelTeam,
  type ProviderId,
} from "./model-providers";
import { languageTagSchema } from "./schema";

/**
 * Analiz kurulumunun hatırlanan seçimleri.
 *
 * Her yeni makalede sağlayıcıyı, modeli, ekibi, okuyucuyu, derinliği ve
 * şablonu yeniden seçmek gerekiyordu. Artık son seçimler bu tarayıcıda
 * kalıyor. API anahtarları ASLA: arayüz "hiçbir şey saklanmıyor" diyor ve
 * bu dosyanın biçimi bir anahtar alanı taşıyamıyor.
 *
 * Okuma hoşgörülü: eskimiş ya da bozuk bir alan (artık listede olmayan bir
 * model, belgeyi okuyamayan bir sağlayıcı) yalnızca kendisini varsayılana
 * döndürüyor, diğer seçimler kalıyor.
 */
export const SETUP_PREFERENCES_KEY = "trace-setup-preferences";

const providerSchema = z.enum(providerCatalog.map((provider) => provider.id) as [ProviderId, ...ProviderId[]]);
const assignmentSchema = z
  .object({ provider: providerSchema, model: z.string() })
  .transform((assignment, context) => {
    const resolved = resolveProviderModel(assignment.provider, assignment.model);
    if (!resolved) {
      context.addIssue({ code: "custom", message: "The model is not valid for this provider." });
      return z.NEVER;
    }
    return resolved as { provider: ProviderId; model: string };
  });

const fields = {
  audience: z.enum(["general", "student", "expert"]),
  depth: z.enum(["concise", "standard", "deep"]),
  language: languageTagSchema,
  single: assignmentSchema.refine((assignment) => providerReadsDocuments(assignment.provider), "A single model must be able to read the paper."),
  orchestration: z.enum(["single", "team"]),
  team: z
    .object({ evidence: assignmentSchema, technical: assignmentSchema, report: assignmentSchema, visual: assignmentSchema, teaching: assignmentSchema.optional() })
    .refine((team) => documentTaskRoles.every((role) => providerReadsDocuments(team[role]?.provider ?? "")), "The stages that read the paper need a provider that can.")
    // Öğretim rolünden önce hatırlanan bir ekip öğretimi rapor modeline veriyor.
    .transform(withTeachingRole),
  templateId: z.string().min(1).max(160),
};

export type SetupPreferences = {
  audience?: z.infer<typeof fields.audience>;
  depth?: z.infer<typeof fields.depth>;
  language?: string;
  single?: { provider: ProviderId; model: string };
  orchestration?: z.infer<typeof fields.orchestration>;
  team?: ModelTeam;
  templateId?: string;
};

export function parseSetupPreferences(raw: unknown): SetupPreferences {
  if (!raw || typeof raw !== "object" || (raw as { version?: unknown }).version !== 1) return {};
  const source = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(fields)) {
    const parsed = schema.safeParse(source[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return result as SetupPreferences;
}

/** Yalnızca bilinen alanlar yazılıyor; çağıran fazlasını verse bile (ör. anahtarlar) dosyaya girmiyor. */
export function serializeSetupPreferences(preferences: SetupPreferences) {
  const known: Record<string, unknown> = { version: 1 };
  for (const key of Object.keys(fields) as Array<keyof SetupPreferences>) {
    if (preferences[key] !== undefined) known[key] = preferences[key];
  }
  return JSON.stringify(known);
}

export function readSetupPreferences(): SetupPreferences {
  try {
    return parseSetupPreferences(JSON.parse(window.localStorage.getItem(SETUP_PREFERENCES_KEY) ?? "null"));
  } catch {
    return {};
  }
}

export function writeSetupPreferences(preferences: SetupPreferences) {
  try {
    window.localStorage.setItem(SETUP_PREFERENCES_KEY, serializeSetupPreferences(preferences));
  } catch {
    // Depolama kapalı: seçimler bu sayfada kalır.
  }
}
