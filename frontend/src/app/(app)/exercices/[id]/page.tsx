import type { Metadata } from "next";

import { TextLink } from "@/features/auth/text-link";
import { ExerciseSheet } from "@/features/training/exercise-sheet";

export const metadata: Metadata = { title: "Exercice" };

// Props typées à la main : `PageProps` n'existe qu'après `next typegen` (CLAUDE.md).
export default async function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-10 sm:pt-16">
      <TextLink href="/exercices" className="self-start">
        Tous les exercices
      </TextLink>
      <ExerciseSheet id={id} />
    </main>
  );
}
