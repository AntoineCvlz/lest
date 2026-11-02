import type { Metadata } from "next";

import { TextLink } from "@/features/auth/text-link";
import { ProgramEditor } from "@/features/training/program-editor";

export const metadata: Metadata = { title: "Programme" };

// Props typées à la main : `PageProps` n'existe qu'après `next typegen` (CLAUDE.md).
export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-10 sm:pt-16">
      <TextLink href="/seance/programmes" className="self-start">
        Tous les programmes
      </TextLink>
      <ProgramEditor id={id} />
    </main>
  );
}
