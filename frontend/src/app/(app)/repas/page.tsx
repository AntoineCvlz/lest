import type { Metadata } from "next";

import { FoodJournal } from "@/features/nutrition/food-journal";

export const metadata: Metadata = { title: "Repas" };

export default function MealsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-10 sm:pt-16">
      <h1 className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]">Repas</h1>
      <FoodJournal />
    </main>
  );
}
