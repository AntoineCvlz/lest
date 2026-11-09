import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";

import { useAccount } from "@/features/offline/account";
import {
  accountHeaders,
  assertStillQueued,
  isLastQueuedWrite,
  queuedWrite,
} from "@/features/offline/queue";
import { fetchClient, type Schemas } from "@/shared/api/client";
import { localDay, shiftDay } from "@/shared/lib/days";

import {
  applyDeleteWeight,
  applySaveWeight,
  DELETE_WEIGHT,
  SAVE_WEIGHT,
  withPendingWeights,
  type DeleteWeightVariables,
  type SaveWeightVariables,
} from "./pending-weights";
import { BODY_KEY } from "./query-keys";

const WEIGHTS_KEY = [...BODY_KEY, "weights"] as const;
type Point = Schemas["WeightPointOut"];

/** Périodes de la courbe, en jours (aujourd'hui compris). */
export const PERIODS = [
  { value: 30, label: "30 jours" },
  { value: 90, label: "90 jours" },
  { value: 365, label: "1 an" },
] as const;
export type PeriodDays = (typeof PERIODS)[number]["value"];

export const WEIGHT_REFUSED = "Pesée refusée par le serveur : elle n’a pas été enregistrée.";
export const WEIGHT_DELETE_REFUSED = "Suppression refusée par le serveur : la pesée est gardée.";

/** Réponse inattendue de l'API : le message ne reprend aucune donnée saisie. */
export class WeightRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Pesées : réponse ${String(status)}`);
  }
}

function periodStart(days: number): string {
  return shiftDay(localDay(), -(days - 1));
}

/** Pesées des `days` derniers jours, par date croissante, avec leur moyenne sur 7 jours. */
export function useWeights(days: PeriodDays) {
  return useQuery({
    queryKey: [...WEIGHTS_KEY, days],
    queryFn: async ({ client }): Promise<Point[]> => {
      const start = periodStart(days);
      const { data, response } = await fetchClient.GET("/api/v1/body-weights/", {
        params: { query: { start, end: localDay() } },
      });
      if (!data) throw new WeightRequestFailed(response.status);
      // Pesées saisies hors ligne, pas encore envoyées : toujours affichées (ADR 0015).
      return withPendingWeights(client, data, start);
    },
    retry: false,
  });
}

/** Montre tout de suite une pesée dans chaque période en cache qui la contient. */
async function show(
  queryClient: QueryClient,
  day: string,
  change: (points: Point[]) => Point[],
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: WEIGHTS_KEY });
  for (const [key, points] of queryClient.getQueriesData<Point[]>({ queryKey: WEIGHTS_KEY })) {
    const days = key[2];
    if (points && typeof days === "number" && day >= periodStart(days)) {
      queryClient.setQueryData(key, change(points));
    }
  }
}

/** Relit les pesées une fois la file vide : moyenne recalculée, refus retirés de l'affichage. */
function refreshWeights(queryClient: QueryClient): void {
  if (isLastQueuedWrite(queryClient)) {
    void queryClient.invalidateQueries({ queryKey: WEIGHTS_KEY });
  }
}

/**
 * Pesées enregistrées et supprimées en file d'attente (ADR 0015) : affichées tout de suite,
 * envoyées dès que possible et dans l'ordre (`PUT` et `DELETE` idempotents, ADR 0007).
 */
export function registerWeightWrites(queryClient: QueryClient): void {
  queryClient.setMutationDefaults<unknown, Error, SaveWeightVariables>(SAVE_WEIGHT, {
    ...queuedWrite(WEIGHT_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      const { data, response } = await fetchClient.PUT("/api/v1/body-weights/{day}/", {
        params: { path: { day: variables.day } },
        headers: accountHeaders(variables.account),
        body: { weight_kg: variables.kilograms },
      });
      if (!data) throw new WeightRequestFailed(response.status);
      return data;
    },
    onMutate: (variables) =>
      show(queryClient, variables.day, (points) => applySaveWeight(points, variables)),
    onSettled: () => {
      refreshWeights(queryClient);
    },
  });
  queryClient.setMutationDefaults<undefined, Error, DeleteWeightVariables>(DELETE_WEIGHT, {
    ...queuedWrite(WEIGHT_DELETE_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      const { response } = await fetchClient.DELETE("/api/v1/body-weights/{day}/", {
        params: { path: { day: variables.day } },
        headers: accountHeaders(variables.account),
      });
      if (!response.ok) throw new WeightRequestFailed(response.status);
      return undefined;
    },
    onMutate: (variables) =>
      show(queryClient, variables.day, (points) => applyDeleteWeight(points, variables)),
    onSettled: () => {
      refreshWeights(queryClient);
    },
  });
}

/** Enregistre la pesée d'un jour, ou remplace celle qui existe, en file d'attente. */
export function useSaveWeight() {
  const account = useAccount();
  const mutation = useMutation<unknown, Error, SaveWeightVariables>({ mutationKey: SAVE_WEIGHT });
  return {
    ...mutation,
    mutate: ({ day, kilograms }: { day: string; kilograms: number }) => {
      mutation.mutate({ account, day, kilograms });
    },
  };
}

/** Supprime la pesée d'un jour (idempotent), en file d'attente. */
export function useDeleteWeight() {
  const account = useAccount();
  const mutation = useMutation<undefined, Error, DeleteWeightVariables>({
    mutationKey: DELETE_WEIGHT,
  });
  return {
    ...mutation,
    mutate: (day: string) => {
      mutation.mutate({ account, day });
    },
  };
}
