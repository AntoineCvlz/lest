import {
  useMutation,
  useQuery,
  type MutateOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { useAccount } from "@/features/offline/account";
import { accountHeaders, isLastQueuedWrite, queuedWrite } from "@/features/offline/queue";
import { OFFLINE_MAX_AGE } from "@/features/offline/storage";
import { fetchClient, type Schemas } from "@/shared/api/client";

import {
  applyDelete,
  applySave,
  DELETE_SET,
  SAVE_SET,
  type DeleteSetVariables,
  type SaveSetVariables,
} from "./pending-sets";
import { WORKOUTS_KEY } from "./query-keys";
import { newId, ONGOING_KEY, workoutKey, WorkoutRequestFailed } from "./use-workout";

type WorkoutDetail = Schemas["WorkoutDetailOut"];
type SetOut = Schemas["SetOut"];

/** Séries de la dernière séance avec cet exercice, hors séance en cours (pré-remplissage). */
export function useLastSets(exerciseId: string, currentWorkoutId: string) {
  return useQuery({
    // Sous `WORKOUTS_KEY` : données privées, retirées avec les séances à l'expiration.
    queryKey: [...WORKOUTS_KEY, "last-sets", exerciseId, currentWorkoutId],
    queryFn: async (): Promise<SetOut[]> => {
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
    // Gardées hors ligne : pas oubliées avant la copie (ADR 0015).
    gcTime: OFFLINE_MAX_AGE,
  });
}

export interface NewSet {
  workoutExerciseId: string;
  weightKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  /** Moment de la série ; une modification garde celui d'origine. */
  performedAt?: string;
}

export const SET_REFUSED = "Série refusée par le serveur : elle n’a pas été enregistrée.";
export const DELETE_REFUSED = "Suppression refusée par le serveur : la série est gardée.";

/**
 * Relit la séance une fois la file vide : records recalculés par l'API, et saisie refusée
 * retirée de l'affichage (l'état du serveur fait foi). Pas attendue : la saisie doit être
 * terminée quand la lecture réapplique celles qui restent en file (`withPendingSets`).
 */
function refreshWorkout(queryClient: QueryClient, workoutId: string): void {
  if (isLastQueuedWrite(queryClient)) {
    void queryClient.invalidateQueries({ queryKey: workoutKey(workoutId) });
  }
}

/** Montre tout de suite une saisie de série dans la séance en cache. */
async function show(
  queryClient: QueryClient,
  workoutId: string,
  change: (workout: WorkoutDetail) => WorkoutDetail,
): Promise<void> {
  const key = workoutKey(workoutId);
  await queryClient.cancelQueries({ queryKey: key });
  queryClient.setQueryData<WorkoutDetail>(key, (workout) => workout && change(workout));
}

/**
 * Séries enregistrées et supprimées en file d'attente (ADR 0015) : affichées tout de suite
 * (mise à jour optimiste), envoyées dès que possible et dans l'ordre (`PUT` et `DELETE`
 * idempotents, ADR 0003).
 */
export function registerSetWrites(queryClient: QueryClient): void {
  queryClient.setMutationDefaults<SetOut, Error, SaveSetVariables>(SAVE_SET, {
    ...queuedWrite(SET_REFUSED),
    mutationFn: async ({ account, id, position, set }) => {
      const { data, response } = await fetchClient.PUT("/api/v1/sets/{set_id}/", {
        params: { path: { set_id: id } },
        headers: accountHeaders(account),
        body: {
          workout_exercise_id: set.workoutExerciseId,
          position,
          weight_kg: set.weightKg.toFixed(2),
          reps: set.reps,
          rpe: set.rpe,
          is_warmup: set.isWarmup,
          performed_at: set.performedAt,
        },
      });
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data;
    },
    onMutate: (variables) =>
      show(queryClient, variables.workoutId, (workout) => applySave(workout, variables)),
    onSettled: (_data, _error, { workoutId }) => {
      refreshWorkout(queryClient, workoutId);
    },
  });
  queryClient.setMutationDefaults<undefined, Error, DeleteSetVariables>(DELETE_SET, {
    ...queuedWrite(DELETE_REFUSED),
    mutationFn: async ({ account, set }) => {
      const { response } = await fetchClient.DELETE("/api/v1/sets/{set_id}/", {
        params: { path: { set_id: set.id } },
        headers: accountHeaders(account),
      });
      if (response.status !== 204) throw new WorkoutRequestFailed(response.status);
      return undefined;
    },
    onMutate: (variables) =>
      show(queryClient, variables.workoutId, (workout) => applyDelete(workout, variables)),
    onSettled: (_data, _error, { workoutId }) => {
      refreshWorkout(queryClient, workoutId);
    },
  });
}

/**
 * Enregistre une série, nouvelle ou modifiée (même `id` : `PUT` idempotent, ADR 0003), en file
 * d'attente : affichée tout de suite, envoyée dès que le réseau le permet. La réponse apporte
 * les records établis.
 */
export function useSaveSet(workoutId: string) {
  const account = useAccount();
  const mutation = useMutation<SetOut, Error, SaveSetVariables>({ mutationKey: SAVE_SET });
  return {
    ...mutation,
    mutate: (
      { id, position, set }: { id: string; position: number; set: NewSet },
      options?: MutateOptions<SetOut, Error, SaveSetVariables>,
    ) => {
      // L'heure de la série est celle de la saisie, pas celle de l'envoi.
      const performedAt = set.performedAt ?? new Date().toISOString();
      mutation.mutate({ account, workoutId, id, position, set: { ...set, performedAt } }, options);
    },
  };
}

/** Supprime une série (idempotent), en file d'attente : retirée tout de suite de l'affichage. */
export function useDeleteSet(workoutId: string) {
  const account = useAccount();
  const mutation = useMutation<undefined, Error, DeleteSetVariables>({ mutationKey: DELETE_SET });
  return {
    ...mutation,
    mutate: (set: SetOut, options?: MutateOptions<undefined, Error, DeleteSetVariables>) => {
      mutation.mutate({ account, workoutId, set }, options);
    },
  };
}

/**
 * Requêtes de séance gardées hors ligne : la séance en cours et les dernières séries de ses
 * exercices (charge pré-remplie). L'historique reste en ligne.
 */
export function isKeptForSession(queryClient: QueryClient, key: QueryKey): boolean {
  if (key[0] !== WORKOUTS_KEY[0]) return false;
  if (key[1] === "ongoing") return true;
  const ongoing = queryClient.getQueryData<Schemas["WorkoutOut"] | null>(ONGOING_KEY);
  if (!ongoing) return false;
  return key[1] === ongoing.id || (key[1] === "last-sets" && key[3] === ongoing.id);
}

/** Identifiant et position d'une nouvelle série : fixés avant l'envoi, donc rejouables. */
export function nextSet(item: Schemas["WorkoutExerciseDetailOut"]): {
  id: string;
  position: number;
} {
  return { id: newId(), position: Math.max(-1, ...item.sets.map((one) => one.position)) + 1 };
}
