import type { MetadataRoute } from "next";

/**
 * Kurulabilir uygulama: masaüstüne ve telefona "uygulama olarak" kuruluyor ve
 * kütüphaneyle açılıyor. Çevrimdışı açılış `public/sw.js`'te.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Trace research studio",
    short_name: "Trace",
    description: "Papers you can read, verify and play with. Your library opens offline too.",
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
