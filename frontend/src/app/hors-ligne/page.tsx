import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Hors ligne" };

/** Page servie par le service worker pour une page jamais ouverte sur cet appareil. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-extrabold [font-stretch:125%]">Hors ligne</h1>
      <p>
        Cette page n’a pas encore été ouverte sur cet appareil. Elle s’affichera au retour du
        réseau.
      </p>
      <p className="text-ink-muted">Les pages déjà ouvertes restent disponibles sans connexion.</p>
      <Link href="/" className="text-accent-ink font-semibold underline underline-offset-4">
        Retour à l’accueil
      </Link>
    </main>
  );
}
