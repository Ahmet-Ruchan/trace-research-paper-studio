import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { textSizeBootScript } from "@/lib/text-size";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trace — Evidence-first research studio",
  description: "Turn research papers into verifiable, interactive web narratives.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Yazı boyutu seçimi `data-text-size` olarak kök öğeye React'ten önce yazılıyor.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        <Script id="trace-text-size" strategy="beforeInteractive">{textSizeBootScript}</Script>
        {children}
      </body>
    </html>
  );
}
