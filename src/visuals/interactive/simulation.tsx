import { useEffect, useState } from "react";
import type { Interactive } from "@/lib/schema";
import { formatNumber } from "../chart";

type Simulation = Extract<Interactive, { kind: "mechanism-simulation" }>;

export function SimulationView({ simulation }: { simulation: Simulation }) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = simulation.frames[frameIndex];
  const last = simulation.frames.length - 1;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setFrameIndex((index) => {
        if (index >= last) {
          setPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [playing, frameIndex, last]);

  const active = new Set(frame.activeNodeIds);

  return (
    <section className="interactive simulation" aria-label={simulation.title}>
      <header className="interactive-head">
        <div>
          <span className="interactive-kind">Simülasyon</span>
          <h4>{simulation.title}</h4>
          <p>{simulation.description}</p>
        </div>
      </header>

      <div className="sim-stage">
        {simulation.stageNodes.map((node) => (
          <div className={active.has(node.id) ? "sim-node is-active" : "sim-node"} key={node.id}>
            <strong>{node.label}</strong>
            <small>{node.detail}</small>
          </div>
        ))}
      </div>

      {frame.grid ? <SimulationGrid grid={frame.grid} /> : null}

      <div className="sim-narration">
        <span className="sim-step-index">
          {String(frameIndex + 1).padStart(2, "0")} / {String(simulation.frames.length).padStart(2, "0")}
        </span>
        <strong>{frame.label}</strong>
        <p>{frame.caption}</p>
      </div>

      <div className="sim-controls">
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setFrameIndex((index) => Math.max(index - 1, 0));
          }}
          disabled={frameIndex === 0}
        >
          ‹ Geri
        </button>
        <button
          type="button"
          className="sim-play"
          onClick={() => {
            if (frameIndex >= last) setFrameIndex(0);
            setPlaying((value) => !value);
          }}
        >
          {playing ? "Duraklat" : frameIndex >= last ? "Baştan oynat" : "Oynat"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setFrameIndex((index) => Math.min(index + 1, last));
          }}
          disabled={frameIndex === last}
        >
          İleri ›
        </button>
        <span className="sim-track" aria-hidden="true">
          {simulation.frames.map((item, index) => (
            <i key={item.label} className={index <= frameIndex ? "is-done" : ""} />
          ))}
        </span>
      </div>
    </section>
  );
}

type Grid = NonNullable<Simulation["frames"][number]["grid"]>;

/** Değerleri ısı yoğunluğuna çevirir — dikkat ağırlıklarını okunur kılar. */
function SimulationGrid({ grid }: { grid: Grid }) {
  const flat = grid.values.flat().filter((value) => Number.isFinite(value));
  const min = flat.length ? Math.min(...flat) : 0;
  const max = flat.length ? Math.max(...flat) : 1;
  const span = max - min || 1;

  return (
    <div
      className="sim-grid"
      style={{ "--sim-columns": grid.columnLabels.length } as React.CSSProperties}
    >
      <span className="sim-grid-corner" />
      {grid.columnLabels.map((label) => (
        <span className="sim-grid-column" key={label}>
          {label}
        </span>
      ))}
      {grid.values.map((row, rowIndex) => (
        <div className="sim-grid-row" key={grid.rowLabels[rowIndex] ?? rowIndex}>
          <span className="sim-grid-rowlabel">{grid.rowLabels[rowIndex]}</span>
          {row.map((cell, cellIndex) => (
            <span
              className="sim-grid-cell"
              key={`${rowIndex}-${cellIndex}`}
              style={{ "--sim-weight": (cell - min) / span } as React.CSSProperties}
              title={`${grid.rowLabels[rowIndex]} → ${grid.columnLabels[cellIndex]}`}
            >
              {formatNumber(cell)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
