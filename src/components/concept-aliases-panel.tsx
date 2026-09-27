"use client";

import { useState } from "react";
import { Link2, Sparkles, Unlink } from "lucide-react";
import { getProvider } from "@/lib/model-providers";
import type { useConceptAliases } from "./study-progress";
import { ModelKeyFields, useRememberedAssignment } from "./model-key-fields";

type Side = { term: string; paper: string; definition: string };
type Proposal = { a: Side; b: Side; why: string };
type Lookup = { status: "idle" } | { status: "loading" } | { status: "done"; proposals: Proposal[]; model: string } | { status: "failed"; message: string };

/**
 * Farklı adlarla anlatılan aynı kavram (`concept-aliases.ts`). Okuyucu iki
 * adı kendisi eşleyebiliyor ya da bir modele sorabiliyor; model yalnızca
 * öneriyor, her çifte okuyucu "aynı" ya da "farklı" diyor.
 */
export function ConceptAliasesPanel({ aliases }: { aliases: ReturnType<typeof useConceptAliases> }) {
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
      setError(caught instanceof Error ? caught.message : "The concept link could not be saved.");
      return false;
    }
  }

  async function propose() {
    if (!provider.local && !apiKey.trim()) return setLookup({ status: "failed", message: `${provider.keyLabel} is required.` });
    setLookup({ status: "loading" });
    try {
      const response = await fetch("/api/library/aliases/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment, apiKey: apiKey.trim() }),
      });
      const data = (await response.json().catch(() => undefined)) as { proposals?: Proposal[]; model?: string; error?: string } | undefined;
      if (!response.ok || !data?.proposals) throw new Error(data?.error ?? "The model could not be asked.");
      setLookup({ status: "done", proposals: data.proposals, model: data.model ?? assignment.model });
    } catch (caught) {
      setLookup({ status: "failed", message: caught instanceof Error ? caught.message : "The model could not be asked." });
    }
  }

  async function answer(proposal: Proposal, decision: "same" | "different") {
    if (!(await decide(proposal.a.term, proposal.b.term, decision, "model", proposal.why))) return;
    setLookup((current) => (current.status === "done" ? { ...current, proposals: current.proposals.filter((item) => item !== proposal) } : current));
  }

  return (
    <section className="concept-aliases" aria-label="Names for the same concept">
      <div className="block-title"><Link2 size={16} /> Names for the same concept</div>
      <p>
        Concepts are matched by name, so one idea under two names stays two concepts. Link them yourself, or ask a model which
        names in your library may mean the same thing; it only proposes, and nothing is linked until you say so. Links are kept in
        your library, never in a paper.
      </p>

      {linked.length ? (
        <ul className="alias-links">
          {linked.map((item) => (
            <li key={`${item.terms[0]}|${item.terms[1]}`}>
              <span><strong>{item.terms[0]}</strong> = <strong>{item.terms[1]}</strong></span>
              <small>{item.proposedBy === "model" ? "proposed by a model, confirmed by you" : "linked by you"}</small>
              <button type="button" onClick={() => { void decide(item.terms[0], item.terms[1], "forget"); }} aria-label={`Unlink ${item.terms[0]} and ${item.terms[1]}`}>
                <Unlink size={13} /> Unlink
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {apart ? <p className="alias-apart">{apart === 1 ? "One pair was" : `${apart} pairs were`} marked as different and will not be proposed again.</p> : null}

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
        <input list="concept-names" aria-label="First name" placeholder="A concept…" value={first} onChange={(event) => setFirst(event.target.value)} />
        <span aria-hidden="true">=</span>
        <input list="concept-names" aria-label="Second name" placeholder="…and its other name" value={second} onChange={(event) => setSecond(event.target.value)} />
        <button type="submit" disabled={!first.trim() || !second.trim()}>Link them</button>
      </form>
      {error ? <p className="regen-error" role="alert">{error}</p> : null}

      <details className="alias-ask">
        <summary><Sparkles size={14} aria-hidden="true" /> Ask a model for other names</summary>
        <p>The model sees the names of the concepts in your library and the definitions their papers give, nothing else.</p>
        <ModelKeyFields assignment={assignment} onAssignment={choose} apiKey={apiKey} onApiKey={setApiKey} />
        <button type="button" className="regen-primary" disabled={lookup.status === "loading"} onClick={() => { void propose(); }}>
          {lookup.status === "loading" ? "Reading the names…" : "Look for other names"}
        </button>
        {lookup.status === "failed" ? <p className="regen-error" role="alert">{lookup.message}</p> : null}
        {lookup.status === "done" ? (
          lookup.proposals.length ? (
            <ul className="alias-proposals" aria-label="Proposed pairs">
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
                    <button type="button" onClick={() => { void answer(proposal, "same"); }}>Same concept</button>
                    <button type="button" onClick={() => { void answer(proposal, "different"); }}>Different</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p>{lookup.model} found no other names for the same concept.</p>
          )
        ) : null}
      </details>
    </section>
  );
}
