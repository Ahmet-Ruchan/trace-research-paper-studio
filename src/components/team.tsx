"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LogOut, Trash2, UserPlus, Users } from "lucide-react";
import { useT } from "@/i18n/client";
import { MAX_APPROVALS, MIN_PASSWORD, type TeamMember } from "@/lib/team";
import { LanguageToggle } from "./language-toggle";

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

/** `fallback`: sunucu bir hata metni vermezse gösterilen, arayüzün dilinde. */
async function send(fallback: string, path: string, method: string, body?: unknown) {
  const response = await fetch(path, { method, cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  if (!response.ok) throw new Error(data?.error ?? fallback);
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
  const t = useT().studio.team;
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <main className="team-sign-in">
      {/* Giriş ekranında üst menü yok; oturum açmamış biri de dili buradan değiştirebiliyor. */}
      <LanguageToggle className="studio-nav-language team-sign-in-language" />
      <form
        aria-label={t.signIn}
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(undefined);
          send(t.couldNotChange, "/api/team/session", "POST", { name, password })
            .then(() => window.location.reload())
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : t.signInFailed);
              setBusy(false);
            });
        }}
      >
        <span className="brand-glyph" aria-hidden="true">t</span>
        <h1>{t.signInTitle}</h1>
        <p>{t.signInIntro}</p>
        <label>
          <span>{t.name}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="username" required maxLength={60} />
        </label>
        <label>
          <span>{t.password}</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required maxLength={200} />
        </label>
        <button type="submit" disabled={busy || !name.trim() || !password}>{busy ? t.signingIn : t.signIn}</button>
        {error ? <p className="regen-error" role="alert">{error}</p> : null}
      </form>
    </main>
  );
}

/** Profil'de: ekip kipini açmak, kim olduğun, üyeler, onay kuralı, parola, çıkış. */
export function TeamCard() {
  const t = useT().studio.team;
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
      setMessage({ text: error instanceof Error ? error.message : t.couldNotChange, error: true });
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading" || state.status === "signed-out") return null;
  const mismatch = form.confirm && form.confirm !== form.password;

  return (
    <section className="stats-block profile-team" aria-label={t.team}>
      <h2><Users size={16} aria-hidden="true" /> {t.team}</h2>
      {state.status === "off" ? (
        <>
          <p>{t.offIntro}</p>
          <form
            className="team-form"
            aria-label={t.createFirst}
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => send(t.couldNotChange, "/api/team", "POST", { name: form.name, password: form.password }), "", true);
            }}
          >
            <label><span>{t.yourName}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} autoComplete="username" /></label>
            <label><span>{t.passwordMin(MIN_PASSWORD)}</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" /></label>
            <label><span>{t.passwordAgain}</span><input type="password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} autoComplete="new-password" /></label>
            <button type="submit" className="focus-secondary" disabled={busy || !form.name.trim() || form.password.length < MIN_PASSWORD || form.confirm !== form.password}>{t.turnOn}</button>
          </form>
          {mismatch ? <p className="stats-note">{t.mismatch}</p> : null}
        </>
      ) : (
        <>
          <p>
            {t.signedInAs}<strong>{state.me.name}</strong>{state.me.role === "owner" ? t.ownerMark : ""}{t.signedInRule(state.approvalsNeeded)}
          </p>
          <ul className="team-members">
            {state.members.map((member) => (
              <li key={member.id}>
                <span>{member.name}</span>
                <small>{member.role === "owner" ? t.owner : t.member}{member.id === state.me.id ? t.you : ""}</small>
                {state.me.role === "owner" && member.id !== state.me.id ? (
                  <button type="button" className="focus-icon-button" aria-label={t.removeMember(member.name)} disabled={busy} onClick={() => void run(() => send(t.couldNotChange, `/api/team/members?id=${encodeURIComponent(member.id)}`, "DELETE"), t.removed(member.name))}>
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
                aria-label={t.addMember}
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = form.name.trim();
                  void run(() => send(t.couldNotChange, "/api/team/members", "POST", { name, password: form.password }), t.added(name));
                }}
              >
                <label><span>{t.name}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} autoComplete="off" /></label>
                <label><span>{t.firstPassword}</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" /></label>
                <button type="submit" className="focus-secondary" disabled={busy || !form.name.trim() || form.password.length < MIN_PASSWORD}><UserPlus size={14} /> {t.addMember}</button>
              </form>
              <label className="team-approvals">
                <span>{t.approvalsNeeded}</span>
                <select value={state.approvalsNeeded} disabled={busy} onChange={(event) => void run(() => send(t.couldNotChange, "/api/team", "PUT", { approvalsNeeded: Number(event.target.value) }), t.approvalsSaved)}>
                  {Array.from({ length: MAX_APPROVALS }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
            </>
          ) : null}
          <form
            className="team-form"
            aria-label={t.changePassword}
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await send(t.couldNotChange, "/api/team/members", "PATCH", { current: passwords.current, next: passwords.next });
                setPasswords({ current: "", next: "" });
              }, t.passwordChanged);
            }}
          >
            <label><span>{t.currentPassword}</span><input type="password" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} autoComplete="current-password" /></label>
            <label><span>{t.newPassword}</span><input type="password" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} autoComplete="new-password" /></label>
            <button type="submit" className="focus-secondary" disabled={busy || !passwords.current || passwords.next.length < MIN_PASSWORD}>{t.changePassword}</button>
          </form>
          <div className="profile-form-actions">
            <button
              type="button"
              className="focus-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await send(t.couldNotChange, "/api/team/session", "DELETE");
                  // Ortak bir cihazda sonraki kişi çevrimdışıyken bu üyenin notlarını görmesin (`public/sw.js`).
                  if ("caches" in window) for (const name of await caches.keys()) if (name.startsWith("trace-data-") || name.startsWith("trace-shell-")) await caches.delete(name);
                }, "", true)
              }
            >
              <LogOut size={14} /> {t.signOut}
            </button>
          </div>
        </>
      )}
      {message?.text ? <p className={message.error ? "regen-error" : ""} role={message.error ? "alert" : "status"}>{message.text}</p> : null}
    </section>
  );
}
