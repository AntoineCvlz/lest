import type { Metadata } from "next";

import { TextLink } from "@/features/auth/text-link";
import { WorkoutDetail } from "@/features/training/workout-detail";

export const metadata: Metadata = { title: "Séance passée" };

// Props typées à la main : `PageProps` n'existe qu'après `next typegen` (CLAUDE.md).
export default async function PastWorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-10 sm:pt-16">
      <TextLink href="/seance" className="self-start">
        Toutes les séances
      </TextLink>
      <WorkoutDetail id={id} />
    </main>
  );
}
