import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";
import { localDay, shiftDay } from "@/shared/lib/days";

import { BASICFIT_KEY } from "./query-keys";

export type Connection = Schemas["ConnectionOut"];
export type ClubVisit = Schemas["VisitOut"];

/** Visites montrées : les 30 derniers jours, aujourd'hui compris. */
export const VISIT_DAYS = 30;

const CONNECTION_KEY = [...BASICFIT_KEY, "connection"] as const;
const VISITS_KEY = [...BASICFIT_KEY, "visits"] as const;

/** Refus de l'API : statut et type RFC 9457 seulement (jamais l'adresse collée). */
export class BasicFitRequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly type = "",
  ) {
    super(`Basic-Fit : réponse ${String(status)}`);
  }
}

function problemType(error: unknown): string {
  if (typeof error !== "object" || error === null || !("type" in error)) return "";
  return typeof error.type === "string" ? error.type : "";
}

/** État de la liaison (désactivée, absente, reliée, à refaire). */
export function useConnection() {
  return useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: async (): Promise<Connection> => {
      const { data, response } = await fetchClient.GET("/api/v1/basicfit/connection/");
      if (!data) throw new BasicFitRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}

/** Visites en club des `VISIT_DAYS` derniers jours. */
export function useVisits(enabled: boolean) {
  return useQuery({
    queryKey: [...VISITS_KEY, VISIT_DAYS],
    queryFn: async (): Promise<ClubVisit[]> => {
      const end = localDay();
      const { data, response } = await fetchClient.GET("/api/v1/basicfit/visits/", {
        params: { query: { start: shiftDay(end, -(VISIT_DAYS - 1)), end } },
      });
      if (!data) throw new BasicFitRequestFailed(response.status);
      return data;
    },
    enabled,
    retry: false,
  });
}

/** Prépare la connexion : renvoie l'adresse de la page de connexion Basic-Fit. */
export function useStartLogin() {
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error, response } = await fetchClient.POST(
        "/api/v1/basicfit/connection/start/",
      );
      if (!data) throw new BasicFitRequestFailed(response.status, problemType(error));
      return data.authorize_url;
    },
    gcTime: 0,
  });
}

/** Termine la connexion avec l'adresse de redirection collée (porte un code : jamais gardée). */
export function useCompleteLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (redirectUrl: string): Promise<Connection> => {
      const { data, error, response } = await fetchClient.POST(
        "/api/v1/basicfit/connection/complete/",
        { body: { redirect_url: redirectUrl } },
      );
      if (!data) throw new BasicFitRequestFailed(response.status, problemType(error));
      return data;
    },
    gcTime: 0,
    onSuccess: (data) => {
      queryClient.setQueryData(CONNECTION_KEY, data);
    },
  });
}

export function useSyncNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await fetchClient.POST("/api/v1/basicfit/sync/");
      if (!response.ok) throw new BasicFitRequestFailed(response.status, problemType(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: BASICFIT_KEY }),
  });
}

export function useDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { response } = await fetchClient.DELETE("/api/v1/basicfit/connection/");
      if (!response.ok) throw new BasicFitRequestFailed(response.status);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: BASICFIT_KEY }),
  });
}
