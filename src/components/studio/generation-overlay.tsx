"use client";

import { useEffect, useState } from "react";
import { generationStages, type GenerationProgress } from "@/lib/generation-events";

/** Analiz sürerken tam ekran: aşamalar, geçen süre ve modelin son etkinliği. */
export function GenerationOverlay({ progress, onCancel }: { progress: GenerationProgress; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      setElapsed(Math.floor((now - startedAt) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeIndex = generationStages.findIndex((stage) => stage.id === progress.stage);
  const activityAge = progress.activityAt && clock
    ? Math.max(0, Math.floor((clock - new Date(progress.activityAt).getTime()) / 1_000))
    : 0;
  const activityLabel = activityAge < 3 ? "model active" : `last model activity ${activityAge}s ago`;
  return <div className="generation-overlay" role="status" aria-live="polite"><div className="generation-card"><div className="generation-orbit"><span /><span /><span /></div><div className="generation-status-line"><p className="landing-eyebrow"><span /> Evidence pipeline running</p><small>{elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}</small></div><h2>{progress.title}</h2><p>{progress.detail}</p><div className="generation-live"><i className={activityAge < 12 ? "active" : ""} /><span>{activityLabel}</span><small>10s heartbeat</small></div><div className="generation-stages">{generationStages.map((stage, index) => <span key={stage.id} className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""}><i>{index < activeIndex ? "✓" : String(index + 1).padStart(2, "0")}</i><b>{stage.label}</b><small>{stage.description}</small></span>)}</div><div className="generation-meter"><i style={{ width: `${Math.max(2, Math.min(100, progress.progress))}%` }} /></div><div className="generation-footer"><span>{Math.round(progress.progress)}% complete{progress.attempt ? ` · attempt ${progress.attempt}` : ""}</span><button onClick={onCancel}>Cancel</button></div></div></div>;
}
