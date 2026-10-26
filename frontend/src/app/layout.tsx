import type { Metadata, Viewport } from "next";

import { QueryProvider } from "@/shared/api/query-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Lest", template: "%s · Lest" },
  description: "Suivi de prise de masse, de musculation et de sport.",
};

export const viewport: Viewport = {
  colorScheme: "dark light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
