import type { Metadata } from "next";

import { TextLink } from "@/features/auth/text-link";
import { ProgramList } from "@/features/training/program-list";

export const metadata: Metadata = { title: "Programmes" };

export default function ProgramsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-10 sm:pt-16">
      <TextLink href="/seance" className="self-start">
        Revenir à la séance
      </TextLink>
      <div className="flex flex-col gap-3">
        <h1 className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]">
          Programmes
        </h1>
        <p className="text-ink-muted">
          Des séances types, chacune avec ses exercices et leur cible (séries × répétitions).
        </p>
      </div>
      <ProgramList />
    </main>
  );
}
