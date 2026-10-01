import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as libraryGet, PUT as libraryPut } from "@/app/api/library/route";
import { GET as notesGet, PUT as notesPut } from "@/app/api/library/notes/route";
import { GET as dataGet } from "@/app/api/profile/data/route";
import { DELETE as removeRoute, PATCH as passwordRoute, POST as addRoute } from "@/app/api/team/members/route";
import { GET as teamGet, POST as teamPost, PUT as policyPut } from "@/app/api/team/route";
import { DELETE as signOutRoute, POST as signInRoute } from "@/app/api/team/session/route";
import { proxy } from "@/proxy";
import { loadExampleProject } from "./example-fixture";
import type { ReaderNote } from "./reader-notes";
import type { ClaimVote, ResearchProject } from "./schema";
import { forgetFailedSignIns, memberForCookie, readTeam, SESSION_COOKIE, signIn } from "./server/team-store";
import { castVote, decideFromVotes, mergeNotes, mergeVotes, openWithoutSession, visibleNotes, type TeamMember } from "./team";
import { saveStoredProject } from "./trace-storage";

const ada: TeamMember = { id: "m_ada", name: "Ada", role: "owner" };
const grace: TeamMember = { id: "m_grace", name: "Grace", role: "member" };
const vote = (member: TeamMember, status: "approved" | "rejected", at: string, note?: string): ClaimVote => ({ memberId: member.id, by: member.name, status, at, ...(note ? { note } : {}) });
const example = () => structuredClone(loadExampleProject("attention-is-all-you-need.en.trace.json"));

describe("approving a claim together", () => {
  it("needs enough approvals and no rejection", () => {
    const one = [vote(ada, "approved", "2026-10-01T10:00:00Z")];
    expect(decideFromVotes(one, 2)).toBeUndefined();
    expect(decideFromVotes(one, 1)).toEqual({ status: "approved", by: "Ada", at: "2026-10-01T10:00:00Z" });
    const both = [...one, vote(grace, "approved", "2026-10-01T11:00:00Z")];
    expect(decideFromVotes(both, 2)).toEqual({ status: "approved", by: "Ada, Grace", at: "2026-10-01T11:00:00Z" });
    // Bir ret yeter: onaylar ne olursa olsun reddedilmiş.
    expect(decideFromVotes([...both, vote({ id: "m_x", name: "Lin", role: "member" }, "rejected", "2026-10-01T12:00:00Z", "The quote is on page 5.")], 2)).toEqual({ status: "rejected", by: "Lin", at: "2026-10-01T12:00:00Z", note: "The quote is on page 5." });
  });

  it("records a member's own vote, replaces it and withdraws it", () => {
    const claim = example().evidence.claims[0].id;
    let project = castVote(example(), claim, ada, { status: "approved", at: "2026-10-01T10:00:00Z" }, 2);
    expect(project.claimReviewVotes?.[claim]).toEqual([vote(ada, "approved", "2026-10-01T10:00:00Z")]);
    expect(project.claimReviews?.[claim]).toBeUndefined();
    project = castVote(project, claim, grace, { status: "approved", at: "2026-10-01T11:00:00Z" }, 2);
    expect(project.claimReviews?.[claim]).toMatchObject({ status: "approved", by: "Ada, Grace" });
    project = castVote(project, claim, grace, undefined, 2);
    expect(project.claimReviews?.[claim]).toBeUndefined();
    expect(castVote(project, "no-such-claim", ada, { status: "approved", at: "x" }, 1)).toBe(project);
  });

  it("on the server, keeps the others' votes as stored and takes only the member's own", () => {
    const claim = example().evidence.claims[0].id;
    const other = example().evidence.claims[1].id;
    const stored: ResearchProject = { ...example(), claimReviewVotes: { [claim]: [vote(ada, "approved", "2026-10-01T10:00:00Z")] }, claimReviews: { [other]: { status: "approved", by: "Before the team", at: "2026-09-01T00:00:00Z" } } };
    // Grace sahte bir Ada oyu ve elle yazılmış bir karar gönderiyor; kendi oyu da var.
    const forged: ResearchProject = {
      ...example(),
      claimReviewVotes: { [claim]: [vote(ada, "rejected", "2026-10-01T12:00:00Z"), vote(grace, "approved", "2026-10-01T11:00:00Z")] },
      claimReviews: { [claim]: { status: "approved", by: "Everyone", at: "x" }, [other]: { status: "rejected", by: "Grace", at: "x" } },
    };
    const merged = mergeVotes(stored, forged, grace, 2);
    expect(merged.claimReviewVotes?.[claim]).toEqual([vote(ada, "approved", "2026-10-01T10:00:00Z"), vote(grace, "approved", "2026-10-01T11:00:00Z")]);
    expect(merged.claimReviews?.[claim]).toMatchObject({ status: "approved", by: "Ada, Grace" });
    // Ekipten önceki karar elle değiştirilemiyor; yalnızca oyla.
    expect(merged.claimReviews?.[other]).toEqual({ status: "approved", by: "Before the team", at: "2026-09-01T00:00:00Z" });
    // Aynı anda inceleyen iki üye: Ada'nın eski bir kopyası Grace'in oyunu silmiyor.
    const adaStale: ResearchProject = { ...example(), claimReviewVotes: { [claim]: [vote(ada, "approved", "2026-10-01T10:00:00Z")] } };
    expect(mergeVotes(merged, adaStale, ada, 2).claimReviewVotes?.[claim]).toHaveLength(2);
  });
});

