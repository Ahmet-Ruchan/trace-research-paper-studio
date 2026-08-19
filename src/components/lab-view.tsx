"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookMarked,
  BookOpenCheck,
  Code2,
  FlaskConical,
  Gauge,
  Lightbulb,
  ListChecks,
  Quote,
  TriangleAlert,
} from "lucide-react";
import type { Claim, ResearchProject } from "@/lib/schema";
import { EvidenceDrawer } from "./evidence-drawer";

type LabViewProps = {
  project: ResearchProject;
  fileUrl?: string;
  selectedClaimId?: string;
  onClaimSelect: (claimId?: string) => void;
};

const kindLabels: Record<Claim["kind"], string> = {
  "reported-result": "Sonuç",
  "author-interpretation": "Yorum",
  method: "Yöntem",
  background: "Bağlam",
  limitation: "Sınır",
};

const reportKindLabels = {
  contribution: "Katkı",
  mechanism: "Mekanizma",
  experiment: "Deney",
  critique: "Eleştiri",
  reproduction: "Reprodüksiyon",
  implication: "Çıkarım",
} as const;

export function LabView({ project, fileUrl, selectedClaimId, onClaimSelect }: LabViewProps) {
  const [section, setSection] = useState("overview");
  const selectedClaim = useMemo(
    () => project.evidence.claims.find((claim) => claim.id === selectedClaimId),
    [project.evidence.claims, selectedClaimId],
  );

  const nav = [
    { id: "overview", label: "Overview", icon: Lightbulb },
    ...(project.deepReport ? [{ id: "report", label: "Deep report", icon: BookOpenCheck }] : []),
    { id: "claims", label: "Claims", icon: Quote },
    { id: "method", label: "Method", icon: FlaskConical },
    ...(project.technicalAppendix ? [{ id: "technical", label: "Technical", icon: Code2 }] : []),
    { id: "metrics", label: "Metrics", icon: Gauge },
    { id: "limits", label: "Limitations", icon: TriangleAlert },
    { id: "glossary", label: "Glossary", icon: BookMarked },
  ];

  return (
    <div className="lab-layout">
      <nav className="lab-nav" aria-label="Paper inceleme bölümleri">
        <div className="lab-nav-label">Paper map</div>
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={section === item.id ? "active" : ""}
              onClick={() => setSection(item.id)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
        <div className="source-count">
          <span>{project.evidence.sources.length}</span>
          <small>bağlı kaynak</small>
        </div>
      </nav>

      <main className="lab-main">
        <header className="lab-section-header">
          <span>{project.evidence.paper.venue} · {project.evidence.paper.year}</span>
          <h1>{project.evidence.paper.title}</h1>
          <p>{project.evidence.paper.authors.join(", ")}</p>
        </header>

        {section === "overview" && (
          <div className="lab-content-stack">
            <section className="thesis-card">
              <span>Core thesis</span>
              <blockquote>{project.evidence.thesis}</blockquote>
            </section>
            <section className="lab-block two-column-block">
              <div>
                <div className="block-title"><Lightbulb size={16} /> Araştırma sorusu</div>
                <p className="large-body">{project.evidence.researchQuestion}</p>
              </div>
              <div>
                <div className="block-title"><ListChecks size={16} /> Plain-language özet</div>
                <p>{project.evidence.plainSummary}</p>
              </div>
            </section>
            <section className="lab-block">
              <div className="block-title"><Quote size={16} /> Öne çıkan bulgular</div>
              <div className="finding-list">
                {project.evidence.findings.map((finding, index) => {
                  const claim = project.evidence.claims.find((item) =>
                    item.statement.toLocaleLowerCase("tr").includes(finding.slice(0, 18).toLocaleLowerCase("tr")),
                  ) ?? project.evidence.claims.filter((item) => item.kind === "reported-result")[index];
                  return (
                    <button key={`${finding}-${index}`} onClick={() => claim && onClaimSelect(claim.id)}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <p>{finding}</p>
                      <ArrowRight size={16} />
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {section === "report" && project.deepReport && (
          <div className="deep-report">
            <header className="report-intro">
              <div><span>Deep report · {project.deepReport.readingTime}</span><h2>{project.deepReport.title}</h2></div>
              <p>{project.deepReport.dek}</p>
            </header>
            <div className="report-sections">
              {project.deepReport.sections.map((item, index) => (
                <article className={`report-section report-${item.kind}`} key={item.id}>
                  <header>
                    <span>{String(index + 1).padStart(2, "0")} · {reportKindLabels[item.kind]}</span>
                    <h3>{item.title}</h3>
                    <p>{item.summary}</p>
                  </header>
                  <div className="report-analysis">
                    {item.analysis.map((paragraph, paragraphIndex) => <p key={`${item.id}-${paragraphIndex}`}>{paragraph}</p>)}
                  </div>
                  <footer>{item.claimIds.map((claimId) => (
                    <button key={claimId} onClick={() => onClaimSelect(claimId)}><span className={project.evidence.claims.find((claim) => claim.id === claimId)?.confidence === "verified" ? "verified-dot" : "review-dot"} /> {claimId}</button>
                  ))}</footer>
                </article>
              ))}
            </div>
            <section className="report-questions">
              <span>Open questions</span>
              <h2>Paper’ın henüz cevaplamadığı sorular</h2>
              <ol>{project.deepReport.openQuestions.map((question, index) => <li key={`${question}-${index}`}><i>{String(index + 1).padStart(2, "0")}</i><p>{question}</p></li>)}</ol>
            </section>
          </div>
        )}

        {section === "claims" && (
          <section className="lab-block">
            <div className="block-heading-row">
              <div className="block-title"><Quote size={16} /> Kanıt defteri</div>
              <span>{project.evidence.claims.filter((claim) => claim.confidence === "verified").length}/{project.evidence.claims.length} doğrulandı</span>
            </div>
            <div className="claims-table">
              {project.evidence.claims.map((claim) => (
                <button
                  key={claim.id}
                  className={selectedClaimId === claim.id ? "selected" : ""}
                  onClick={() => onClaimSelect(claim.id)}
                >
                  <span className="claim-kind">{kindLabels[claim.kind]}</span>
                  <p>{claim.statement}</p>
                  <span className={`claim-confidence ${claim.confidence}`}>
                    {claim.confidence === "verified" ? "Verified" : "Review"}
                  </span>
                  <span className="claim-page">
                    {claim.sourceRefs[0]?.page ? `s. ${claim.sourceRefs[0].page}` : "web"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {section === "method" && (
          <section className="lab-block">
            <div className="block-title"><FlaskConical size={16} /> Yöntem akışı</div>
            <div className="method-timeline">
              {project.evidence.methods.map((method, index) => (
                <div key={`${method}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{method}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {section === "technical" && project.technicalAppendix && (
          <div className="technical-appendix">
            <header className="technical-intro">
              <span>Technical appendix</span>
              <h2>{project.technicalAppendix.title}</h2>
              <p>{project.technicalAppendix.overview}</p>
            </header>

            {project.technicalAppendix.equations.length > 0 && <section className="technical-section">
              <div className="block-title"><Code2 size={16} /> Denklemler ve mekanizmalar</div>
              <div className="technical-equations">{project.technicalAppendix.equations.map((equation) => <article key={equation.id}>
                <span>{equation.label}</span><code>{equation.expression}</code><p>{equation.explanation}</p>
                <dl>{equation.variables.map((variable) => <div key={variable.symbol}><dt>{variable.symbol}</dt><dd>{variable.meaning}</dd></div>)}</dl>
                <TechnicalClaimLinks claimIds={equation.claimIds} project={project} onClaimSelect={onClaimSelect} />
              </article>)}</div>
            </section>}

            <section className="technical-section">
              <div className="block-title"><FlaskConical size={16} /> Algoritma akışı</div>
              <ol className="technical-steps">{project.technicalAppendix.algorithmSteps.map((step, index) => <li key={`${step.label}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.label}</strong><p>{step.detail}</p><TechnicalClaimLinks claimIds={step.claimIds} project={project} onClaimSelect={onClaimSelect} /></div></li>)}</ol>
            </section>

            {project.technicalAppendix.codeSketches.length > 0 && <section className="technical-section">
              <div className="block-title"><Code2 size={16} /> Açıklayıcı kod taslakları</div>
              <div className="code-sketches">{project.technicalAppendix.codeSketches.map((sketch) => <article key={sketch.title}><header><strong>{sketch.title}</strong><span>{sketch.language}</span></header><pre><code>{sketch.code}</code></pre><p>{sketch.explanation}</p><TechnicalClaimLinks claimIds={sketch.claimIds} project={project} onClaimSelect={onClaimSelect} /></article>)}</div>
            </section>}

            <div className="technical-bottom-grid">
              <section className="technical-section"><div className="block-title"><Gauge size={16} /> Karmaşıklık</div>{project.technicalAppendix.complexity.map((item) => <article className="complexity-card" key={item.operation}><span>{item.operation}</span><strong>{item.cost}</strong><p>{item.context}</p><TechnicalClaimLinks claimIds={item.claimIds} project={project} onClaimSelect={onClaimSelect} /></article>)}</section>
              <section className="technical-section"><div className="block-title"><ListChecks size={16} /> Uygulama notları</div><ul className="implementation-notes">{project.technicalAppendix.implementationNotes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}</ul></section>
            </div>
          </div>
        )}

        {section === "metrics" && (
          <section className="lab-block">
            <div className="block-title"><Gauge size={16} /> Çıkarılan ölçümler</div>
            <div className="metrics-table">
              {project.evidence.metrics.map((metric) => (
                <button
                  key={metric.id}
                  onClick={() => {
                    const claim = project.evidence.claims.find((item) =>
                      item.sourceRefs.some(
                        (reference) => reference.page === metric.sourceRef.page && item.kind === "reported-result",
                      ),
                    );
                    if (claim) onClaimSelect(claim.id);
                  }}
                >
                  <span>{metric.label}</span>
                  <strong>{metric.displayValue} <small>{metric.unit}</small></strong>
                  <p>{metric.context}</p>
                  <em>s. {metric.sourceRef.page ?? "—"}</em>
                </button>
              ))}
            </div>
          </section>
        )}

        {section === "limits" && (
          <section className="lab-block limit-block">
            <div className="block-title"><TriangleAlert size={16} /> Paper’ın sınırları</div>
            <p className="section-intro">Güçlü bir anlatı, bulgular kadar sınırlarını da görünür tutar.</p>
            <ol>
              {project.evidence.limitations.map((limitation, index) => (
                <li key={`${limitation}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{limitation}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {section === "glossary" && (
          <section className="lab-block">
            <div className="block-title"><BookMarked size={16} /> Kavram sözlüğü</div>
            <div className="glossary-grid">
              {project.evidence.glossary.map((item) => (
                <article key={item.term}>
                  <h3>{item.term}</h3>
                  <p>{item.definition}</p>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      <EvidenceDrawer
        claim={selectedClaim}
        evidence={project.evidence}
        fileUrl={fileUrl}
        persistent
      />
    </div>
  );
}

function TechnicalClaimLinks({ claimIds, project, onClaimSelect }: { claimIds: string[]; project: ResearchProject; onClaimSelect: (claimId?: string) => void }) {
  return <div className="technical-claim-links">{claimIds.map((claimId) => <button key={claimId} onClick={() => onClaimSelect(claimId)}><span className={project.evidence.claims.find((claim) => claim.id === claimId)?.confidence === "verified" ? "verified-dot" : "review-dot"} />{claimId}</button>)}</div>;
}
