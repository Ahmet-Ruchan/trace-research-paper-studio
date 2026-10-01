"use client";

import { useRef, useState } from "react";
import { initialGenerationProgress, readGenerationStream, type GenerationProgress } from "@/lib/generation-events";
import { researchProjectSchema, type ResearchProject } from "@/lib/schema";
import type { GenerationOptions } from "../onboarding";

/**
 * Bir makaleyi analiz etmek: `/api/generate` akışı, ilerleme, iptal ve
 * kanıt aşamalarının kontrol noktası. Yarıda kalan bir analizde tamamlanan
 * aşamalar tarayıcıda kalıyor; aynı makale yeniden gönderilince oradan devam
 * ediliyor.
 */

export const CHECKPOINT_KEY = "trace-evidence-checkpoint-v1";

export function checkpointPartCount(raw: string | null) {
  if (!raw) return 0;
  try {
    const value = JSON.parse(raw) as { parts?: Record<string, unknown> };
    return value.parts ? Object.values(value.parts).filter(Boolean).length : 0;
  } catch {
    return 0;
  }
}

export function useGeneration({
  onStart,
  onResult,
  onFailure,
}: {
  onStart: () => void;
  onResult: (project: ResearchProject, warnings: string[], file: File) => Promise<void>;
  onFailure: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress>(initialGenerationProgress);
  const controller = useRef<AbortController | undefined>(undefined);
  const checkpointCount = useRef(0);

  async function generate(options: GenerationOptions) {
    const current = new AbortController();
    controller.current = current;
    const savedCheckpoint = window.localStorage.getItem(CHECKPOINT_KEY);
    checkpointCount.current = checkpointPartCount(savedCheckpoint);
    setProgress(initialGenerationProgress);
    setLoading(true);
    onStart();
    try {
      const form = new FormData();
      form.set("paper", options.file);
      form.set("sources", JSON.stringify(options.sources));
      form.set("apiKeys", JSON.stringify(options.apiKeys));
      form.set("assignments", JSON.stringify(options.assignments));
      form.set("language", options.language);
      form.set("audience", options.audience);
      form.set("depth", options.depth);
      if (options.template) form.set("template", JSON.stringify(options.template));
      if (savedCheckpoint) form.set("checkpoint", savedCheckpoint);
      const response = await fetch("/api/generate", {
        method: "POST",
        body: form,
        signal: current.signal,
        headers: { Accept: "application/x-ndjson, application/json" },
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        throw new Error(data?.error ?? "The paper could not be generated.");
      }

      let projectData: unknown;
      let responseWarnings: string[] = [];
      const contentType = response.headers.get("content-type") ?? "";

      if (contentType.includes("application/x-ndjson")) {
        if (!response.body) throw new Error("The generation stream could not be started.");
        await readGenerationStream(response.body, (event) => {
          if (event.type === "progress") setProgress(event);
          if (event.type === "checkpoint") {
            window.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(event.checkpoint));
            checkpointCount.current = event.completed.length;
          }
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "result") {
            window.localStorage.removeItem(CHECKPOINT_KEY);
            checkpointCount.current = 0;
            projectData = event.project;
            responseWarnings = event.warnings;
            setProgress({
              stage: "finalize",
              progress: 100,
              title: "Research workspace ready.",
              detail: "Evidence map and StorySpec built successfully.",
            });
          }
        });
      } else {
        const data = (await response.json()) as {
          project?: unknown;
          error?: string;
          warnings?: string[];
        };
        if (!data.project) throw new Error(data.error ?? "The paper could not be generated.");
        projectData = data.project;
        responseWarnings = data.warnings ?? [];
      }

      if (!projectData) throw new Error("Generation finished but no project data came back.");
      await onResult(researchProjectSchema.parse(projectData), responseWarnings, options.file);
    } catch (caught) {
      const aborted = current.signal.aborted || caught instanceof DOMException && caught.name === "AbortError";
      const resumeNote = checkpointCount.current > 0
        ? ` ${checkpointCount.current}/4 evidence stages were saved; press Analyse paper again to resume from here.`
        : "";
      onFailure(aborted ? "Generation cancelled; no API key or temporary file was kept." : `${caught instanceof Error ? caught.message : "Something unexpected went wrong."}${resumeNote}`);
    } finally {
      if (controller.current === current) controller.current = undefined;
      setLoading(false);
    }
  }

  return { loading, progress, generate, cancel: () => controller.current?.abort() };
}