describe("notes in a team", () => {
  const at = "2026-10-01T10:00:00Z";
  const note = (id: string, patch: Partial<ReaderNote> = {}): ReaderNote => ({ id, target: { kind: "claim", claimId: "c1" }, text: id, color: "yellow", createdAt: at, updatedAt: at, ...patch });
  const names = new Map([[ada.id, "Ada"], [grace.id, "Grace"]]);

  it("shows a member their own notes and the ones others share, with the author's name", () => {
    const stored = [note("legacy"), note("ada-private", { author: ada.id }), note("ada-shared", { author: ada.id, shared: true }), note("grace", { author: grace.id }), note("gone", { author: "m_gone", shared: true })];
    expect(visibleNotes(stored, grace, ada.id, names).map((item) => [item.id, item.authorName])).toEqual([["ada-shared", "Ada"], ["grace", undefined], ["gone", "A former member"]]);
    // Ekipten önceki notlar sahibin; ona kendi notu olarak görünüyor.
    expect(visibleNotes(stored, ada, ada.id, names).map((item) => item.id)).toEqual(["legacy", "ada-private", "ada-shared", "gone"]);
  });

  it("saves only a member's own notes and leaves the others' as they were", () => {
    const stored = [note("ada-private", { author: ada.id }), note("ada-shared", { author: ada.id, shared: true }), note("grace-old", { author: grace.id })];
    // Grace, Ada'nın paylaştığı notu değiştirmeye ve silmeye çalışıyor, kendi notunu da değiştiriyor.
    const incoming = [note("ada-shared", { author: ada.id, shared: true, text: "changed by Grace" }), note("grace-new")];
    const merged = mergeNotes(stored, incoming, grace, ada.id);
    expect(merged.map((item) => [item.id, item.author, item.text])).toEqual([
      ["ada-private", ada.id, "ada-private"],
      ["ada-shared", ada.id, "ada-shared"],
      ["grace-new", grace.id, "grace-new"],
    ]);
  });

  it("keeps the studio's page, its files, sign-in and the team status open without a session", () => {
    for (const path of ["/", "/_next/static/chunks/a.js", "/api/team", "/api/team/session", "/favicon.ico", "/examples/x.json"]) expect(openWithoutSession(path), path).toBe(true);
    for (const path of ["/api/library", "/api/team/members", "/api/library/notes", "/other"]) expect(openWithoutSession(path), path).toBe(false);
  });
});

