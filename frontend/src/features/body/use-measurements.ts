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
  applyMeasurement,
  SAVE_MEASUREMENT,
  withPendingMeasurements,
  type SaveMeasurementVariables,
} from "./pending-measurements";
import { BODY_KEY } from "./query-keys";
import type { Site } from "./sites";

const MEASUREMENTS_KEY = [...BODY_KEY, "measurements"] as const;
/** Une année de mensurations : on se mesure rarement plus d'une fois par semaine. */
export const MEASUREMENT_DAYS = 366;

export const MEASUREMENT_REFUSED = "Mesure refusée par le serveur : elle n’a pas été enregistrée.";

type Row = Schemas["MeasurementOut"];

/** Réponse inattendue de l'API : le message ne reprend aucune donnée saisie. */
export class MeasurementRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Mensurations : réponse ${String(status)}`);
  }
}

/** Mensurations de la dernière année, par date puis endroit. */
export function useMeasurements() {
  return useQuery({
    queryKey: MEASUREMENTS_KEY,
    queryFn: async ({ client }): Promise<Row[]> => {
      const end = localDay();
      const { data, response } = await fetchClient.GET("/api/v1/body-measurements/", {
        params: { query: { start: shiftDay(end, -(MEASUREMENT_DAYS - 1)), end } },
      });
      if (!data) throw new MeasurementRequestFailed(response.status);
      // Mesures saisies hors ligne, pas encore envoyées : toujours affichées (ADR 0015).
      return withPendingMeasurements(client, data);
    },
    retry: false,
  });
}

/** Changement d'une mesure : nouvelle longueur en mètres, ou `null` pour la supprimer. */
export interface MeasurementChange {
  site: Site;
  metres: number | null;
}

/**
 * Mesures en file d'attente (ADR 0015), une écriture par endroit (`PUT` ou `DELETE`
 * idempotent, ADR 0007) : affichées tout de suite, envoyées dans l'ordre de saisie.
 */
export function registerMeasurementWrites(queryClient: QueryClient): void {
  queryClient.setMutationDefaults<undefined, Error, SaveMeasurementVariables>(SAVE_MEASUREMENT, {
    ...queuedWrite(MEASUREMENT_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      const { account, day, site, metres } = variables;
      const request = { params: { path: { day, site } }, headers: accountHeaders(account) };
      const { response } =
        metres === null
          ? await fetchClient.DELETE("/api/v1/body-measurements/{day}/{site}/", request)
          : await fetchClient.PUT("/api/v1/body-measurements/{day}/{site}/", {
              ...request,
              body: { length_m: metres },
            });
      if (!response.ok) throw new MeasurementRequestFailed(response.status);
      return undefined;
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: MEASUREMENTS_KEY });
      queryClient.setQueryData<Row[]>(
        MEASUREMENTS_KEY,
        (rows) => rows && applyMeasurement(rows, variables),
      );
    },
    onSettled: () => {
      if (isLastQueuedWrite(queryClient)) {
        void queryClient.invalidateQueries({ queryKey: MEASUREMENTS_KEY });
      }
    },
  });
}

/** Applique les changements d'un jour, en file : chaque endroit est une saisie à part. */
export function useSaveMeasurements() {
  const account = useAccount();
  const mutation = useMutation<undefined, Error, SaveMeasurementVariables>({
    mutationKey: SAVE_MEASUREMENT,
  });
  return {
    ...mutation,
    mutate: ({ day, changes }: { day: string; changes: MeasurementChange[] }) => {
      for (const { site, metres } of changes) mutation.mutate({ account, day, site, metres });
    },
  };
}
