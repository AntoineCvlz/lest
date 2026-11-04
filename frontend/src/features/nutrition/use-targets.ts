import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { NUTRITION_KEY } from "./query-keys";
import { NutritionRequestFailed } from "./use-nutrition";

export type TargetsOut = Schemas["TargetsOut"];
export type TargetsIn = Schemas["TargetsIn"];
export type Macros = Schemas["MacrosOut"];

const TARGETS_KEY = [...NUTRITION_KEY, "targets"] as const;

export const ACTIVITIES: readonly {
  value: TargetsIn["activity"];
  label: string;
  detail: string;
}[] = [
  { value: "sedentary", label: "Sédentaire", detail: "Travail assis, peu de marche." },
  { value: "light", label: "Peu actif", detail: "1 à 3 séances par semaine." },
  { value: "moderate", label: "Actif", detail: "3 à 5 séances par semaine." },
  { value: "active", label: "Très actif", detail: "6 à 7 séances par semaine." },
  {
    value: "very_active",
    label: "Extrêmement actif",
    detail: "Travail physique et sport tous les jours.",
  },
];

/** Refus de l'API (422) : champs désignés, pour les rattacher au formulaire. */
export class TargetsRejected extends Error {
  constructor(readonly fields: readonly string[]) {
    super("Objectifs refusés");
  }
}

function rejectedFields(error: unknown): string[] {
  if (typeof error !== "object" || error === null || !("errors" in error)) return [];
  const { errors } = error;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((e: unknown) => {
    if (typeof e !== "object" || e === null || !("loc" in e) || !Array.isArray(e.loc)) return [];
    const last: unknown = e.loc.at(-1);
    return typeof last === "string" ? [last] : [];
  });
}

/** Objectifs du compte : calculés, retenus, et ce qui manque pour calculer (ADR 0011). */
export function useTargets() {
  return useQuery({
    queryKey: TARGETS_KEY,
    queryFn: async (): Promise<TargetsOut> => {
      const { data, response } = await fetchClient.GET("/api/v1/nutrition/targets/");
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}

export function useSaveTargets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: TargetsIn): Promise<TargetsOut> => {
      const { data, error, response } = await fetchClient.PUT("/api/v1/nutrition/targets/", {
        body,
      });
      if (response.status === 422) throw new TargetsRejected(rejectedFields(error));
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(TARGETS_KEY, data);
    },
  });
}
