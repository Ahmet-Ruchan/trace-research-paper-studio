import type { MetadataRoute } from "next";
import { messagesFor } from "@/i18n/messages";
import { serverUiLanguage } from "@/i18n/server";

/**
 * Kurulabilir uygulama: masaüstüne ve telefona "uygulama olarak" kuruluyor ve
 * kütüphaneyle açılıyor. Çevrimdışı açılış `public/sw.js`'te.
 *
 * Açıklama arayüzün dilinde. Tarayıcı manifesti çerezsiz istiyor, dolayısıyla
 * pratikte tarayıcının dil sırası (`Accept-Language`) belirliyor; istek
 * zamanında okunduğu için manifest artık derlemede sabitlenmiyor. Ad marka:
 * her dilde aynı.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = messagesFor(await serverUiLanguage()).server.manifest;
  return {
    id: "/",
    name: "Trace research studio",
    short_name: "Trace",
    description: t.description,
    start_url: "/?library=1",
    scope: "/",
    display: "standalone",
    background_color: "#f2efe7",
    theme_color: "#191b18",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
