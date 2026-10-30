import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { WORKOUTS_KEY } from "./query-keys";

const ONGOING_KEY = [...WORKOUTS_KEY, "ongoing"] as const;

export function workoutKey(id: string) {
  return [...WORKOUTS_KEY, id] as const;
}

/** Réponse inattendue de l'API : le message ne reprend aucune donnée saisie. */
export class WorkoutRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Séance : réponse ${String(status)}`);
  }
}

/** Séance commencée et pas terminée (la plus récente), ou `null`. */
export function useOngoingWorkout() {
  return useQuery({
    queryKey: ONGOING_KEY,
    queryFn: async (): Promise<Schemas["WorkoutOut"] | null> => {
      const { data, response } = await fetchClient.GET("/api/v1/workouts/", {
        params: { query: { ongoing: true, limit: 1 } },
      });
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data.items[0] ?? null;
    },
    retry: false,
  });
}

/** Séance complète : exercices et séries. */
export function useWorkout(id: string | undefined) {
  return useQuery({
    queryKey: workoutKey(id ?? ""),
    queryFn: async (): Promise<Schemas["WorkoutDetailOut"]> => {
      const { data, response } = await fetchClient.GET("/api/v1/workouts/{workout_id}/", {
        params: { path: { workout_id: id ?? "" } },
      });
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data;
    },
    enabled: id !== undefined,
    retry: false,
  });
}

/** Identifiant généré par le client (UUID v4) : l'écriture peut être rejouée (ADR 0003). */
export function newId(): string {
  return crypto.randomUUID();
}

export function useStartWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<Schemas["WorkoutOut"]> => {
      const { data, response } = await fetchClient.PUT("/api/v1/workouts/{workout_id}/", {
        params: { path: { workout_id: newId() } },
        body: { started_at: new Date().toISOString() },
      });
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data;
    },
    onSuccess: (workout) => {
      queryClient.setQueryData(ONGOING_KEY, workout);
    },
  });
}

export function useAddExercise(workout: Schemas["WorkoutDetailOut"] | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (exerciseId: string) => {
      if (!workout) throw new Error("Aucune séance en cours.");
      const position = Math.max(-1, ...workout.exercises.map((item) => item.position)) + 1;
      const { data, response } = await fetchClient.PUT(
        "/api/v1/workout-exercises/{workout_exercise_id}/",
        {
          params: { path: { workout_exercise_id: newId() } },
          body: { workout_id: workout.id, exercise_id: exerciseId, position },
        },
      );
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data;
    },
    onSuccess: async () => {
      if (workout) await queryClient.invalidateQueries({ queryKey: workoutKey(workout.id) });
    },
  });
}

export function useFinishWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (workout: Schemas["WorkoutOut"]) => {
      const { data, response } = await fetchClient.PUT("/api/v1/workouts/{workout_id}/", {
        params: { path: { workout_id: workout.id } },
        body: { started_at: workout.started_at, ended_at: new Date().toISOString() },
      });
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data;
    },
    onSuccess: () => {
      queryClient.setQueryData(ONGOING_KEY, null);
    },
  });
}
