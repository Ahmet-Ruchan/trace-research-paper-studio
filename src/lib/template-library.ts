import { narrativeTemplateSchema, type NarrativeTemplate } from "./schema";

const ENDPOINT = "/api/templates";

async function request<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init });
  const body = await response.json().catch(() => undefined) as ({ error?: string } & T) | undefined;
  if (!response.ok) throw new Error(body?.error ?? `The template request failed (HTTP ${response.status}).`);
  if (!body) throw new Error("The template library returned an empty response.");
  return body;
}

export async function listTemplates() {
  const body = await request<{ templates: unknown }>(ENDPOINT);
  return narrativeTemplateSchema.array().parse(body.templates);
}

export async function saveTemplate(template: NarrativeTemplate) {
  const body = await request<{ template: unknown }>(ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(template),
  });
  return narrativeTemplateSchema.parse(body.template);
}

export async function deleteTemplate(id: string) {
  await request<{ ok: boolean }>(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}
