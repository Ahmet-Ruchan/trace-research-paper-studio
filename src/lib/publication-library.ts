import type { PublicationSettings, PublicationSummary } from "./publications";

const ENDPOINT = "/api/publications";

async function request<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init });
  const body = await response.json().catch(() => undefined) as ({ error?: string } & T) | undefined;
  if (!response.ok) throw new Error(body?.error ?? `The publication request failed (HTTP ${response.status}).`);
  if (!body) throw new Error("The publication service returned an empty response.");
  return body;
}

export async function listProjectPublications(projectId: string) {
  return (await request<{ publications: PublicationSummary[] }>(`${ENDPOINT}?projectId=${encodeURIComponent(projectId)}`)).publications;
}

export async function publishProject(projectId: string, settings: PublicationSettings) {
  return (await request<{ publication: PublicationSummary }>(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, settings }),
  })).publication;
}

export async function changePublication(
  id: string,
  patch: { status?: PublicationSummary["status"]; settings?: PublicationSettings; refresh?: boolean },
) {
  return (await request<{ publication: PublicationSummary }>(`${ENDPOINT}?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })).publication;
}

export async function removePublication(id: string) {
  await request<{ ok: boolean }>(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}
