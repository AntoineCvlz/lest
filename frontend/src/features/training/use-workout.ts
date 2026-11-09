import { useInfiniteQuery, useMutation, useQuery, type QueryClient } from "@tanstack/react-query";

import { useAccount } from "@/features/offline/account";
import {
  accountHeaders,
  assertStillQueued,
  isLastQueuedWrite,
  queuedWrite,
} from "@/features/offline/queue";
import { OFFLINE_MAX_AGE } from "@/features/offline/storage";
import { fetchClient, type Schemas } from "@/shared/api/client";

import { withPendingSets } from "./pending-sets";
import {
  ADD_EXERCISE,
  applyAddExercise,
  copiedExerciseId,
  FINISH_WORKOUT,
  pendingStart,
  START_WORKOUT,
  startedWorkout,
  withPendingWorkout,
  type AddExerciseVariables,
  type FinishWorkoutVariables,
  type StartWorkoutVariables,
} from "./pending-workouts";
import { WORKOUTS_KEY } from "./query-keys";

type WorkoutOut = Schemas["WorkoutOut"];
type WorkoutDetail = Schemas["WorkoutDetailOut"];

export const ONGOING_KEY = [...WORKOUTS_KEY, "ongoing"] as const;
const HISTORY_KEY = [...WORKOUTS_KEY, "history"] as const;
const HISTORY_PAGE_SIZE = 20;

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
    queryFn: async ({ client }): Promise<WorkoutOut | null> => {
      const { data, response } = await fetchClient.GET("/api/v1/workouts/", {
        params: { query: { ongoing: true, limit: 1 } },
      });
      if (!data) throw new WorkoutRequestFailed(response.status);
      // Séance démarrée ou terminée hors ligne, pas encore envoyée (ADR 0015).
      return withPendingWorkout(client, data.items[0] ?? null);
    },
    retry: false,
    // Gardée hors ligne : pas oubliée avant la copie (ADR 0015).
    gcTime: OFFLINE_MAX_AGE,
  });
}

/** Séances terminées, les plus récentes d'abord, résumées, page par page. */
export function useWorkoutHistory() {
  return useInfiniteQuery({
    queryKey: HISTORY_KEY,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<Schemas["WorkoutPageOut"]> => {
      const { data, response } = await fetchClient.GET("/api/v1/workouts/", {
        params: { query: { ongoing: false, cursor: pageParam, limit: HISTORY_PAGE_SIZE } },
      });
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data;
    },
    getNextPageParam: (page) => page.next_cursor,
    retry: false,
  });
}

/** Séance complète : exercices et séries. */
export function useWorkout(id: string | undefined) {
  return useQuery({
    queryKey: workoutKey(id ?? ""),
    queryFn: async ({ client }): Promise<WorkoutDetail> => {
      const { data, response } = await fetchClient.GET("/api/v1/workouts/{workout_id}/", {
        params: { path: { workout_id: id ?? "" } },
      });
      // Séance démarrée hors ligne, pas encore créée par l'API : celle de la file.
      const workout =
        data ?? (response.status === 404 ? pendingStart(client, id ?? "") : undefined);
      if (!workout) throw new WorkoutRequestFailed(response.status);
      // Exercices et séries saisis hors ligne pas encore envoyés : toujours affichés (ADR 0015).
      return withPendingSets(client, workout);
    },
    enabled: id !== undefined,
    retry: false,
    gcTime: OFFLINE_MAX_AGE,
  });
}

/** Identifiant généré par le client (UUID v4) : l'écriture peut être rejouée (ADR 0003). */
export function newId(): string {
  return crypto.randomUUID();
}

export const START_REFUSED = "Séance refusée par le serveur : elle n’a pas été enregistrée.";
export const ADD_REFUSED = "Exercice refusé par le serveur : il n’a pas été ajouté.";
export const FINISH_REFUSED = "Fin de séance refusée par le serveur : la séance reste en cours.";

/** Montre tout de suite une saisie dans la séance en cache. */
export async function showInWorkout(
  queryClient: QueryClient,
  workoutId: string,
  change: (workout: WorkoutDetail) => WorkoutDetail,
): Promise<void> {
  const key = workoutKey(workoutId);
  await queryClient.cancelQueries({ queryKey: key });
  queryClient.setQueryData<WorkoutDetail>(key, (workout) => workout && change(workout));
}

/**
 * Relit la séance une fois la file vide : records recalculés par l'API, et saisie refusée
 * retirée de l'affichage (l'état du serveur fait foi). Pas attendue : la saisie doit être
 * terminée quand la lecture réapplique celles qui restent en file (`withPendingSets`).
 */
export function refreshWorkout(queryClient: QueryClient, workoutId: string): void {
  if (!isLastQueuedWrite(queryClient)) return;
  void queryClient.invalidateQueries({ queryKey: ONGOING_KEY, exact: true });
  void queryClient.invalidateQueries({ queryKey: workoutKey(workoutId) });
}

async function putWorkout(account: string | null, workout: WorkoutOut): Promise<WorkoutOut> {
  const { data, response } = await fetchClient.PUT("/api/v1/workouts/{workout_id}/", {
    params: { path: { workout_id: workout.id } },
    headers: accountHeaders(account),
    body: {
      started_at: workout.started_at,
      ended_at: workout.ended_at,
      // Lue par l'API à la création seulement : ses exercices et cibles sont alors recopiés.
      ...(workout.program_day_id && { program_day_id: workout.program_day_id }),
    },
  });
  if (!data) throw new WorkoutRequestFailed(response.status);
  return data;
}

