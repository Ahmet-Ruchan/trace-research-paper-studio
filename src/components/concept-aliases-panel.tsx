"use client";

import { useState } from "react";
import { Link2, Sparkles, Unlink } from "lucide-react";
import { useT } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";
import { getProvider, localizedProvider } from "@/lib/model-providers";
import type { useConceptAliases } from "./study-progress";
import { ModelKeyFields, useRememberedAssignment } from "./model-key-fields";

type Side = { term: string; paper: string; definition: string };
type Proposal = { a: Side; b: Side; why: string };
type Coverage = { names: number; parts: number; failedParts: number; unread: number };
type Lookup = { status: "idle" } | { status: "loading" } | ({ status: "done"; proposals: Proposal[]; model: string } & Coverage) | { status: "failed"; message: string };

/** Büyük bir kütüphanede adlar parçalar hâlinde okunuyor; okuyucu hangisinin okunmadığını bilmeli. */
function coverageNote(t: Messages["learning"]["conceptAliases"], { names, parts, failedParts, unread }: Coverage) {
  if (parts <= 1 && !unread) return null;
  const notes = [t.coverage(names, parts)];
  if (failedParts) notes.push(t.failedParts(failedParts, parts));
  if (unread) notes.push(t.unread(unread));
  return notes.join(" ");
}

/**
 * Farklı adlarla anlatılan aynı kavram (`concept-aliases.ts`). Okuyucu iki
 * adı kendisi eşleyebiliyor ya da bir modele sorabiliyor; model yalnızca
 * öneriyor, her çifte okuyucu "aynı" ya da "farklı" diyor.
 */
export function ConceptAliasesPanel({ aliases }: { aliases: ReturnType<typeof useConceptAliases> }) {
  const messages = useT();
  const t = messages.learning.conceptAliases;
  const [assignment, choose] = useRememberedAssignment();
  const [apiKey, setApiKey] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [error, setError] = useState<string>();
  const provider = getProvider(assignment.provider)!;
  if (aliases.state.status !== "ready") {
    return aliases.state.status === "failed" ? <p className="regen-error" role="alert">{aliases.state.message}</p> : null;
  }
  const { file, names } = aliases.state;
  const linked = file.decisions.filter((item) => item.decision === "same");
  const apart = file.decisions.filter((item) => item.decision === "different").length;

  async function decide(a: string, b: string, decision: "same" | "different" | "forget", proposedBy: "reader" | "model" = "reader", reason?: string) {
    setError(undefined);
    try {
      await aliases.decide(a, b, decision, proposedBy, reason);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.saveFailed);
      return false;
    }
  }

  async function propose() {
    if (!provider.local && !apiKey.trim()) return setLookup({ status: "failed", message: t.keyRequired(localizedProvider(provider, messages.studio.models.providers).keyLabel) });
    setLookup({ status: "loading" });
    try {
      const response = await fetch("/api/library/aliases/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment, apiKey: apiKey.trim() }),
      });
      const data = (await response.json().catch(() => undefined)) as ({ proposals?: Proposal[]; model?: string; error?: string } & Partial<Coverage>) | undefined;
      if (!response.ok || !data?.proposals) throw new Error(data?.error ?? t.askFailed);
      setLookup({
        status: "done",
        proposals: data.proposals,
        model: data.model ?? assignment.model,
        names: data.names ?? names.length,
        parts: data.parts ?? 1,
        failedParts: data.failedParts ?? 0,
        unread: data.unread ?? 0,
      });
    } catch (caught) {
      setLookup({ status: "failed", message: caught instanceof Error ? caught.message : t.askFailed });
    }
  }

  async function answer(proposal: Proposal, decision: "same" | "different") {
    if (!(await decide(proposal.a.term, proposal.b.term, decision, "model", proposal.why))) return;
    setLookup((current) => (current.status === "done" ? { ...current, proposals: current.proposals.filter((item) => item !== proposal) } : current));
  }

  return (
    <section className="concept-aliases" aria-label={t.title}>
      <div className="block-title"><Link2 size={16} /> {t.title}</div>
      <p>
        {t.intro}
      </p>

      {linked.length ? (
        <ul className="alias-links">
          {linked.map((item) => (
            <li key={`${item.terms[0]}|${item.terms[1]}`}>
              <span><strong>{item.terms[0]}</strong> = <strong>{item.terms[1]}</strong></span>
              <small>{item.proposedBy === "model" ? t.byModel : t.byYou}</small>
              <button type="button" onClick={() => { void decide(item.terms[0], item.terms[1], "forget"); }} aria-label={t.unlinkLabel(item.terms[0], item.terms[1])}>
                <Unlink size={13} /> {t.unlink}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {apart ? <p className="alias-apart">{t.apart(apart)}</p> : null}

      <form
        className="alias-manual"
        onSubmit={(event) => {
          event.preventDefault();
          void decide(first, second, "same").then((ok) => {
            if (ok) {
              setFirst("");
              setSecond("");
            }
          });
        }}
      >
        <datalist id="concept-names">{names.map((name) => <option key={name} value={name} />)}</datalist>
        <input list="concept-names" aria-label={t.firstName} placeholder={t.firstPlaceholder} value={first} onChange={(event) => setFirst(event.target.value)} />
        <span aria-hidden="true">=</span>
        <input list="concept-names" aria-label={t.secondName} placeholder={t.secondPlaceholder} value={second} onChange={(event) => setSecond(event.target.value)} />
        <button type="submit" disabled={!first.trim() || !second.trim()}>{t.link}</button>
      </form>
      {error ? <p className="regen-error" role="alert">{error}</p> : null}

      <details className="alias-ask">
        <summary><Sparkles size={14} aria-hidden="true" /> {t.ask}</summary>
        <p>{t.askNote}</p>
        <ModelKeyFields assignment={assignment} onAssignment={choose} apiKey={apiKey} onApiKey={setApiKey} />
        <button type="button" className="regen-primary" disabled={lookup.status === "loading"} onClick={() => { void propose(); }}>
          {lookup.status === "loading" ? t.readingNames(names.length) : t.look}
        </button>
        {lookup.status === "failed" ? <p className="regen-error" role="alert">{lookup.message}</p> : null}
        {lookup.status === "done" && coverageNote(t, lookup) ? <p className="alias-coverage" role="status">{coverageNote(t, lookup)}</p> : null}
        {lookup.status === "done" ? (
          lookup.proposals.length ? (
            <ul className="alias-proposals" aria-label={t.proposed}>
              {lookup.proposals.map((proposal) => (
                <li key={`${proposal.a.term}|${proposal.b.term}`}>
                  <div className="alias-sides">
                    {[proposal.a, proposal.b].map((side) => (
                      <div key={side.term}>
                        <strong>{side.term}</strong>
                        <small>{side.paper}</small>
                        <p>{side.definition}</p>
                      </div>
                    ))}
                  </div>
                  <p className="alias-why">{proposal.why}</p>
                  <div className="alias-actions">
                    <button type="button" onClick={() => { void answer(proposal, "same"); }}>{t.same}</button>
                    <button type="button" onClick={() => { void answer(proposal, "different"); }}>{t.different}</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t.noneFound(lookup.model)}</p>
          )
        ) : null}
      </details>
    </section>
  );
}
