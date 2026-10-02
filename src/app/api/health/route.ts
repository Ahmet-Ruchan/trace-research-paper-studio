import packageJson from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trace plugin'inin "bu port bizim uygulamamız mı?" sorusunu cevaplayan uç.
 *
 * `trace-agent.mjs deliver` teslimattan önce buraya bakar: cevap gelirse zaten
 * ayakta olan uygulamayı kullanır, gelmezse kendi dev sunucusunu başlatır.
 * Bu yüzden gövde SABİT kalmalı — `app` alanı bir protokol imzasıdır, süsleme
 * değil. `version` uygulamanın sürümü: eklentiden eski bir stüdyoya
 * (günler önce eski bir kopyadan açılmış bir dev sunucusu) yeni bir analiz
 * sessizce verilmesin diye. Hiçbir yerel durum, yol veya yapılandırma sızdırmaz.
 */
export function GET() {
  return Response.json({ ok: true, app: "trace-research-studio", version: packageJson.version }, {
    headers: { "Cache-Control": "no-store" },
  });
}
