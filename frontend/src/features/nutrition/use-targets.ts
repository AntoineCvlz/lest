import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { NUTRITION_KEY } from "./query-keys";
import { NutritionRequestFailed } from "./use-nutrition";

export type TargetsOut = Schemas["TargetsOut"];
export type TargetsIn = Schemas["TargetsIn"];
export type Macros = Schemas["MacrosOut"];

const TARGETS_KEY = [...NUTRITION_KEY, "targets"] as const;

export const ACTIVITIES: readonly { value: TargetsIn["activity"]; label: string }[] = [
  { value: "sedentary", label: "Sédentaire : travail assis, peu de marche" },
  { value: "light", label: "Peu actif : 1 à 3 séances par semaine" },
  { value: "moderate", label: "Actif : 3 à 5 séances par semaine" },
  { value: "active", label: "Très actif : 6 à 7 séances par semaine" },
  { value: "very_active", label: "Extrêmement actif : travail physique et sport quotidien" },
];

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
      const { data, response } = await fetchClient.PUT("/api/v1/nutrition/targets/", { body });
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(TARGETS_KEY, data);
    },
  });
}
