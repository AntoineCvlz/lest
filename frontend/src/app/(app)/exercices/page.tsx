import type { Metadata } from "next";

import { TextLink } from "@/features/auth/text-link";
import { ExerciseLibrary } from "@/features/training/exercise-library";

export const metadata: Metadata = { title: "Exercices" };

export default function ExercisesPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-10 sm:pt-16">
      <div className="flex flex-col gap-3">
        <h1 className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]">Exercices</h1>
        <p className="text-ink-muted">
          Catalogue issu de wger. Certains exercices n’ont pas encore de nom français : leur nom
          anglais est affiché.
        </p>
      </div>
      <ExerciseLibrary />
      <p className="flex flex-wrap gap-x-6">
        <TextLink href="/sources">Sources et licences</TextLink>
        <TextLink href="/">Revenir à l’accueil</TextLink>
      </p>
    </main>
  );
}
