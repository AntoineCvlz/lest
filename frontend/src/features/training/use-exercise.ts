import { useQuery } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { WORKOUTS_KEY } from "./query-keys";
import { WorkoutRequestFailed } from "./use-workout";

// Catalogue commun, importé une fois par mois.
const CATALOG_STALE_MS = 60 * 60 * 1000;

/** Fiche d'un exercice du catalogue ; `null` s'il n'existe pas (404). */
export function useExercise(id: string) {
  return useQuery({
    queryKey: ["exercise", id],
    queryFn: async (): Promise<Schemas["ExerciseDetailOut"] | null> => {
      const { data, response } = await fetchClient.GET("/api/v1/exercises/{exercise_id}/", {
        params: { path: { exercise_id: id } },
      });
      if (response.status === 404 || response.status === 422) return null;
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data;
    },
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
}

/** Records successifs du compte pour cet exercice, du plus ancien au plus récent. */
export function useExerciseRecords(id: string) {
  return useQuery({
    // Sous `WORKOUTS_KEY` : données privées, retirées à l'expiration de la session.
    queryKey: [...WORKOUTS_KEY, "records", id],
    queryFn: async (): Promise<Schemas["RecordOut"][]> => {
      const { data, response } = await fetchClient.GET("/api/v1/exercises/{exercise_id}/records/", {
        params: { path: { exercise_id: id } },
      });
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data.history;
    },
    retry: false,
  });
}
