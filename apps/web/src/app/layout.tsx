import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import "./globals.css";

// Self-hosted (src/fonts, SIL OFL): no network at build or run time. See src/fonts/README.md.
const inter = localFont({ src: "../fonts/Inter-latin-variable.woff2", variable: "--font-inter", weight: "100 900", display: "swap" });
const barlow = localFont({ src: "../fonts/BarlowCondensed-latin-600.woff2", variable: "--font-barlow", weight: "600", display: "swap" });

export const metadata: Metadata = {
  title: { default: "APEX F1: Experience every lap.", template: "%s · APEX F1" },
  description: "Experience every lap. An independent, unofficial F1 data and 3D visualization platform.",
};

export const viewport: Viewport = { themeColor: "#090b0e", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${barlow.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:font-medium focus:text-accent-fg"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
