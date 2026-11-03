import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { localDay, shiftDay } from "@/shared/lib/days";
import { BODY_KEY } from "./query-keys";
import type { Site } from "./sites";

const MEASUREMENTS_KEY = [...BODY_KEY, "measurements"] as const;
/** Une année de mensurations : on se mesure rarement plus d'une fois par semaine. */
export const MEASUREMENT_DAYS = 366;

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
    queryFn: async (): Promise<Schemas["MeasurementOut"][]> => {
      const end = localDay();
      const { data, response } = await fetchClient.GET("/api/v1/body-measurements/", {
        params: { query: { start: shiftDay(end, -(MEASUREMENT_DAYS - 1)), end } },
      });
      if (!data) throw new MeasurementRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}

/** Envoi incomplet : endroits non enregistrés, et s'ils ont été refusés (422) plutôt que perdus. */
export class MeasurementSaveFailed extends Error {
  constructor(
    readonly failed: Site[],
    readonly refused: boolean,
  ) {
    super(`Mensurations : ${String(failed.length)} écriture(s) en échec`);
  }
}

/** Changement d'une mesure : nouvelle longueur en mètres, ou `null` pour la supprimer. */
export interface MeasurementChange {
  site: Site;
  metres: number | null;
}

async function apply(day: string, { site, metres }: MeasurementChange): Promise<void> {
  const path = { params: { path: { day, site } } };
  const { response } =
    metres === null
      ? await fetchClient.DELETE("/api/v1/body-measurements/{day}/{site}/", path)
      : await fetchClient.PUT("/api/v1/body-measurements/{day}/{site}/", {
          ...path,
          body: { length_m: metres },
        });
  if (!response.ok) throw new MeasurementRequestFailed(response.status);
}

/**
 * Applique les changements d'un jour, chacun idempotent (ADR 0007) : en cas d'échec partiel,
 * renvoyer le formulaire rejoue sans doublon. La liste est relue dans tous les cas.
 */
export function useSaveMeasurements() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ day, changes }: { day: string; changes: MeasurementChange[] }) => {
      const results = await Promise.allSettled(changes.map((change) => apply(day, change)));
      const failed = changes.filter((_, i) => results[i]?.status === "rejected");
      if (failed.length > 0) {
        const refused = results.some(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof MeasurementRequestFailed &&
            result.reason.status === 422,
        );
        throw new MeasurementSaveFailed(
          failed.map((change) => change.site),
          refused,
        );
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: MEASUREMENTS_KEY }),
  });
}
