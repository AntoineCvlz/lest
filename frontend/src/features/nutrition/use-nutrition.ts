import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { NUTRITION_KEY } from "./query-keys";

export type Food = Schemas["FoodOut"];
export type Entry = Schemas["EntryOut"];
export type Meal = Entry["meal"];

const JOURNAL_KEY = [...NUTRITION_KEY, "journal"] as const;
const RECENT_KEY = [...NUTRITION_KEY, "recent"] as const;
const SEARCH_KEY = [...NUTRITION_KEY, "search"] as const;

export const MEALS: readonly { value: Meal; label: string }[] = [
  { value: "breakfast", label: "Petit-déjeuner" },
  { value: "lunch", label: "Déjeuner" },
  { value: "dinner", label: "Dîner" },
  { value: "snack", label: "Collation" },
];

/** Réponse inattendue de l'API : le message ne reprend aucune donnée saisie. */
export class NutritionRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Nutrition : réponse ${String(status)}`);
  }
}

/** Journal d'un jour : entrées, totaux et eau. */
export function useDayJournal(day: string) {
  return useQuery({
    queryKey: [...JOURNAL_KEY, day],
    queryFn: async (): Promise<Schemas["DayOut"]> => {
      const { data, response } = await fetchClient.GET("/api/v1/journal/{day}/", {
        params: { path: { day } },
      });
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}

/** Aliments saisis récemment : proposés avant toute recherche. */
export function useRecentFoods() {
  return useQuery({
    queryKey: RECENT_KEY,
    queryFn: async (): Promise<Food[]> => {
      const { data, response } = await fetchClient.GET("/api/v1/foods/recent/");
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}

/** Recherche locale (Ciqual, produits scannés, aliments perso), 2 caractères au moins. */
export function useFoodSearch(query: string) {
  return useQuery({
    queryKey: [...SEARCH_KEY, query],
    queryFn: async (): Promise<Food[]> => {
      const { data, response } = await fetchClient.GET("/api/v1/foods/", {
        params: { query: { q: query } },
      });
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Aliment d'un code-barres (Open Food Facts, ADR 0009) ; l'erreur porte le statut HTTP. */
export function useBarcodeLookup() {
  return useMutation({
    mutationFn: async (code: string): Promise<Food> => {
      const { data, response } = await fetchClient.GET("/api/v1/foods/barcode/{code}/", {
        params: { path: { code } },
      });
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
  });
}

/** Ajoute ou modifie une entrée (UUID du client, `PUT` idempotent, ADR 0003). */
export function useSaveEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entry: {
      id: string;
      date: string;
      meal: Meal;
      foodId: string;
      grams: number;
    }): Promise<Entry> => {
      const { data, response } = await fetchClient.PUT("/api/v1/journal-entries/{entry_id}/", {
        params: { path: { entry_id: entry.id } },
        body: { date: entry.date, meal: entry.meal, food_id: entry.foodId, grams: entry.grams },
      });
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NUTRITION_KEY }),
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { response } = await fetchClient.DELETE("/api/v1/journal-entries/{entry_id}/", {
        params: { path: { entry_id: id } },
      });
      if (!response.ok) throw new NutritionRequestFailed(response.status);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: JOURNAL_KEY }),
  });
}

/** Fixe le total d'eau du jour (idempotent). */
export function useSaveWater() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ day, ml }: { day: string; ml: number }) => {
      const { data, response } = await fetchClient.PUT("/api/v1/water/{day}/", {
        params: { path: { day } },
        body: { ml },
      });
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: JOURNAL_KEY }),
  });
}
