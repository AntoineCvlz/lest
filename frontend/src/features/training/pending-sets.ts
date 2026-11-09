import type { QueryClient } from "@tanstack/react-query";

import { QUEUED_KEY } from "@/features/offline/queue";
import type { Schemas } from "@/shared/api/client";

type WorkoutDetail = Schemas["WorkoutDetailOut"];
type SetOut = Schemas["SetOut"];

export const SAVE_SET = [...QUEUED_KEY, "training", "save-set"] as const;
export const DELETE_SET = [...QUEUED_KEY, "training", "delete-set"] as const;

/** Série en file : tout est fixé à la saisie, l'envoi peut avoir lieu bien plus tard. */
export interface SaveSetVariables {
  account: string | null;
  workoutId: string;
  id: string;
  position: number;
  set: {
    workoutExerciseId: string;
    weightKg: number;
    reps: number;
    rpe: number | null;
    isWarmup: boolean;
    performedAt: string;
  };
}

export interface DeleteSetVariables {
  account: string | null;
  workoutId: string;
  set: SetOut;
}

/** Séance avec les séries de `itemId` transformées par `change`. */
function withSets(
  workout: WorkoutDetail,
  itemId: string,
  change: (sets: SetOut[]) => SetOut[],
): WorkoutDetail {
  return {
    ...workout,
    exercises: workout.exercises.map((item) =>
      item.id === itemId ? { ...item, sets: change(item.sets) } : item,
    ),
  };
}

/** La séance telle qu'elle sera une fois la série enregistrée. */
export function applySave(workout: WorkoutDetail, { id, position, set }: SaveSetVariables) {
  const shown: SetOut = {
    id,
    workout_exercise_id: set.workoutExerciseId,
    position,
    weight_kg: set.weightKg,
    reps: set.reps,
    rpe: set.rpe,
    is_warmup: set.isWarmup,
    performed_at: set.performedAt,
    // Recalculés par l'API (une modification peut retirer un record).
    records: [],
  };
  return withSets(workout, set.workoutExerciseId, (sets) =>
    sets.some((one) => one.id === id)
      ? sets.map((one) => (one.id === id ? shown : one))
      : [...sets, shown],
  );
}

/** La séance telle qu'elle sera une fois la série supprimée. */
export function applyDelete(workout: WorkoutDetail, { set }: DeleteSetVariables) {
  return withSets(workout, set.workout_exercise_id, (sets) =>
    sets.filter((kept) => kept.id !== set.id),
  );
}

function sameKey(key: readonly unknown[] | undefined, expected: readonly string[]): boolean {
  return key?.length === expected.length && expected.every((part, index) => key[index] === part);
}

/**
 * La séance lue sur le serveur, avec les séries encore en file réappliquées dans l'ordre de
 * saisie : une relecture (retour au premier plan, réseau instable) n'efface pas l'affichage des
 * saisies qui n'ont pas encore été envoyées.
 */
export function withPendingSets(queryClient: QueryClient, workout: WorkoutDetail): WorkoutDetail {
  const pending = queryClient
    .getMutationCache()
    .findAll({ mutationKey: QUEUED_KEY, status: "pending" });
  return pending.reduce((shown, mutation) => {
    const key = mutation.options.mutationKey;
    if (sameKey(key, SAVE_SET)) {
      const variables = mutation.state.variables as SaveSetVariables;
      return variables.workoutId === workout.id ? applySave(shown, variables) : shown;
    }
    if (sameKey(key, DELETE_SET)) {
      const variables = mutation.state.variables as DeleteSetVariables;
      return variables.workoutId === workout.id ? applyDelete(shown, variables) : shown;
    }
    return shown;
  }, workout);
}
