"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LogOut, Trash2, UserPlus, Users } from "lucide-react";
import { MAX_APPROVALS, MIN_PASSWORD, type TeamMember } from "@/lib/team";

/**
 * Ekip kipi istemcide (`team.ts`): durum, giriş ekranı ve profildeki ekip
 * kartı. Ekip kipi kapalıyken stüdyo eskisi gibi; açıkken oturum açmamış
 * birine yalnızca giriş ekranı gösteriliyor (API'ler zaten üye istiyor).
 */

export type TeamState =
  | { status: "loading" }
  | { status: "off" }
  | { status: "signed-out" }
  | { status: "on"; me: TeamMember; members: TeamMember[]; approvalsNeeded: number };

type TeamValue = { state: TeamState; refresh: () => Promise<void> };

const TeamContext = createContext<TeamValue>({ state: { status: "off" }, refresh: async () => undefined });

export const useTeam = () => useContext(TeamContext);
/** Ekip kipinde oturum açmış üye ve kural; tek okuyucuda `undefined`. */
export function useTeamMember() {
  const { state } = useTeam();
  return state.status === "on" ? state : undefined;
}

async function readState(): Promise<TeamState> {
  try {
    const response = await fetch("/api/team", { cache: "no-store" });
    const data = (await response.json()) as { enabled?: boolean; me?: TeamMember; members?: TeamMember[]; approvalsNeeded?: number };
    if (!data.enabled) return { status: "off" };
    if (!data.me) return { status: "signed-out" };
    return { status: "on", me: data.me, members: data.members ?? [data.me], approvalsNeeded: data.approvalsNeeded ?? 1 };
  } catch {
    // Sunucuya ulaşılamıyor (çevrimdışı): stüdyo saklanan kopyayla açılsın.
    return { status: "off" };
  }
}

export function TeamProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TeamState>({ status: "loading" });
  const refresh = useCallback(async () => setState(await readState()), []);
  useEffect(() => {
    let cancelled = false;
    void readState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return <TeamContext.Provider value={{ state, refresh }}>{children}</TeamContext.Provider>;
}

async function send(path: string, method: string, body?: unknown) {
  const response = await fetch(path, { method, cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  if (!response.ok) throw new Error(data?.error ?? "The team could not be changed.");
  return data;
}

/** Ekip kipinde oturum yoksa giriş ekranı; yoksa stüdyo. */
export function TeamGate({ children }: { children: ReactNode }) {
  const { state } = useTeam();
  if (state.status === "loading") return <div className="boot-screen"><span>trace</span></div>;
  if (state.status === "signed-out") return <SignInView />;
  return <>{children}</>;
}

function SignInView() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <main className="team-sign-in">
      <form
        aria-label="Sign in"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(undefined);
          send("/api/team/session", "POST", { name, password })
            .then(() => window.location.reload())
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : "Signing in failed.");
              setBusy(false);
            });
        }}
      >
        <span className="brand-glyph" aria-hidden="true">t</span>
        <h1>Sign in to Trace</h1>
        <p>This studio is shared by a team. Sign in with the name and password the team&rsquo;s owner gave you.</p>
        <label>
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="username" required maxLength={60} />
        </label>
        <label>
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required maxLength={200} />
        </label>
        <button type="submit" disabled={busy || !name.trim() || !password}>{busy ? "Signing in…" : "Sign in"}</button>
        {error ? <p className="regen-error" role="alert">{error}</p> : null}
      </form>
    </main>
  );
}

