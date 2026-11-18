import type { Metadata, Viewport } from "next";
import { Anybody, Public_Sans } from "next/font/google";
import { connection } from "next/server";

import { OfflineQueryProvider } from "@/features/offline/offline-query-provider";
import { ServiceWorker } from "@/shared/pwa/service-worker";

import "./globals.css";

// Téléchargées au build et servies par l'app (CSP : font-src 'self'). Anybody avec son axe de
// largeur, utilisé étroit par la typographie « Magnésie » (docs/design-system.md).
const anybody = Anybody({
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  variable: "--font-anybody",
  display: "swap",
});
const publicSans = Public_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Lest", template: "%s · Lest" },
  description: "Suivi de prise de masse, de musculation et de sport.",
  // Écran d'accueil iOS (ADR 0015) : barre d'état opaque, le contenu ne passe pas dessous.
  appleWebApp: { capable: true, title: "Lest", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1a222c" },
    { media: "(prefers-color-scheme: light)", color: "#f3f5f8" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Rendu à chaque requête : c'est la condition pour que Next.js applique le nonce de la CSP.
  await connection();

  return (
    <html lang="fr" className={`${anybody.variable} ${publicSans.variable}`}>
      <body>
        <OfflineQueryProvider>{children}</OfflineQueryProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
