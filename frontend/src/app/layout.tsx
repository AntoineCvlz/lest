import type { Metadata, Viewport } from "next";
import { connection } from "next/server";

import { QueryProvider } from "@/shared/api/query-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Lest", template: "%s · Lest" },
  description: "Suivi de prise de masse, de musculation et de sport.",
};

export const viewport: Viewport = {
  colorScheme: "dark light",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Rendu à chaque requête : c'est la condition pour que Next.js applique le nonce de la CSP.
  await connection();

  return (
    <html lang="fr">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
