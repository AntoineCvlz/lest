import { QueryClient, type MutationState } from "@tanstack/react-query";

import { registerQueuedWrites } from "@/features/offline/offline-query-provider";

import {
  copiedExerciseId,
  FINISH_WORKOUT,
  pendingStart,
  START_WORKOUT,
  withPendingWorkout,
  type FinishWorkoutVariables,
  type StartWorkoutVariables,
} from "./pending-workouts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const started = { id: A, started_at: "2026-11-09T17:00:00Z", ended_at: null, program_day_id: null };

function offlineClient(): QueryClient {
  const queryClient = new QueryClient();
  registerQueuedWrites(queryClient);
  return queryClient;
}

/** Saisie en file, en pause comme sans réseau : construite sans être exécutée. */
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

describe("copiedExerciseId", () => {
  it("dérive l'identifiant comme l'API (copied_exercise_id)", async () => {
    // Valeur calculée par `apps.training.services.copied_exercise_id` pour ces deux UUID.
    expect(await copiedExerciseId(A, B)).toBe("6b98298d-7dd9-45af-998b-610aa8801c89");
  });
});

describe("withPendingWorkout", () => {
  it("garde affichée une séance démarrée hors ligne que le serveur ne connaît pas encore", () => {
    const queryClient = offlineClient();
    const variables: StartWorkoutVariables = { account: null, workout: started, exercises: [] };
    queue(queryClient, START_WORKOUT, variables);

    expect(withPendingWorkout(queryClient, null)).toEqual(started);
    expect(pendingStart(queryClient, A)).toEqual({ ...started, exercises: [], volume_kg: 0 });
    expect(pendingStart(queryClient, B)).toBeUndefined();
  });

  it("ne fait pas revenir une séance terminée hors ligne", () => {
    const queryClient = offlineClient();
    const variables: FinishWorkoutVariables = {
      account: null,
      workout: { ...started, ended_at: "2026-11-09T18:00:00Z" },
    };
    queue(queryClient, FINISH_WORKOUT, variables);

    expect(withPendingWorkout(queryClient, started)).toBeNull();
    expect(withPendingWorkout(queryClient, { ...started, id: B })).toEqual({ ...started, id: B });
  });
});
