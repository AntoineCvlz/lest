import type { Metadata } from "next";
import type { ReactNode } from "react";

import { TextLink } from "@/features/auth/text-link";

export const metadata: Metadata = { title: "Sources et licences" };

function External({
  href,
  rel = "noopener noreferrer",
  children,
}: {
  href: string;
  rel?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      rel={rel}
      className="text-ink inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
    >
      {children}
    </a>
  );
}

/** Crédits exigés par les licences des données d'exercices (ADR 0006). Page publique. */
export default function SourcesPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-10 sm:pt-16">
      <h1 className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]">
        Sources et licences
      </h1>
      <section aria-labelledby="exercices" className="flex flex-col gap-3">
        <h2 id="exercices" className="text-xl font-bold">
          Catalogue d’exercices
        </h2>
        <p>
          Les exercices, leurs muscles, leurs équipements et leurs illustrations viennent de l’offre
          gratuite de RepDB, utilisée dans Lest selon sa licence (usage dans l’application, avec
          attribution). Lest les importe chaque mois, les redimensionne et traduit en français les
          catégories, muscles et équipements.
        </p>
        <p>
          <External href="https://repdb.co" rel="nofollow noopener noreferrer">
            Exercise data by RepDB (repdb.co)
          </External>
        </p>
        <p className="text-ink-muted">
          Ces données ne sont ni redistribuées ni réutilisées hors de l’application.
        </p>
      </section>
      <section aria-labelledby="application" className="flex flex-col gap-3">
        <h2 id="application" className="text-xl font-bold">
          Application
        </h2>
        <p>
          Le code de Lest est propriétaire, tous droits réservés. Les bibliothèques qu’il utilise
          restent sous leurs propres licences.
        </p>
      </section>
      <p>
        <TextLink href="/">Revenir à l’accueil</TextLink>
      </p>
    </main>
  );
}
