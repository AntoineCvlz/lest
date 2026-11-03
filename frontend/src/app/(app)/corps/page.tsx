import type { Metadata } from "next";

import { WeightJournal } from "@/features/body/weight-journal";

export const metadata: Metadata = { title: "Corps" };

export default function BodyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-10 sm:pt-16">
      <h1 className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]">Corps</h1>
      <WeightJournal />
    </main>
  );
}
