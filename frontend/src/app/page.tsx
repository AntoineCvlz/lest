import { cookies } from "next/headers";

import { SessionPanel } from "@/features/auth/session-panel";
import { ApiStatus } from "@/features/health/api-status";
import { Dashboard } from "@/features/insights/dashboard";
import { AppTabs } from "@/features/navigation/app-tabs";
import { CSRF_COOKIE } from "@/shared/bff/cookies";

/**
 * Accueil. Avec une session (indice `lest_csrf`, ADR 0001) : le Bilan, les onglets et le compte
 * (déconnexion, purge du cache privé). Sans session : présentation et connexion. L'API reste
 * seule juge : une session expirée affiche « non connecté » dans le compte.
 */
export default async function HomePage() {
  const signedIn = (await cookies()).has(CSRF_COOKIE);

  if (signedIn) {
    return (
      <>
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-10 sm:pt-16">
          <h1 className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]">Bilan</h1>
          <Dashboard />
          <SessionPanel shortcuts={false} />
        </main>
        <AppTabs />
      </>
    );
  }
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-[40px] leading-none font-extrabold [font-stretch:125%]">Lest</h1>
        <p className="text-ink-muted">
          Carnet d’entraînement : séances, autres sports, poids, repas et bilan de la semaine.
        </p>
      </header>
      <SessionPanel />
      <ApiStatus />
    </main>
  );
}
