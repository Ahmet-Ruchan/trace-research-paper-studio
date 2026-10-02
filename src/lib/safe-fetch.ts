import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { UserFacingError } from "./user-error";

const MAX_BYTES = 750_000;
const MAX_REDIRECTS = 3;

function isPrivateAddress(address: string) {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) {
    return true;
  }

  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  );
}

async function assertPublicUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UserFacingError("sourceProtocol");
  }
  if (url.username || url.password) {
    throw new UserFacingError("sourceCredentials");
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    throw new UserFacingError("sourceLocalNetwork");
  }

  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new UserFacingError("sourcePrivateAddress");
  } else {
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
      throw new UserFacingError("sourceUnsafeAddress");
    }
  }
  return url;
}

function decodeEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function cleanHtml(html: string) {
  const title = decodeEntities(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "Web source",
  ).trim();
  const text = decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
  return { title, text };
}

export type FetchedSource = {
  id: string;
  title: string;
  url: string;
  text: string;
};

export async function fetchPublicSource(rawUrl: string, id: string): Promise<FetchedSource> {
  let url = await assertPublicUrl(rawUrl);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        "user-agent": "TraceResearchBot/0.1 (+research source reader)",
        accept: "text/html,text/plain;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new UserFacingError("sourceTooManyRedirects");
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }

    if (!response.ok) throw new UserFacingError("sourceStatus", response.status);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new UserFacingError("sourceNotText");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new UserFacingError("sourceUnreadable");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new UserFacingError("sourceTooLarge");
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = new TextDecoder().decode(bytes);
    const cleaned = contentType.includes("text/html")
      ? cleanHtml(raw)
      : { title: url.hostname, text: raw.replace(/\s+/g, " ").trim() };

    return {
      id,
      title: cleaned.title || url.hostname,
      url: url.toString(),
      text: cleaned.text.slice(0, 24_000),
    };
  }

  throw new UserFacingError("sourceFetchFailed");
}

