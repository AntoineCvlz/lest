import { QueryClient, type MutationState } from "@tanstack/react-query";

import type { Schemas } from "@/shared/api/client";

import { DELETE_SET, SAVE_SET, withPendingSets } from "./pending-sets";

const WORKOUT = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const ITEM = "2b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function set(id: string, reps: number): Schemas["SetOut"] {
  return {
    id,
    workout_exercise_id: ITEM,
    position: 0,
    weight_kg: 80,
    reps,
    rpe: null,
    is_warmup: false,
    performed_at: "2026-11-09T18:00:00Z",
    records: [],
  };
}

function workout(sets: Schemas["SetOut"][], id = WORKOUT): Schemas["WorkoutDetailOut"] {
  return {
    id,
    started_at: "2026-11-09T17:30:00Z",
    ended_at: null,
    program_day_id: null,
    volume_kg: 0,
    exercises: [
      {
        id: ITEM,
        workout_id: id,
        exercise_id: "8c5b0f4e-9b1a-4d43-9d55-0d6d6b1f1a01",
        position: 0,
        exercise_name: "Bench Press",
        exercise_name_language: "en",
        exercise_category: "chest",
        exercise_image: null,
        target_sets: null,
        target_reps: null,
        sets,
      },
    ],
  };
}

/** Saisie en file, pas encore envoyée. */
function queue(queryClient: QueryClient, mutationKey: readonly string[], variables: unknown) {
  const state: MutationState = {
    context: undefined,
    data: undefined,
    error: null,
    failureCount: 0,
    failureReason: null,
    isPaused: true,
    status: "pending",
    variables,
    submittedAt: 0,
  };
  queryClient.getMutationCache().build(queryClient, { mutationKey: [...mutationKey] }, state);
}

describe("withPendingSets", () => {
  it("réapplique dans l'ordre les séries en file sur la séance lue au serveur", () => {
    const queryClient = new QueryClient();
    const kept = set("a", 8);
    const removed = set("b", 6);
    queue(queryClient, SAVE_SET, {
      account: null,
      workoutId: WORKOUT,
      id: "c",
      position: 2,
      set: {
        workoutExerciseId: ITEM,
        weightKg: 82.5,
        reps: 5,
        rpe: 9,
        isWarmup: false,
        performedAt: "2026-11-09T18:10:00Z",
      },
    });
    queue(queryClient, DELETE_SET, { account: null, workoutId: WORKOUT, set: removed });

    const shown = withPendingSets(queryClient, workout([kept, removed]));

    expect(shown.exercises[0]?.sets.map((one) => [one.id, one.reps])).toEqual([
      ["a", 8],
      ["c", 5],
    ]);
  });

  it("ne touche pas aux autres séances", () => {
    const queryClient = new QueryClient();
    queue(queryClient, DELETE_SET, { account: null, workoutId: "autre", set: set("a", 8) });
    const server = workout([set("a", 8)]);

    expect(withPendingSets(queryClient, server)).toEqual(server);
  });
});
