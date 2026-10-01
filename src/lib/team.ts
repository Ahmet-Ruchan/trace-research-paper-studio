import { z } from "zod";
import type { ReaderNote } from "./reader-notes";
import type { ClaimReview, ClaimVote, ResearchProject } from "./schema";

/**
 * Ekip kipi: hesaplar, birlikte onay ve paylaşılan notlar.
 *
 * Stüdyo varsayılan olarak tek okuyucunun; hesap yok. İlk hesap açılınca ekip
 * kipi başlıyor: stüdyo ve API'si oturum açmış bir üye istiyor, iddia kararları
 * üyelerin oylarından hesaplanıyor, notların bir yazarı oluyor ve yazarı
 * paylaşmadıkça başkası görmüyor.
 *
 * Bu dosya saf: kurallar ve hesaplar. Dosya, parola özeti ve oturumlar
 * `server/team-store.ts`'te.
 */

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;
export const MAX_APPROVALS = 5;

export const memberNameSchema = z
  .string()
  .trim()
  .min(1, "A name is required.")
  .max(60, "A name is at most 60 characters.")
  .refine((name) => !/[\u0000-\u001f]/.test(name), "A name cannot hold control characters.");

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD, `A password has at least ${MIN_PASSWORD} characters.`)
  .max(MAX_PASSWORD, `A password has at most ${MAX_PASSWORD} characters.`);

export type MemberRole = "owner" | "member";
export type TeamMember = { id: string; name: string; role: MemberRole };

/** Adlar büyük-küçük harf ve boşluk farkı gözetmeden tek. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");

/* ------------------------------ Birlikte onay ------------------------------ */

/**
 * Oylardan karar: biri reddettiyse reddedilmiş (bir ret tartışılmadan
 * geçilmesin; reddeden oyunu geri alabilir), en az `needed` üye onayladıysa
 * onaylı, yoksa karar yok (bekliyor).
 */
export function decideFromVotes(votes: readonly ClaimVote[], needed: number): ClaimReview | undefined {
  const names = (list: readonly ClaimVote[]) => list.map((vote) => vote.by).join(", ").slice(0, 80);
  const latest = (list: readonly ClaimVote[]) => list.map((vote) => vote.at).sort().at(-1)!;
  const rejected = votes.filter((vote) => vote.status === "rejected");
  if (rejected.length) {
    const note = rejected.map((vote) => vote.note).find(Boolean);
    return { status: "rejected", by: names(rejected), at: latest(rejected), ...(note ? { note } : {}) };
  }
  const approved = votes.filter((vote) => vote.status === "approved");
  if (approved.length >= Math.max(1, needed)) return { status: "approved", by: names(approved), at: latest(approved) };
  return undefined;
}

/** Bir üyenin oyu (ya da `undefined` ile geri çekmesi); karar yeniden hesaplanıyor. */
export function castVote(project: ResearchProject, claimId: string, member: TeamMember, vote: Omit<ClaimVote, "memberId" | "by"> | undefined, needed: number): ResearchProject {
  if (!project.evidence.claims.some((claim) => claim.id === claimId)) return project;
  const votes = { ...(project.claimReviewVotes ?? {}) };
  const others = (votes[claimId] ?? []).filter((item) => item.memberId !== member.id);
  const mine = vote ? [{ ...vote, memberId: member.id, by: member.name.slice(0, 80) }] : [];
  votes[claimId] = [...others, ...mine];
  return withDecisions(project, votes, needed, project.claimReviews);
}

/**
 * Kararları oylardan yazıyor. Oyu olmayan iddiada ekipten önceki karar
 * (`legacy`) kalıyor; oy verildiği anda kararı oylar belirliyor.
 */