/**
 * Démarrer, compléter et terminer une séance en file d'attente (ADR 0015), comme les séries :
 * affiché tout de suite, envoyé dans l'ordre de saisie (`PUT` idempotents, ADR 0003).
 */
export function registerWorkoutWrites(queryClient: QueryClient): void {
  queryClient.setMutationDefaults<WorkoutOut, Error, StartWorkoutVariables>(START_WORKOUT, {
    ...queuedWrite(START_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      return putWorkout(variables.account, variables.workout);
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ONGOING_KEY, exact: true });
      queryClient.setQueryData(workoutKey(variables.workout.id), startedWorkout(variables));
      queryClient.setQueryData(ONGOING_KEY, variables.workout);
    },
    onSettled: (_data, _error, { workout }) => {
      refreshWorkout(queryClient, workout.id);
    },
  });
  queryClient.setMutationDefaults<unknown, Error, AddExerciseVariables>(ADD_EXERCISE, {
    ...queuedWrite(ADD_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      const { account, item } = variables;
      const { data, response } = await fetchClient.PUT(
        "/api/v1/workout-exercises/{workout_exercise_id}/",
        {
          params: { path: { workout_exercise_id: item.id } },
          headers: accountHeaders(account),
          body: {
            workout_id: item.workout_id,
            exercise_id: item.exercise_id,
            position: item.position,
          },
        },
      );
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data;
    },
    onMutate: (variables) =>
      showInWorkout(queryClient, variables.item.workout_id, (workout) =>
        applyAddExercise(workout, variables),
      ),
    onSettled: (_data, _error, { item }) => {
      refreshWorkout(queryClient, item.workout_id);
    },
  });
  queryClient.setMutationDefaults<WorkoutOut, Error, FinishWorkoutVariables>(FINISH_WORKOUT, {
    ...queuedWrite(FINISH_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      return putWorkout(variables.account, variables.workout);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ONGOING_KEY, exact: true });
      queryClient.setQueryData(ONGOING_KEY, null);
    },
    onSettled: (_data, _error, { workout }) => {
      refreshWorkout(queryClient, workout.id);
      // La séance terminée rejoint l'historique.
      if (isLastQueuedWrite(queryClient)) {
        void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
      }
    },
  });
}

/**
 * Démarre une séance, vide ou depuis une séance type dont l'API recopie les exercices et leurs
 * cibles. Les identifiants des lignes recopiées sont calculés comme l'API : une séance démarrée
 * hors ligne reçoit tout de suite ses séries.
 */
export function useStartWorkout() {
  const account = useAccount();
  const mutation = useMutation<WorkoutOut, Error, StartWorkoutVariables>({
    mutationKey: START_WORKOUT,
  });
  return {
    ...mutation,
    mutate: async (day?: Schemas["ProgramDayDetailOut"]): Promise<void> => {
      const workout: WorkoutOut = {
        id: newId(),
        started_at: new Date().toISOString(),
        ended_at: null,
        program_day_id: day?.id ?? null,
      };
      const exercises = await Promise.all(
        (day?.exercises ?? []).map(async (planned) => ({
          id: await copiedExerciseId(workout.id, planned.id),
          workout_id: workout.id,
          exercise_id: planned.exercise_id,
          exercise_name: planned.exercise_name,
          exercise_name_language: planned.exercise_name_language,
          exercise_category: planned.exercise_category,
          exercise_image: planned.exercise_image,
          position: planned.position,
          target_sets: planned.target_sets,
          target_reps: planned.target_reps,
          sets: [],
        })),
      );
      mutation.mutate({ account, workout, exercises });
    },
  };
}

/** Ajoute un exercice à la séance, en file ; renvoie l'identifiant de la ligne ajoutée. */
export function useAddExercise(workout: WorkoutDetail | undefined) {
  const account = useAccount();
  const mutation = useMutation<unknown, Error, AddExerciseVariables>({ mutationKey: ADD_EXERCISE });
  return {
    ...mutation,
    mutate: (exercise: Schemas["ExerciseOut"]): string | undefined => {
      if (!workout) return undefined;
      const position = Math.max(-1, ...workout.exercises.map((item) => item.position)) + 1;
      const item: Schemas["WorkoutExerciseDetailOut"] = {
        id: newId(),
        workout_id: workout.id,
        exercise_id: exercise.id,
        exercise_name: exercise.name,
        exercise_name_language: exercise.name_language,
        exercise_category: exercise.category,
        exercise_image: exercise.image,
        position,
        target_sets: null,
        target_reps: null,
        sets: [],
      };
      mutation.mutate({ account, item });
      return item.id;
    },
  };
}

/** Termine la séance, en file : elle quitte l'écran tout de suite. */
export function useFinishWorkout() {
  const account = useAccount();
  const mutation = useMutation<WorkoutOut, Error, FinishWorkoutVariables>({
    mutationKey: FINISH_WORKOUT,
  });
  return {
    ...mutation,
    mutate: (workout: WorkoutOut) => {
      mutation.mutate({ account, workout: { ...workout, ended_at: new Date().toISOString() } });
    },
  };
}
