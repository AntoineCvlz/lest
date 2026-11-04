import type { ReactNode } from "react";

import { AppTabs } from "@/features/navigation/app-tabs";

/** Pages de l'app connectée : contenu, puis onglets fixés en bas (`AppTabs` réserve leur
 * hauteur exacte dans le flux, texte agrandi compris). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AppTabs />
    </>
  );
}
