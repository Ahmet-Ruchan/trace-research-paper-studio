import { z } from "zod";
import { conceptKeys } from "./concept-links";

/**
 * Okuyucunun onayladığı kavram eşleri.
 *
 * Kavram bağları adla kuruluyor (`concept-links.ts`): "Scaled dot-product
 * attention" ile "Dot-product attention" iki ayrı kavram sayılıyor. Anlama göre
 * eşleştirmek bir model işi ve model yanılabilir; bu yüzden bir eşleşme ancak
 * okuyucu "aynı kavram" dediğinde geçerli. Model yalnızca ÖNERİYOR, okuyucu
 * karar veriyor; okuyucu iki adı kendisi de eşleyebiliyor. "Farklı" kararı da
 * saklanıyor: aynı öneri bir daha gelmiyor.
 *
 * Kararlar kütüphanenin yanında (`aliases.json`), projede değil: iki kavramın
 * aynı olduğu okuyucunun yargısı, makalenin iddiası değil.
 */

export const MAX_ALIAS_DECISIONS = 500;
const term = z.string().trim().min(1).max(200);

export const aliasDecisionSchema = z.object({
  terms: z.tuple([term, term]),
  decision: z.enum(["same", "different"]),
  /** Eşleşmeyi kim önerdi; kararı her zaman okuyucu veriyor. */
  proposedBy: z.enum(["reader", "model"]),
  at: z.string().max(40),
  /** Modelin gerekçesi, önerdiyse. */
  reason: z.string().max(400).optional(),
});
export type AliasDecision = z.infer<typeof aliasDecisionSchema>;

export const aliasFileSchema = z.object({ version: z.literal(1), decisions: z.array(aliasDecisionSchema).max(MAX_ALIAS_DECISIONS) });
export type AliasFile = z.infer<typeof aliasFileSchema>;

export const emptyAliasFile = (): AliasFile => ({ version: 1, decisions: [] });

export function isAliasFile(raw: unknown) {
  return aliasFileSchema.safeParse(raw).success;
}

/** Tanınmayan dosya boş sayılıyor; yazan taraf onu kenara alıyor. */
export function parseAliasFile(raw: unknown): AliasFile {
  const parsed = aliasFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyAliasFile();
}

/** Bir adın eşleşmedeki kimliği: ilk anahtarı (`concept-links.ts` biçimi). */
const primaryKey = (value: string) => conceptKeys(value)[0];

/** İki adın sırasız kimliği; aynı kavramın iki yazımıysa `undefined`. */
export function pairKey(left: string, right: string) {
  const [a, b] = [primaryKey(left), primaryKey(right)];
  if (!a || !b || a === b) return undefined;
  return [a, b].sort().join("\u0000");
}

export function decisionFor(file: AliasFile, left: string, right: string) {
  const key = pairKey(left, right);
  return key ? file.decisions.find((item) => pairKey(...item.terms) === key) : undefined;
}

/** Kararı yazar; aynı çift için önceki kararın yerini alıyor. */
export function decideAlias(
  file: AliasFile,
  left: string,
  right: string,
  decision: AliasDecision["decision"],
  proposedBy: AliasDecision["proposedBy"],
  at: string,
  reason?: string,
): AliasFile {
  const key = pairKey(left, right);
  if (!key) throw new Error("These are two spellings of the same name; there is nothing to link.");
  const rest = file.decisions.filter((item) => pairKey(...item.terms) !== key);
  const entry: AliasDecision = { terms: [left.trim(), right.trim()], decision, proposedBy, at, ...(reason ? { reason: reason.slice(0, 400) } : {}) };
  return { version: 1, decisions: [...rest, entry].slice(-MAX_ALIAS_DECISIONS) };
}

export function forgetAlias(file: AliasFile, left: string, right: string): AliasFile {
  const key = pairKey(left, right);
  return { version: 1, decisions: file.decisions.filter((item) => pairKey(...item.terms) !== key) };
}

/**
 * Anahtar → grubun temsilci anahtarı. "Aynı" kararları birleşiyor (A=B ve B=C
 * ise A=C); bir adın bütün yazımları (`Ad (KISALTMA)`) da gruba giriyor.
 * Temsilci alfabetik olarak ilk anahtar, böylece sıra karardan bağımsız.
 */
export function aliasMap(file: AliasFile): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const up = parent.get(key);
    if (!up || up === key) return key;
    const root = find(up);
    parent.set(key, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const [a, b] = [find(left), find(right)];
    if (a === b) return;
    const [root, child] = a < b ? [a, b] : [b, a];
    parent.set(child, root);
  };
  for (const item of file.decisions) {
    if (item.decision !== "same") continue;
    const keys = [...conceptKeys(item.terms[0]), ...conceptKeys(item.terms[1])];
    for (const key of keys) {
      if (!parent.has(key)) parent.set(key, key);
      union(keys[0], key);
    }
  }
  const map = new Map<string, string>();
  for (const key of parent.keys()) {
    const root = find(key);
    if (root !== key) map.set(key, root);
  }
  return map;
}
