import type { Metadata } from "next";

import { ActivityJournal } from "@/features/activities/activity-journal";
import { TextLink } from "@/features/auth/text-link";

export const metadata: Metadata = { title: "Autres sports" };

export default function ActivitiesPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-10 sm:pt-16">
      <TextLink href="/seance" className="self-start">
        Revenir à la séance
      </TextLink>
      <h1 className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]">
        Autres sports
      </h1>
      <ActivityJournal />
    </main>
  );
}