function withDecisions(project: ResearchProject, votes: Record<string, ClaimVote[]>, needed: number, legacy: ResearchProject["claimReviews"]): ResearchProject {
  const known = new Set(project.evidence.claims.map((claim) => claim.id));
  const keptVotes = Object.fromEntries(Object.entries(votes).filter(([id, list]) => known.has(id) && list.length));
  const reviews: Record<string, ClaimReview> = {};
  for (const [id, review] of Object.entries(legacy ?? {})) if (known.has(id) && !keptVotes[id]) reviews[id] = review;
  for (const [id, list] of Object.entries(keptVotes)) {
    const decision = decideFromVotes(list, needed);
    if (decision) reviews[id] = decision;
  }
  return {
    ...project,
    claimReviews: Object.keys(reviews).length ? reviews : undefined,
    claimReviewVotes: Object.keys(keptVotes).length ? keptVotes : undefined,
  };
}

/**
 * Sunucuda, ekip kipinde bir proje kaydedilirken: üye yalnızca KENDİ oyunu
 * değiştirebiliyor. Başkalarının oyları diskteki kayıttan alınıyor (sahte oy
 * yazılamıyor, aynı anda inceleyen iki üyenin oyu birbirini silmiyor) ve
 * kararlar oylardan yeniden hesaplanıyor (karar alanı elle yazılamıyor).
 */
export function mergeVotes(stored: ResearchProject | undefined, incoming: ResearchProject, member: TeamMember, needed: number): ResearchProject {
  const claimIds = new Set([...Object.keys(stored?.claimReviewVotes ?? {}), ...Object.keys(incoming.claimReviewVotes ?? {})]);
  const votes: Record<string, ClaimVote[]> = {};
  for (const id of claimIds) {
    const others = (stored?.claimReviewVotes?.[id] ?? []).filter((vote) => vote.memberId !== member.id);
    const mine = (incoming.claimReviewVotes?.[id] ?? []).filter((vote) => vote.memberId === member.id).slice(0, 1).map((vote) => ({ ...vote, by: member.name.slice(0, 80) }));
    votes[id] = [...others, ...mine];
  }
  return withDecisions(incoming, votes, needed, stored?.claimReviews);
}

/* ------------------------------ Paylaşılan notlar ------------------------------ */

/** Notun sahibi: yazarı, yoksa (ekipten önce yazılmış) kütüphanenin sahibi. */
export const noteOwner = (note: ReaderNote, ownerId: string | undefined) => note.author ?? ownerId;

/** Bir üyenin gördüğü notlar: kendi notları ve başkalarının paylaştıkları (adlarıyla). */
export function visibleNotes(notes: readonly ReaderNote[], member: TeamMember, ownerId: string | undefined, names: ReadonlyMap<string, string>): ReaderNote[] {
  return notes.flatMap((note): ReaderNote[] => {
    const owner = noteOwner(note, ownerId);
    if (owner === member.id) {
      const { authorName: _shown, ...own } = note;
      void _shown;
      return [{ ...own, author: member.id }];
    }
    if (!note.shared) return [];
    return [{ ...note, authorName: (owner && names.get(owner)) || "A former member" }];
  });
}

/**
 * Bir üyenin kaydettiği liste: gönderdiklerinden yalnızca kendi notları
 * (yazarı yok ya da kendisi) alınıyor, başkalarının notları diskteki gibi
 * kalıyor.
 */
export function mergeNotes(stored: readonly ReaderNote[], incoming: readonly ReaderNote[], member: TeamMember, ownerId: string | undefined): ReaderNote[] {
  const others = stored.filter((note) => noteOwner(note, ownerId) !== member.id);
  const mine = incoming
    .filter((note) => !note.author || note.author === member.id)
    .map((note) => {
      const { authorName: _shown, ...own } = note;
      void _shown;
      return { ...own, author: member.id };
    });
  const taken = new Set(others.map((note) => note.id));
  return [...others, ...mine.filter((note) => !taken.has(note.id))];
}

/* ------------------------------ Erişim ------------------------------ */

/**
 * Ekip kipinde oturumsuz açık kalan yollar: stüdyonun sayfası (giriş ekranını
 * gösteriyor), derlenmiş dosyalar, giriş ve ekip durumu, uygulama kabuğu.
 * Geri kalan her şey bir üye istiyor.
 */
export function openWithoutSession(pathname: string) {
  return (
    pathname === "/" ||
    pathname.startsWith("/_next/") ||
    pathname === "/api/team" ||
    pathname === "/api/team/session" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/examples/")
  );
}
