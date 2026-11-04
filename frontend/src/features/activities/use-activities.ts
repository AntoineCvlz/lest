import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";
import { localDay, shiftDay } from "@/shared/lib/days";

import { ACTIVITIES_KEY } from "./query-keys";

export type Sport = Schemas["SportOut"];
export type SportKey = Sport["key"];
export type Activity = Schemas["ActivityOut"];
export type ActivityIn = Schemas["ActivityIn"];

/** Activités montrées : les 30 derniers jours, aujourd'hui compris. */
export const JOURNAL_DAYS = 30;

const SPORTS_KEY = ["sports"] as const;

/** Réponse inattendue de l'API : le message ne reprend aucune donnée saisie. */
export class ActivityRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Activités : réponse ${String(status)}`);
  }
}

/** Catalogue des sports (ADR 0012) : fixe, versionné avec l'API. */
export function useSports() {
  return useQuery({
    queryKey: SPORTS_KEY,
    queryFn: async (): Promise<Sport[]> => {
      const { data, response } = await fetchClient.GET("/api/v1/sports/");
      if (!data) throw new ActivityRequestFailed(response.status);
      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** Activités des `JOURNAL_DAYS` derniers jours, par date puis ordre de saisie. */
export function useActivities() {
  return useQuery({
    queryKey: [...ACTIVITIES_KEY, JOURNAL_DAYS],
    queryFn: async (): Promise<Activity[]> => {
      const end = localDay();
      const { data, response } = await fetchClient.GET("/api/v1/activities/", {
        params: { query: { start: shiftDay(end, -(JOURNAL_DAYS - 1)), end } },
      });
      if (!data) throw new ActivityRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}

/** Crée ou remplace une activité sous l'UUID du client (`PUT` idempotent, ADR 0003). */
export function useSaveActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: ActivityIn }): Promise<Activity> => {
      const { data, response } = await fetchClient.PUT("/api/v1/activities/{activity_id}/", {
        params: { path: { activity_id: id } },
        body,
      });
      if (!data) throw new ActivityRequestFailed(response.status);
      return data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACTIVITIES_KEY }),
  });
}

export function useDeleteActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { response } = await fetchClient.DELETE("/api/v1/activities/{activity_id}/", {
        params: { path: { activity_id: id } },
      });
      if (!response.ok) throw new ActivityRequestFailed(response.status);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACTIVITIES_KEY }),
  });
}
