import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { textSizeBootScript } from "@/lib/text-size";
import { themeBootScript } from "@/lib/theme";
import { ServiceWorkerRegistration } from "@/components/offline";
import { UiLanguageProvider } from "@/i18n/client";
import { messagesFor } from "@/i18n/messages";
import { serverUiLanguage } from "@/i18n/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Başlık ve açıklama arayüzün dilinde (çerez, yoksa tarayıcının dili). */
export async function generateMetadata(): Promise<Metadata> {
  const t = messagesFor(await serverUiLanguage()).studio;
  return {
    title: t.documentTitle,
    description: t.documentDescription,
    applicationName: "Trace",
    // Kurulan uygulama (manifest `app/manifest.ts`); iOS ana ekran simgesi ve adı ayrıca.
    appleWebApp: { capable: true, title: "Trace", statusBarStyle: "default" },
    icons: { icon: [{ url: "/favicon.ico" }, { url: "/icons/icon.svg", type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2efe7" },
    { media: "(prefers-color-scheme: dark)", color: "#161714" },
  ],
};

/*
 * Yazı boyutu ve tema (`data-text-size`, `data-theme`) kök öğeye ilk boyamadan
 * önce yazılıyor. Düz bir `<script>`: tarayıcı onu HTML'i okurken çalıştırıyor.
 * `next/script`'in beforeInteractive'i satır içi betiği Next çalışma zamanı
 * yüklenene kadar kuyrukta tutuyordu; karanlık temada sayfa bir an açık
 * görünüyordu. `suppressHydrationWarning`: bu öznitelikler JSX'te yok.
 *
 * Arayüzün dili (`src/i18n`) sunucuda çerezden okunuyor: ilk çizim doğru
 * dille geliyor, `lang` da ona göre (Türkçede büyük harf İ/ı doğru oluyor).
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const language = await serverUiLanguage();
  return (
    <html
      lang={language}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: `${textSizeBootScript}${themeBootScript}` }} />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        <UiLanguageProvider initial={language}>{children}</UiLanguageProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
