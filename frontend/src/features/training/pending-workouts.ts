import type { QueryClient } from "@tanstack/react-query";

import { isWrite, pendingWrites, QUEUED_KEY } from "@/features/offline/queue";
import type { Schemas } from "@/shared/api/client";

type WorkoutOut = Schemas["WorkoutOut"];
type WorkoutDetail = Schemas["WorkoutDetailOut"];
type WorkoutItem = Schemas["WorkoutExerciseDetailOut"];

export const START_WORKOUT = [...QUEUED_KEY, "training", "start-workout"] as const;
export const ADD_EXERCISE = [...QUEUED_KEY, "training", "add-exercise"] as const;
export const FINISH_WORKOUT = [...QUEUED_KEY, "training", "finish-workout"] as const;

/** Séance démarrée en file, avec les exercices recopiés de sa séance type (affichage). */
export interface StartWorkoutVariables {
  account: string | null;
  workout: WorkoutOut;
  exercises: WorkoutItem[];
}

/** Exercice ajouté en file : la ligne affichée, identifiant et position compris. */
export interface AddExerciseVariables {
  account: string | null;
  item: WorkoutItem;
}

/** Séance terminée en file : `workout.ended_at` est l'heure de l'appui. */
export interface FinishWorkoutVariables {
  account: string | null;
  workout: WorkoutOut;
}

function uuidBytes(id: string): number[] {
  const hex = id.replaceAll("-", "");
  return Array.from({ length: 16 }, (_, index) =>
    parseInt(hex.slice(2 * index, 2 * index + 2), 16),
  );
}

/**
 * Identifiant de l'exercice de séance recopié d'un exercice de programme, calculé comme l'API
 * (`copied_exercise_id`) : SHA-256 des deux identifiants, 16 premiers octets, au format v4. Une
 * séance démarrée hors ligne peut ainsi recevoir ses séries avant d'être envoyée.
 */
export async function copiedExerciseId(
  workoutId: string,
  programExerciseId: string,
): Promise<string> {
  const source = new Uint8Array([...uuidBytes(workoutId), ...uuidBytes(programExerciseId)]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source)).slice(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x40;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Séance telle qu'elle sera une fois créée par l'API. */
export function startedWorkout({ workout, exercises }: StartWorkoutVariables): WorkoutDetail {
  return { ...workout, exercises, volume_kg: 0 };
}

/** La séance telle qu'elle sera une fois l'exercice ajouté. */
export function applyAddExercise(
  workout: WorkoutDetail,
  { item }: AddExerciseVariables,
): WorkoutDetail {
  if (item.workout_id !== workout.id) return workout;
  const exercises = workout.exercises.some((one) => one.id === item.id)
    ? workout.exercises
    : [...workout.exercises, item];
  return { ...workout, exercises };
}

/**
 * Séance en cours lue sur le serveur, corrigée des démarrages et fins de séance encore en file :
 * une relecture ne fait ni disparaître une séance démarrée hors ligne, ni revenir une séance
 * terminée hors ligne.
 */
export function withPendingWorkout(
  queryClient: QueryClient,
  ongoing: WorkoutOut | null,
): WorkoutOut | null {
  return pendingWrites(queryClient).reduce<WorkoutOut | null>((shown, { key, variables }) => {
    if (isWrite(key, START_WORKOUT)) return (variables as StartWorkoutVariables).workout;
    if (isWrite(key, FINISH_WORKOUT)) {
      return shown?.id === (variables as FinishWorkoutVariables).workout.id ? null : shown;
    }
    return shown;
  }, ongoing);
}

/** Séance démarrée en file et pas encore créée par l'API, ou `undefined`. */
export function pendingStart(queryClient: QueryClient, id: string): WorkoutDetail | undefined {
  const start = pendingWrites(queryClient).find(
    ({ key, variables }) =>
      isWrite(key, START_WORKOUT) && (variables as StartWorkoutVariables).workout.id === id,
  );
  return start && startedWorkout(start.variables as StartWorkoutVariables);
}
