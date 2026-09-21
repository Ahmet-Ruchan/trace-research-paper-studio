import type { NextRequest } from "next/server";
import { ACCESS_REALM, accessAllowed } from "@/lib/access-gate";

/**
 * `TRACE_ACCESS_PASSWORD` tanımlı değilse hiçbir şey yapmaz; yerel kullanım
 * ve plugin teslimi olduğu gibi çalışır. Kurallar `access-gate.ts` içinde.
 */
export function proxy(request: NextRequest) {
  if (accessAllowed(request.nextUrl.pathname, request.headers.get("authorization"), process.env.TRACE_ACCESS_PASSWORD)) {
    return;
  }
  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${ACCESS_REALM}", charset="UTF-8"`, "Cache-Control": "no-store" },
  });
}
