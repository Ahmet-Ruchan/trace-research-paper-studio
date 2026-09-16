"use client";

import { useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import {
  generationTaskCatalog,
  getProvider,
  resolveProviderModel,
  type GenerationTaskRole,
  type ModelTeam,
  type ProviderId,
} from "@/lib/model-providers";
import { formatDuration, generationStageProfiles, type ProbeVerdict } from "@/lib/model-probe";
import { requestModelProbe, type ProbeStageEstimate } from "@/lib/model-probe-client";
import type { NarrativeTemplate, ResearchProject } from "@/lib/schema";

type RowState =
  | { name: "waiting" }
  | { name: "running" }
  | { name: "done"; verdict: ProbeVerdict; message: string; stages: ProbeStageEstimate[] }
  | { name: "failed"; message: string };

type Row = {
  key: string;
  provider: ProviderId;
  model: string;
  roles: GenerationTaskRole[];
  state: RowState;
};

type TeamProbeProps = {
  assignments: ModelTeam;
  apiKeys: Partial<Record<ProviderId, string>>;
  depth: ResearchProject["depth"];
  template?: NarrativeTemplate;
};

/**
 * Tam üretimden önce modelleri dener. Aynı model birden fazla göreve
 * atanmışsa tek istek yeter: hız modele ait, görevler yalnızca istem ve
 * çıktı uzunluğunda ayrılıyor. Modeller sırayla deneniyor; iki yerel model
 * aynı GPU'yu paylaşırken paralel ölçüm ikisini de yavaş gösterirdi.
 *
 * Sonuçlar seçimle birlikte eskir: model, anahtar, derinlik ya da şablon
 * değişince liste kayboluyor, eski bir "hızlı" hükmü yeni seçime yapışmasın.
 */
export function TeamProbe({ assignments, apiKeys, depth, template }: TeamProbeProps) {
  const signature = JSON.stringify({ assignments, apiKeys, depth, template: template?.id });
  const [result, setResult] = useState<{ signature: string; rows: Row[] }>();
  const controller = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => controller.current?.abort(), []);

  const rows = result?.signature === signature ? result.rows : undefined;
  const running = rows?.some((row) => row.state.name === "running" || row.state.name === "waiting") ?? false;

  async function run() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const profiles = generationStageProfiles({ depth, template });

    const groups = new Map<string, Row>();
    for (const task of generationTaskCatalog) {
      const assignment = assignments[task.id];
      const key = `${assignment.provider}|${assignment.model.trim()}`;
      const row = groups.get(key) ?? { key, provider: assignment.provider, model: assignment.model.trim(), roles: [], state: { name: "waiting" } };
      row.roles.push(task.id);
      groups.set(key, row);
    }
    let current = [...groups.values()];
    const update = (key: string, state: RowState) => {
      current = current.map((row) => (row.key === key ? { ...row, state } : row));
      if (!abort.signal.aborted) setResult({ signature, rows: current });
    };
    setResult({ signature, rows: current });

    for (const row of current) {
      if (abort.signal.aborted) return;
      const provider = getProvider(row.provider)!;
      const selection = resolveProviderModel(row.provider, row.model);
      const apiKey = apiKeys[row.provider]?.trim() ?? "";
      if (!selection) {
        update(row.key, { name: "failed", message: "The model name is not valid for this provider." });
        continue;
      }
      if (!provider.local && !apiKey) {
        update(row.key, { name: "failed", message: `${provider.keyLabel} is required.` });
        continue;
      }
      update(row.key, { name: "running" });
      try {
        const answer = await requestModelProbe(
          { assignment: selection, apiKey, stages: row.roles.map((role) => profiles[role]) },
          abort.signal,
        );
        update(row.key, { name: "done", verdict: answer.verdict, message: answer.message, stages: answer.stages ?? [] });
      } catch (caught) {
        if (abort.signal.aborted) return;
        update(row.key, { name: "failed", message: caught instanceof Error ? caught.message : "The model could not be tested." });
      }
    }
    if (controller.current === abort) controller.current = undefined;
  }

  return (
    <div className="team-probe">
      <div className="team-probe-heading">
        <span>A short request to each model estimates how long its longest step would take, before the PDF is sent.</span>
        <button type="button" disabled={running} onClick={() => { void run(); }}>
          <Gauge size={13} /> {running ? "Testing…" : rows ? "Test again" : "Test models"}
        </button>
      </div>
      {rows && (
        <ul className="team-probe-list">
          {rows.map((row) => (
            <li key={row.key} className={`regen-probe ${row.state.name === "done" ? `probe-${row.state.verdict}` : row.state.name === "failed" ? "probe-too-slow" : ""}`}>
              <b>{getProvider(row.provider)?.label} · {row.model}</b>
              <small>{row.roles.map((role) => generationTaskCatalog.find((task) => task.id === role)?.shortLabel).join(", ")}</small>
              <span role={row.state.name === "failed" ? "alert" : "status"}>
                {row.state.name === "waiting" && "Waiting…"}
                {row.state.name === "running" && "Testing with a short request…"}
                {(row.state.name === "done" || row.state.name === "failed") && row.state.message}
              </span>
              {row.state.name === "done" && row.state.stages.length > 1 && (
                <small className="team-probe-stages">
                  {row.state.stages.map((stage) => `${stage.label}: ${stage.estimateSeconds === null ? "too slow" : `about ${formatDuration(stage.estimateSeconds)}`}`).join(" · ")}
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
