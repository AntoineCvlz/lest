import type { ReactNode } from "react";

import { AppTabs } from "@/features/navigation/app-tabs";

/** Pages de l'app connectée : contenu, puis onglets fixés en bas (espace réservé dessous). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="pb-20">{children}</div>
      <AppTabs />
    </>
  );
}
