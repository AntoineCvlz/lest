import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { WORKOUTS_KEY } from "./query-keys";
import { newId, workoutKey, WorkoutRequestFailed } from "./use-workout";

type WorkoutDetail = Schemas["WorkoutDetailOut"];

/** Séries de la dernière séance avec cet exercice, hors séance en cours (pré-remplissage). */
export function useLastSets(exerciseId: string, currentWorkoutId: string) {
  return useQuery({
    // Sous `WORKOUTS_KEY` : données privées, retirées avec les séances à l'expiration.
    queryKey: [...WORKOUTS_KEY, "last-sets", exerciseId, currentWorkoutId],
    queryFn: async (): Promise<Schemas["SetOut"][]> => {
      const { data, response } = await fetchClient.GET(
        "/api/v1/exercises/{exercise_id}/last-sets/",
        {
          params: {
            path: { exercise_id: exerciseId },
            query: { exclude_workout: currentWorkoutId },
          },
        },
      );
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data.sets;
    },
    retry: false,
  });
}

export interface NewSet {
  workoutExerciseId: string;
  weightKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
}

/**
 * Enregistre une série. Affichée tout de suite (mise à jour optimiste du cache de la séance),
 * retirée si l'API refuse ; la réponse apporte les records établis.
 */
export function useSaveSet(workoutId: string) {
  const queryClient = useQueryClient();
  const key = workoutKey(workoutId);
  return useMutation({
    mutationFn: async ({ id, position, set }: { id: string; position: number; set: NewSet }) => {
      const { data, response } = await fetchClient.PUT("/api/v1/sets/{set_id}/", {
        params: { path: { set_id: id } },
        body: {
          workout_exercise_id: set.workoutExerciseId,
          position,
          weight_kg: set.weightKg.toFixed(2),
          reps: set.reps,
          rpe: set.rpe,
          is_warmup: set.isWarmup,
          performed_at: new Date().toISOString(),
        },
      });
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data;
    },
    onMutate: async ({ id, position, set }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WorkoutDetail>(key);
      queryClient.setQueryData<WorkoutDetail>(
        key,
        (workout) =>
          workout && {
            ...workout,
            exercises: workout.exercises.map((item) =>
              item.id === set.workoutExerciseId
                ? {
                    ...item,
                    sets: [
                      ...item.sets,
                      {
                        id,
                        workout_exercise_id: item.id,
                        position,
                        weight_kg: set.weightKg,
                        reps: set.reps,
                        rpe: set.rpe,
                        is_warmup: set.isWarmup,
                        performed_at: new Date().toISOString(),
                        records: [],
                      },
                    ],
                  }
                : item,
            ),
          },
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(key, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Identifiant et position d'une nouvelle série : fixés avant l'envoi, donc rejouables. */
export function nextSet(item: Schemas["WorkoutExerciseDetailOut"]): {
  id: string;
  position: number;
} {
  return { id: newId(), position: Math.max(-1, ...item.sets.map((one) => one.position)) + 1 };
}
