"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ExternalLink, Network, X } from "lucide-react";
import { loadCitationGraph, type CitationGraph, type GraphNode } from "@/lib/paper-lookup";
import type { ResearchProject } from "@/lib/schema";

/**
 * Atıf grafiği: makalenin dayandığı çalışmalar solda, onu izleyenler sağda.
 *
 * Bu panel KANIT göstermiyor. Buradaki hiçbir şey makalenin sayfalarından
 * gelmiyor; OpenAlex'in dizininden geliyor, atıf sayıları eskiyor ve proje
 * dosyasına yazılmıyor. Panel bunu açıkça söylüyor ve verinin alındığı tarihi
 * gösteriyor — Trace'in geri kalanındaki "her cümle bir sayfaya bağlı" sözüyle
 * karışmasın.
 */
export function CitationPanel({
  project,
  onAnalyse,
  onClose,
}: {
  project: ResearchProject;
  onAnalyse: (node: GraphNode) => void;
  onClose: () => void;
}) {
  const [graph, setGraph] = useState<CitationGraph>();
  const [error, setError] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const { title, doi } = project.evidence.paper;
  // Dizi her kayıtta yeni bir kimlik alıyor; içerik aynıyken yeniden sorulmasın.
  const authorKey = project.evidence.paper.authors.join("|");

  useEffect(() => {
    let active = true;
    loadCitationGraph({ title, authors: authorKey ? authorKey.split("|") : [], doi })
      .then((value) => { if (active) setGraph(value); })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "The citation graph could not be loaded.");
      });
    return () => { active = false; };
  }, [title, authorKey, doi]);

  return (
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="citation-title">
      <div className="regen-panel wide citation-panel">
        <header className="regen-header">
          <div>
            <span><Network size={13} /> Citation graph</span>
            <h2 id="citation-title">What this paper builds on, and what built on it</h2>
            <p>
              The most-cited works on each side, from OpenAlex. This is context, not evidence: none of it comes from the
              paper&apos;s pages, the counts change over time, and it is not saved into the project.
            </p>
          </div>
          <button className="regen-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="regen-body">
          {error && <p className="regen-error" role="alert">{error}</p>}
          {!graph && !error && <p className="history-empty">Looking the paper up in OpenAlex…</p>}
          {graph && !graph.ok && (
            <p className="history-empty">
              No citation graph for this paper: {graph.skipped ?? graph.error ?? "OpenAlex did not answer"}. Trace only
              accepts an exact title match, because a graph for the wrong paper is worse than none.
            </p>
          )}
          {graph?.ok && (
            <>
              <p className="citation-summary">
                <strong>{graph.referenceCount.toLocaleString("en")}</strong> references ·{" "}
                <strong>{graph.citedByCount.toLocaleString("en")}</strong> citing works · retrieved{" "}
                {new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(graph.retrievedAt))}{" "}
                · <a href={graph.openAlexUrl} target="_blank" rel="noreferrer">full record on OpenAlex <ExternalLink size={10} /></a>
              </p>
              <GraphMap graph={graph} focused={focused} onFocus={setFocused} />
              <div className="citation-columns">
                <NodeList heading="Builds on" empty="OpenAlex lists no references for this record." nodes={graph.references} focused={focused} onFocus={setFocused} onAnalyse={onAnalyse} />
                <NodeList heading="Cited by" empty="No citing works are indexed yet." nodes={graph.citedBy} focused={focused} onFocus={setFocused} onAnalyse={onAnalyse} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const byYear = (nodes: GraphNode[]) => [...nodes].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
const radius = (node: GraphNode) => 3.5 + 2.2 * Math.log10(1 + node.citationCount);
const clip = (value: string, length: number) => (value.length > length ? `${value.slice(0, length - 1)}…` : value);

function GraphMap({
  graph,
  focused,
  onFocus,
}: {
  graph: Extract<CitationGraph, { ok: true }>;
  focused?: string;
  onFocus: (id?: string) => void;
}) {
  const layout = useMemo(() => {
    const left = byYear(graph.references);
    const right = byYear(graph.citedBy);
    const rows = Math.max(left.length, right.length, 1);
    const height = rows * 26 + 36;
    const place = (nodes: GraphNode[], x: number) =>
      nodes.map((node, index) => ({ node, x, y: 18 + ((index + 0.5) * (height - 36)) / Math.max(nodes.length, 1) }));
    return { height, left: place(left, 250), right: place(right, 510), center: { x: 380, y: height / 2 } };
  }, [graph]);

  const { center } = layout;
  return (
    <svg className="citation-map" viewBox={`0 0 760 ${layout.height}`} role="img" aria-label="Citation map: references on the left, citing works on the right">
      {[...layout.left, ...layout.right].map(({ node, x, y }) => (
        <path
          key={`edge-${node.openAlexId}`}
          className={focused === node.openAlexId ? "is-focused" : undefined}
          d={`M ${x} ${y} C ${(x + center.x) / 2} ${y}, ${(x + center.x) / 2} ${center.y}, ${center.x} ${center.y}`}
        />
      ))}
      {[...layout.left.map((item) => ({ ...item, side: "left" as const })), ...layout.right.map((item) => ({ ...item, side: "right" as const }))].map(({ node, x, y, side }) => (
        <g
          key={node.openAlexId}
          className={focused === node.openAlexId ? "citation-node is-focused" : "citation-node"}
          onMouseEnter={() => onFocus(node.openAlexId)}
          onMouseLeave={() => onFocus(undefined)}
        >
          <circle cx={x} cy={y} r={radius(node)} />
          <text x={side === "left" ? x - radius(node) - 6 : x + radius(node) + 6} y={y + 3} textAnchor={side === "left" ? "end" : "start"}>
            {node.year ? `${node.year} · ` : ""}{clip(node.title, 34)}
          </text>
        </g>
      ))}
      <circle className="citation-center" cx={center.x} cy={center.y} r={11} />
      <text className="citation-center-label" x={center.x} y={center.y + 26} textAnchor="middle">{clip(graph.paper.title, 30)}</text>
    </svg>
  );
}

function NodeList({
  heading,
  empty,
  nodes,
  focused,
  onFocus,
  onAnalyse,
}: {
  heading: string;
  empty: string;
  nodes: GraphNode[];
  focused?: string;
  onFocus: (id?: string) => void;
  onAnalyse: (node: GraphNode) => void;
}) {
  return (
    <section>
      <h3>{heading}</h3>
      {nodes.length ? (
        <ol>
          {nodes.map((node) => (
            <li
              key={node.openAlexId}
              className={focused === node.openAlexId ? "is-focused" : undefined}
              onMouseEnter={() => onFocus(node.openAlexId)}
              onMouseLeave={() => onFocus(undefined)}
            >
              <div>
                <a href={node.url} target="_blank" rel="noreferrer">{node.title}</a>
                <small>
                  {[node.authors.join(", ") + (node.authorCount > node.authors.length ? " et al." : ""), node.year, node.venue]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <small>{node.citationCount.toLocaleString("en")} citations</small>
              </div>
              <button
                title={node.pdfAvailable ? "Find this paper and analyse it" : "No open-access copy on a source Trace downloads from; you can still look it up"}
                onClick={() => onAnalyse(node)}
              >
                {node.pdfAvailable ? "Analyse" : "Look up"} <ArrowRight size={12} />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="history-empty">{empty}</p>
      )}
    </section>
  );
}
