import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { connection } from "next/server";

import { QueryProvider } from "@/shared/api/query-provider";

import "./globals.css";

// Téléchargée au build et servie par l'app (CSP : font-src 'self'), avec l'axe de largeur
// utilisé par la typographie « Fonte calibrée » (docs/design-system.md).
const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Lest", template: "%s · Lest" },
  description: "Suivi de prise de masse, de musculation et de sport.",
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1b242d" },
    { media: "(prefers-color-scheme: light)", color: "#eef1f4" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Rendu à chaque requête : c'est la condition pour que Next.js applique le nonce de la CSP.
  await connection();

  return (
    <html lang="fr" className={archivo.variable}>
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
