import { learningBlockList, type LearningBlockId } from "@/lib/learning-generation";
import type { Claim } from "@/lib/schema";

/**
 * Bir makalenin ekranlarında ortak geçenler: iddia türleri, güven rozetleri,
 * model isteklerinin ortak cümleleri, öğrenme bloklarının adları.
 */
type ClaimKind = Claim["kind"];

const en = {
  claimKinds: {
    /** Lab'in kanıt defteri ve karşılaştırma ekranı. */
    short: {
      "reported-result": "Result",
      "author-interpretation": "Interpretation",
      method: "Method",
      background: "Background",
      limitation: "Limitation",
    } as Record<ClaimKind, string>,
    /** Kanıt çekmecesi ve kütüphanedeki iddia araması. */
    long: {
      "reported-result": "Reported result",
      "author-interpretation": "Author interpretation",
      method: "Method",
      background: "Background",
      limitation: "Limitation",
    } as Record<ClaimKind, string>,
  },
  claimStatus: {
    verified: "Verified",
    needsReview: "Needs review",
    /** Satır içinde, küçük harfle: "p. 4 · verified". */
    verifiedInline: "verified",
    needsReviewInline: "needs review",
    openEvidence: "Open the evidence for this claim",
    /** Bir insanın kararı: "Approved by Ada". */
    reviewedBy: (approved: boolean, by: string) => `${approved ? "Approved" : "Rejected"} by ${by}`,
  },
  modelRequest: {
    invalidModel: "The model name is not valid for this provider.",
    keyRequired: (keyLabel: string) => `${keyLabel} is required.`,
    keyInMemory: "The key stays in memory for this request only.",
    unexpected: "Something unexpected went wrong.",
    provider: "Provider",
    model: "Model",
    attempt: (attempt: number) => `attempt ${attempt}`,
    stop: "Stop",
  },
  /** "the primer, the quiz and the derivations" */
  learningBlockList,
};

const trList = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ve ${items[items.length - 1]}`);

const trBlockNouns: Record<LearningBlockId, string> = {
  primer: "ön bilgi",
  quiz: "test",
  misreadings: "sık yapılan yanlış okumalar",
  derivations: "türetimler",
  interactives: "etkileşimli keşifler",
  applicationGuide: "uygulama rehberi",
};

const tr: typeof en = {
  claimKinds: {
    short: {
      "reported-result": "Sonuç",
      "author-interpretation": "Yorum",
      method: "Yöntem",
      background: "Arka plan",
      limitation: "Sınırlılık",
    },
    long: {
      "reported-result": "Bildirilen sonuç",
      "author-interpretation": "Yazarın yorumu",
      method: "Yöntem",
      background: "Arka plan",
      limitation: "Sınırlılık",
    },
  },
  claimStatus: {
    verified: "Doğrulandı",
    needsReview: "İncelenmeli",
    verifiedInline: "doğrulandı",
    needsReviewInline: "incelenmeli",
    openEvidence: "Bu iddianın kanıtını aç",
    reviewedBy: (approved, by) => `${approved ? "Onaylayan" : "Reddeden"}: ${by}`,
  },
  modelRequest: {
    invalidModel: "Bu model adı bu sağlayıcı için geçerli değil.",
    keyRequired: (keyLabel) => `${keyLabel} gerekli.`,
    keyInMemory: "Anahtar yalnızca bu istek boyunca bellekte kalır.",
    unexpected: "Beklenmedik bir şey ters gitti.",
    provider: "Sağlayıcı",
    model: "Model",
    attempt: (attempt) => `${attempt}. deneme`,
    stop: "Durdur",
  },
  learningBlockList: (blocks) => trList(blocks.map((block) => trBlockNouns[block])),
};

const shared = { en, tr };

export default shared;
