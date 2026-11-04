import { useQuery } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { INSIGHTS_KEY } from "./query-keys";

export type DashboardData = Schemas["DashboardOut"];

/** Réponse inattendue de l'API : le message ne reprend aucune donnée. */
export class DashboardRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Bilan : réponse ${String(status)}`);
  }
}

/** Tableau de bord du compte (ADR 0013) : une seule requête pour les quatre blocs. */
export function useDashboard() {
  return useQuery({
    queryKey: [...INSIGHTS_KEY, "dashboard"],
    queryFn: async (): Promise<DashboardData> => {
      const { data, response } = await fetchClient.GET("/api/v1/insights/dashboard/");
      if (!data) throw new DashboardRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}
