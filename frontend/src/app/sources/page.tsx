import type { Metadata } from "next";
import type { ReactNode } from "react";

import { TextLink } from "@/features/auth/text-link";

export const metadata: Metadata = { title: "Sources et licences" };

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      className="text-ink inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
    >
      {children}
    </a>
  );
}

/** Attribution exigée par les licences des données d'exercices (ADR 0004). Page publique. */
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
          Les exercices, leurs muscles et leurs équipements viennent de{" "}
          <External href="https://wger.de">wger</External>, base libre tenue par sa communauté. Lest
          les importe chaque mois.
        </p>
        <p>
          Chaque exercice garde sa licence d’origine, y compris une fois adapté, et le nom de ses
          auteurs, indiqués sur sa fiche :
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-6">
          <li>
            <External href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr">
              CC BY-SA 4.0
            </External>{" "}
            et{" "}
            <External href="https://creativecommons.org/licenses/by-sa/3.0/deed.fr">
              CC BY-SA 3.0
            </External>{" "}
            : attribution, partage dans les mêmes conditions ;
          </li>
          <li>
            <External href="https://creativecommons.org/licenses/by/4.0/deed.fr">
              CC BY 4.0
            </External>{" "}
            : attribution ;
          </li>
          <li>
            <External href="https://creativecommons.org/publicdomain/zero/1.0/deed.fr">
              CC0 1.0
            </External>{" "}
            : domaine public.
          </li>
        </ul>
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
