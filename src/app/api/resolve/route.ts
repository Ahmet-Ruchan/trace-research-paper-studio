import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  SourceError,
  fetchFirstAvailablePdf,
  parseIdentifier,
  rankByTitle,
  resolveIdentifier,
  searchPapers,
} from "../../../../plugins/trace-paper-studio/skills/trace-paper-studio/scripts/lib/paper-source.mjs";
import type { PaperCandidate } from "@/lib/paper-lookup";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Makaleyi adıyla, DOI'siyle ya da bir depo bağlantısıyla bulmak.
 *
 * Çözümleyici plugin köprüsününkiyle AYNI modül: izin listesi, boyut sınırı
 * ve PDF imza denetimi iki yerde ayrı ayrı yazılsaydı biri diğerinden
 * gevşek kalırdı. Tarayıcı bu depolara doğrudan gidemiyor (CORS), bu yüzden
 * indirme de sunucudan geçiyor — ama yalnızca izin listesindeki adreslere.
 */

type SourceEntry = {
  origin?: string;
  title?: string;
  authors?: string[];
  published?: string;
  venue?: string;
  absUrl?: string;
  matchScore?: number;
  pdfCandidates?: string[];
  pdfUrl?: string;
  blockedPdfUrls?: string[];
};

function toCandidate(entry: SourceEntry): PaperCandidate {
  return {
    origin: entry.origin ?? "arxiv",
    title: entry.title ?? "Untitled paper",
    authors: (entry.authors ?? []).slice(0, 4),
    year: entry.published ? String(entry.published).slice(0, 4) : undefined,
    venue: entry.venue,
    url: entry.absUrl,
    matchScore: entry.matchScore,
    pdfUrls: entry.pdfCandidates ?? (entry.pdfUrl ? [entry.pdfUrl] : []),
    blockedPdfUrls: entry.blockedPdfUrls ?? [],
  };
}

function failure(error: unknown) {
  // SourceError kullanıcının düzeltebileceği bir şeydir; gerisi üst kaynak hatası.
  const message = error instanceof Error ? error.message : "The paper could not be looked up.";
  return Response.json({ error: message }, { status: error instanceof SourceError ? 422 : 502 });
}

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 400);
  const expect = (request.nextUrl.searchParams.get("expect") ?? "").trim().slice(0, 400);
  if (query.length < 3) return Response.json({ error: "Enter a paper title, DOI, arXiv id or link." }, { status: 400 });

  try {
    const parsed = parseIdentifier(query);
    if (parsed.kind === "title") {
      const results = (await searchPapers(parsed.id, 6)) as SourceEntry[];
      return Response.json({ candidates: results.slice(0, 6).map(toCandidate) }, { headers: { "Cache-Control": "no-store" } });
    }

    const entry = (await resolveIdentifier(parsed)) as SourceEntry;
    /**
     * Atıf grafiğinden gelen kimlik OpenAlex'in eşleştirmesine dayanıyor ve o
     * eşleştirme bazen başka bir makalenin arXiv kopyasını gösteriyor. Beklenen
     * başlık tutmuyorsa kimliğe güvenilmez, başlıkla aranır.
     */
    if (expect && (rankByTitle([entry], expect)[0]?.matchScore ?? 0) < 0.6) {
      const results = (await searchPapers(expect, 6)) as SourceEntry[];
      return Response.json({ candidates: results.slice(0, 6).map(toCandidate) }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ candidates: [toCandidate(entry)] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

const downloadSchema = z.object({
  title: z.string().max(400).optional(),
  pdfUrls: z.array(z.string().url().max(600)).min(1).max(8),
  blockedPdfUrls: z.array(z.string().max(600)).max(8).optional(),
});

export async function POST(request: Request) {
  const parsed = downloadSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: "No downloadable PDF address was given." }, { status: 400 });

  try {
    // Adresler istemciden geliyor; her biri indirme sırasında izin listesinden geçiyor.
    const { buffer, url } = await fetchFirstAvailablePdf({
      title: parsed.data.title,
      pdfCandidates: parsed.data.pdfUrls,
      blockedPdfUrls: parsed.data.blockedPdfUrls,
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "X-Trace-Pdf-Source": new URL(url).hostname,
      },
    });
  } catch (error) {
    return failure(error);
  }
}
