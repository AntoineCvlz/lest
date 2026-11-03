import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { localDay, shiftDay } from "./days";
import { BODY_KEY } from "./query-keys";

const WEIGHTS_KEY = [...BODY_KEY, "weights"] as const;

/** Périodes de la courbe, en jours (aujourd'hui compris). */
export const PERIODS = [
  { value: 30, label: "30 jours" },
  { value: 90, label: "90 jours" },
  { value: 365, label: "1 an" },
] as const;
export type PeriodDays = (typeof PERIODS)[number]["value"];

/** Réponse inattendue de l'API : le message ne reprend aucune donnée saisie. */
export class WeightRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Pesées : réponse ${String(status)}`);
  }
}

/** Pesées des `days` derniers jours, par date croissante, avec leur moyenne sur 7 jours. */
export function useWeights(days: PeriodDays) {
  return useQuery({
    queryKey: [...WEIGHTS_KEY, days],
    queryFn: async (): Promise<Schemas["WeightPointOut"][]> => {
      const end = localDay();
      const { data, response } = await fetchClient.GET("/api/v1/body-weights/", {
        params: { query: { start: shiftDay(end, -(days - 1)), end } },
      });
      if (!data) throw new WeightRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}

/** Enregistre la pesée d'un jour, ou remplace celle qui existe (`PUT` idempotent, ADR 0007). */
export function useSaveWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ day, kilograms }: { day: string; kilograms: number }) => {
      const { data, response } = await fetchClient.PUT("/api/v1/body-weights/{day}/", {
        params: { path: { day } },
        body: { weight_kg: kilograms },
      });
      if (!data) throw new WeightRequestFailed(response.status);
      return data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: WEIGHTS_KEY }),
  });
}

export function useDeleteWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (day: string) => {
      const { response } = await fetchClient.DELETE("/api/v1/body-weights/{day}/", {
        params: { path: { day } },
      });
      if (!response.ok) throw new WeightRequestFailed(response.status);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: WEIGHTS_KEY }),
  });
}
