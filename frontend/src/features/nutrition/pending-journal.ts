import type { QueryClient } from "@tanstack/react-query";

import { isWrite, pendingWrites, QUEUED_KEY } from "@/features/offline/queue";
import type { Schemas } from "@/shared/api/client";

type Day = Schemas["DayOut"];
type Entry = Schemas["EntryOut"];
type Food = Schemas["FoodOut"];

export const SAVE_ENTRY = [...QUEUED_KEY, "nutrition", "save-entry"] as const;
export const DELETE_ENTRY = [...QUEUED_KEY, "nutrition", "delete-entry"] as const;
export const SAVE_WATER = [...QUEUED_KEY, "nutrition", "save-water"] as const;

/** Entrée en file : la ligne affichée, valeurs estimées jusqu'à la relecture du serveur. */
export interface SaveEntryVariables {
  account: string | null;
  entry: Entry;
}

export interface DeleteEntryVariables {
  account: string | null;
  id: string;
  date: string;
}

export interface SaveWaterVariables {
  account: string | null;
  day: string;
  ml: number;
}

/** Valeurs d'une quantité d'aliment, recopiées comme le fait l'API (ADR 0010), avant arrondi. */
export function entryFromFood(
  food: Food,
  { id, date, meal, grams }: Pick<Entry, "id" | "date" | "meal" | "grams">,
): Entry {
  const share = (per100g: number | null) => ((per100g ?? 0) * grams) / 100;
  return {
    id,
    date,
    meal,
    grams,
    food_id: food.id,
    name: food.name,
    kcal: share(food.kcal_100g),
    protein: share(food.protein_100g),
    carbs: share(food.carbs_100g),
    fat: share(food.fat_100g),
  };
}

/** La même entrée pour une autre quantité : valeurs à la proportion. */
export function withGrams(entry: Entry, grams: number): Entry {
  const ratio = entry.grams > 0 ? grams / entry.grams : 0;
  return {
    ...entry,
    grams,
    kcal: entry.kcal * ratio,
    protein: entry.protein * ratio,
    carbs: entry.carbs * ratio,
    fat: entry.fat * ratio,
  };
}

function withEntries(day: Day, entries: Entry[]): Day {
  const sum = (pick: (entry: Entry) => number) => entries.reduce((t, e) => t + pick(e), 0);
  return {
    ...day,
    entries,
    totals: {
      kcal: sum((e) => e.kcal),
      protein: sum((e) => e.protein),
      carbs: sum((e) => e.carbs),
      fat: sum((e) => e.fat),
    },
  };
}

/** Le jour tel qu'il sera une fois l'entrée enregistrée (même place si elle existe). */
export function applySaveEntry(day: Day, { entry }: SaveEntryVariables): Day {
  if (entry.date !== day.date) return day;
  const known = day.entries.some((one) => one.id === entry.id);
  return withEntries(
    day,
    known ? day.entries.map((one) => (one.id === entry.id ? entry : one)) : [...day.entries, entry],
  );
}

export function applyDeleteEntry(day: Day, { id, date }: DeleteEntryVariables): Day {
  if (date !== day.date) return day;
  return withEntries(
    day,
    day.entries.filter((one) => one.id !== id),
  );
}

export function applyWater(day: Day, { day: date, ml }: SaveWaterVariables): Day {
  return date === day.date ? { ...day, water_ml: ml } : day;
}

/** Jour lu sur le serveur, avec les saisies encore en file réappliquées dans l'ordre. */
export function withPendingJournal(queryClient: QueryClient, day: Day): Day {
  return pendingWrites(queryClient).reduce((shown, { key, variables }) => {
    if (isWrite(key, SAVE_ENTRY)) return applySaveEntry(shown, variables as SaveEntryVariables);
    if (isWrite(key, DELETE_ENTRY)) {
      return applyDeleteEntry(shown, variables as DeleteEntryVariables);
    }
    if (isWrite(key, SAVE_WATER)) return applyWater(shown, variables as SaveWaterVariables);
    return shown;
  }, day);
}