/** Profil'de: ekip kipini açmak, kim olduğun, üyeler, onay kuralı, parola, çıkış. */
export function TeamCard() {
  const { state, refresh } = useTeam();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", password: "", confirm: "" });
  const [passwords, setPasswords] = useState({ current: "", next: "" });

  async function run(action: () => Promise<unknown>, done: string, reload = false) {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
      if (reload) {
        window.location.reload();
        return;
      }
      await refresh();
      setMessage({ text: done });
      setForm({ name: "", password: "", confirm: "" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "The team could not be changed.", error: true });
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading" || state.status === "signed-out") return null;
  const mismatch = form.confirm && form.confirm !== form.password;

  return (
    <section className="stats-block profile-team" aria-label="Team">
      <h2><Users size={16} aria-hidden="true" /> Team</h2>
      {state.status === "off" ? (
        <>
          <p>
            Share this studio with a team: everyone signs in with their own name, approving a claim can take more than one
            person, and notes stay with whoever wrote them unless they share them. Create the first account to turn it on; you
            become its owner, and from then on the studio asks everyone to sign in. Turn it on only where the studio is reached
            over HTTPS.
          </p>
          <form
            className="team-form"
            aria-label="Create the first account"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => send("/api/team", "POST", { name: form.name, password: form.password }), "", true);
            }}
          >
            <label><span>Your name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} autoComplete="username" /></label>
            <label><span>Password ({MIN_PASSWORD}+ characters)</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" /></label>
            <label><span>Password again</span><input type="password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} autoComplete="new-password" /></label>
            <button type="submit" className="focus-secondary" disabled={busy || !form.name.trim() || form.password.length < MIN_PASSWORD || form.confirm !== form.password}>Turn on team review</button>
          </form>
          {mismatch ? <p className="stats-note">The two passwords differ.</p> : null}
        </>
      ) : (
        <>
          <p>
            Signed in as <strong>{state.me.name}</strong>{state.me.role === "owner" ? " (owner)" : ""}. A claim is approved when{" "}
            {state.approvalsNeeded === 1 ? "one member approves it" : `${state.approvalsNeeded} members approve it`} and nobody rejects it. Notes are
            yours unless you share them with the team. Study progress, the work timer and this profile are still one for the whole studio.
          </p>
          <ul className="team-members">
            {state.members.map((member) => (
              <li key={member.id}>
                <span>{member.name}</span>
                <small>{member.role === "owner" ? "owner" : "member"}{member.id === state.me.id ? " · you" : ""}</small>
                {state.me.role === "owner" && member.id !== state.me.id ? (
                  <button type="button" className="focus-icon-button" aria-label={`Remove ${member.name} from the team`} disabled={busy} onClick={() => void run(() => send(`/api/team/members?id=${encodeURIComponent(member.id)}`, "DELETE"), `${member.name} was removed. Their notes and votes stay.`)}>
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {state.me.role === "owner" ? (
            <>
              <form
                className="team-form"
                aria-label="Add a member"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = form.name.trim();
                  void run(() => send("/api/team/members", "POST", { name, password: form.password }), `${name} can sign in now. Give them the password; they can change it on their profile.`);
                }}
              >
                <label><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} autoComplete="off" /></label>
                <label><span>First password</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" /></label>
                <button type="submit" className="focus-secondary" disabled={busy || !form.name.trim() || form.password.length < MIN_PASSWORD}><UserPlus size={14} /> Add a member</button>
              </form>
              <label className="team-approvals">
                <span>Approvals a claim needs</span>
                <select value={state.approvalsNeeded} disabled={busy} onChange={(event) => void run(() => send("/api/team", "PUT", { approvalsNeeded: Number(event.target.value) }), "Saved. Decisions already taken stay until someone votes again.")}>
                  {Array.from({ length: MAX_APPROVALS }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
            </>
          ) : null}
          <form
            className="team-form"
            aria-label="Change your password"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await send("/api/team/members", "PATCH", { current: passwords.current, next: passwords.next });
                setPasswords({ current: "", next: "" });
              }, "Your password was changed; your other devices were signed out.");
            }}
          >
            <label><span>Current password</span><input type="password" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} autoComplete="current-password" /></label>
            <label><span>New password</span><input type="password" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} autoComplete="new-password" /></label>
            <button type="submit" className="focus-secondary" disabled={busy || !passwords.current || passwords.next.length < MIN_PASSWORD}>Change your password</button>
          </form>
          <div className="profile-form-actions">
            <button
              type="button"
              className="focus-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await send("/api/team/session", "DELETE");
                  // Ortak bir cihazda sonraki kişi çevrimdışıyken bu üyenin notlarını görmesin (`public/sw.js`).
                  if ("caches" in window) for (const name of await caches.keys()) if (name.startsWith("trace-data-") || name.startsWith("trace-shell-")) await caches.delete(name);
                }, "", true)
              }
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </>
      )}
      {message?.text ? <p className={message.error ? "regen-error" : ""} role={message.error ? "alert" : "status"}>{message.text}</p> : null}
    </section>
  );
}