describe("accounts on the server", () => {
  let workspace: string;
  const base = "http://127.0.0.1:3000";
  const json = (path: string, method: string, body?: unknown, cookie?: string) =>
    new Request(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const cookieOf = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] ?? "";

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-team-"));
    process.env.TRACE_DATA_DIR = workspace;
    forgetFailedSignIns();
  });
  afterEach(() => {
    delete process.env.TRACE_DATA_DIR;
    rmSync(workspace, { recursive: true, force: true });
  });

  it("turns team mode on with the first account, signs members in and out, and never stores a password", async () => {
    expect(await (await teamGet(json("/api/team", "GET"))).json()).toEqual({ enabled: false });
    expect((await teamPost(json("/api/team", "POST", { name: "Ada", password: "short" }))).status).toBe(400);
    const created = await teamPost(json("/api/team", "POST", { name: "Ada", password: "correct horse battery" }));
    expect(created.status).toBe(200);
    const adaCookie = cookieOf(created);
    expect(created.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=[^;]+; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000$`));
    expect((await teamPost(json("/api/team", "POST", { name: "Mallory", password: "correct horse battery" }))).status).toBe(409);
    const file = readFileSync(join(workspace, "team.json"), "utf8");
    expect(file).not.toContain("correct horse battery");
    expect(file).not.toContain(adaCookie.split("=")[1]);

    // Durum: oturumsuz yalnızca açık olduğu, oturumla üyeler.
    expect(await (await teamGet(json("/api/team", "GET"))).json()).toEqual({ enabled: true });
    expect(await (await teamGet(json("/api/team", "GET", undefined, adaCookie))).json()).toMatchObject({ enabled: true, me: { name: "Ada", role: "owner" }, approvalsNeeded: 1 });

    // Sahip üye ekliyor; üye ekleyemiyor; aynı ad iki kez olmuyor.
    expect((await addRoute(json("/api/team/members", "POST", { name: "Grace", password: "another long password" }, adaCookie))).status).toBe(200);
    expect((await addRoute(json("/api/team/members", "POST", { name: " grace ", password: "another long password" }, adaCookie))).status).toBe(409);
    const graceIn = await signInRoute(json("/api/team/session", "POST", { name: "Grace", password: "another long password" }));
    expect(graceIn.status).toBe(200);
    const graceCookie = cookieOf(graceIn);
    expect((await addRoute(json("/api/team/members", "POST", { name: "Eve", password: "another long password" }, graceCookie))).status).toBe(403);
    expect((await policyPut(json("/api/team", "PUT", { approvalsNeeded: 2 }, graceCookie))).status).toBe(403);
    expect(await (await policyPut(json("/api/team", "PUT", { approvalsNeeded: 2 }, adaCookie))).json()).toMatchObject({ approvalsNeeded: 2 });

    // Çıkış oturumu siliyor.
    expect(memberForCookie(graceCookie)?.name).toBe("Grace");
    await signOutRoute(json("/api/team/session", "DELETE", undefined, graceCookie));
    expect(memberForCookie(graceCookie)).toBeUndefined();

    // Son sahip çıkarılamıyor; çıkarılan üyenin oturumları kapanıyor.
    const adaId = readTeam().members.find((member) => member.name === "Ada")!.id;
    const graceId = readTeam().members.find((member) => member.name === "Grace")!.id;
    expect((await removeRoute(json(`/api/team/members?id=${adaId}`, "DELETE", undefined, adaCookie))).status).toBe(409);
    const again = cookieOf(await signInRoute(json("/api/team/session", "POST", { name: "Grace", password: "another long password" })));
    expect((await removeRoute(json(`/api/team/members?id=${graceId}`, "DELETE", undefined, adaCookie))).status).toBe(200);
    expect(memberForCookie(again)).toBeUndefined();
  });

  it("pauses a name after five wrong passwords, and changing a password closes the other sessions", async () => {
    await teamPost(json("/api/team", "POST", { name: "Ada", password: "correct horse battery" }));
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await signInRoute(json("/api/team/session", "POST", { name: "Ada", password: "wrong password!" }))).status).toBe(401);
    const paused = await signInRoute(json("/api/team/session", "POST", { name: "Ada", password: "correct horse battery" }));
    expect(paused.status).toBe(429);
    // Bilinmeyen bir ad da aynı yanıt: ad var mı yok mu belli olmuyor.
    expect(await (await signInRoute(json("/api/team/session", "POST", { name: "Nobody", password: "whatever password" }))).json()).toEqual({ error: "The name or the password is wrong." });
    forgetFailedSignIns();
    const laptop = signIn("Ada", "correct horse battery").token;
    const phone = signIn("Ada", "correct horse battery").token;
    const laptopCookie = `${SESSION_COOKIE}=${laptop}`;
    expect((await passwordRoute(json("/api/team/members", "PATCH", { current: "wrong", next: "a new long password" }, laptopCookie))).status).toBe(403);
    expect((await passwordRoute(json("/api/team/members", "PATCH", { current: "correct horse battery", next: "a new long password" }, laptopCookie))).status).toBe(200);
    expect(memberForCookie(laptopCookie)?.name).toBe("Ada");
    expect(memberForCookie(`${SESSION_COOKIE}=${phone}`)).toBeUndefined();
    expect(() => signIn("Ada", "correct horse battery")).toThrow("The name or the password is wrong.");
  });

  it("asks for a member everywhere but the page and sign-in, once there is a team", async () => {
    const request = (path: string, cookie?: string) => new NextRequest(`${base}${path}`, { headers: cookie ? { cookie } : {} });
    expect(proxy(request("/api/library"))).toBeUndefined();
    const adaCookie = cookieOf(await teamPost(json("/api/team", "POST", { name: "Ada", password: "correct horse battery" })));
    const blocked = proxy(request("/api/library"));
    expect(blocked?.status).toBe(401);
    expect(await blocked?.json()).toEqual({ error: "Sign in to the studio first." });
    expect(proxy(request("/api/library", adaCookie))).toBeUndefined();
    expect(proxy(request("/"))).toBeUndefined();
    expect(proxy(request("/api/team/session"))).toBeUndefined();
    expect(proxy(request("/p/abc"))).toBeUndefined();
    expect(proxy(request("/manifest.webmanifest"))).toBeUndefined();
    expect(proxy(request("/api/library", `${SESSION_COOKIE}=forged`))?.status).toBe(401);
    // Bozuk bir ekip dosyası ekip kipini sessizce kapatmıyor: kimse giremiyor.
    writeFileSync(join(workspace, "team.json"), "{ broken");
    expect(proxy(request("/api/library", adaCookie))?.status).toBe(401);
  });

  it("keeps each member's notes, shows the shared ones, and lets a member change only their own vote", async () => {
    const adaCookie = cookieOf(await teamPost(json("/api/team", "POST", { name: "Ada", password: "correct horse battery" })));
    await addRoute(json("/api/team/members", "POST", { name: "Grace", password: "another long password" }, adaCookie));
    await policyPut(json("/api/team", "PUT", { approvalsNeeded: 2 }, adaCookie));
    const graceCookie = cookieOf(await signInRoute(json("/api/team/session", "POST", { name: "Grace", password: "another long password" })));
    const project = example();
    await saveStoredProject(project);
    const claim = project.evidence.claims[0].id;
    const at = new Date().toISOString();
    const notesUrl = `/api/library/notes?id=${project.id}`;
    await notesPut(json(notesUrl, "PUT", { notes: [
      { id: "a1", target: { kind: "claim", claimId: claim }, text: "Ada's private thought.", createdAt: at, updatedAt: at },
      { id: "a2", target: { kind: "claim", claimId: claim }, text: "Ada shares this.", shared: true, createdAt: at, updatedAt: at },
    ] }, adaCookie));
    await notesPut(json(notesUrl, "PUT", { notes: [{ id: "g1", target: { kind: "claim", claimId: claim }, text: "Grace's note.", createdAt: at, updatedAt: at }] }, graceCookie));
    const forGrace = (await (await notesGet(json(notesUrl, "GET", undefined, graceCookie))).json()) as { notes: ReaderNote[] };
    expect(forGrace.notes.map((note) => [note.text, note.authorName])).toEqual([["Ada shares this.", "Ada"], ["Grace's note.", undefined]]);
    const forAda = (await (await notesGet(json(notesUrl, "GET", undefined, adaCookie))).json()) as { notes: ReaderNote[] };
    expect(forAda.notes.map((note) => note.text)).toEqual(["Ada's private thought.", "Ada shares this."]);
    // Oturumsuz not yok; bütün kütüphanenin notları da süzülüyor; tam dışa aktarım yalnızca sahibin.
    expect((await notesGet(json(notesUrl, "GET"))).status).toBe(401);
    expect(JSON.stringify(await (await notesGet(json("/api/library/notes", "GET", undefined, graceCookie))).json())).not.toContain("private thought");
    expect((await dataGet(json("/api/profile/data", "GET", undefined, graceCookie))).status).toBe(403);
    expect((await dataGet(json("/api/profile/data", "GET", undefined, adaCookie))).status).toBe(200);

    // Oylar: Grace kendi oyunu veriyor ve Ada adına sahte bir ret ekliyor; sunucu yalnızca kendi oyunu alıyor.
    const [adaMember, graceMember] = readTeam().members.map((member) => ({ id: member.id, name: member.name, role: member.role }));
    const withVotes = { ...project, claimReviewVotes: { [claim]: [vote(graceMember, "approved", at), vote(adaMember, "rejected", at)] } };
    expect((await libraryPut(json("/api/library", "PUT", withVotes, graceCookie))).status).toBe(200);
    const saved = ((await (await libraryGet()).json()) as { projects: ResearchProject[] }).projects[0];
    expect(saved.claimReviewVotes?.[claim]).toHaveLength(1);
    expect(saved.claimReviewVotes?.[claim]?.[0]).toMatchObject({ by: "Grace", status: "approved" });
    // İki onay gerekiyor: henüz karar yok.
    expect(saved.claimReviews?.[claim]).toBeUndefined();
    expect((await libraryPut(json("/api/library", "PUT", project))).status).toBe(401);
  });
});
