import { QueryClient, type MutationState } from "@tanstack/react-query";

import {
  applyDeleteActivity,
  applySaveActivity,
  DELETE_ACTIVITY,
  SAVE_ACTIVITY,
  withPendingActivities,
} from "./pending-activities";

const activity = (id: string, date: string, duration_s = 1800) => ({
  id,
  date,
  sport: "running" as const,
  duration_s,
  distance_m: null,
  avg_heart_rate: null,
  feeling: null,
  metrics: {},
});

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

describe("applySaveActivity", () => {
  it("remplace l'activité à sa place ou l'insère par date", () => {
    const shown = [activity("a", "2026-11-01"), activity("b", "2026-11-05")];

    expect(
      applySaveActivity(shown, { account: null, activity: activity("c", "2026-11-03") }).map(
        (one) => one.id,
      ),
    ).toEqual(["a", "c", "b"]);
    expect(
      applySaveActivity(shown, { account: null, activity: activity("a", "2026-11-01", 60) })[0],
    ).toMatchObject({ id: "a", duration_s: 60 });
    expect(applyDeleteActivity(shown, { account: null, id: "b" })).toEqual([shown[0]]);
  });
});

describe("withPendingActivities", () => {
  it("réapplique les activités en file de la période affichée, dans l'ordre", () => {
    const queryClient = new QueryClient();
    queue(queryClient, SAVE_ACTIVITY, { account: null, activity: activity("c", "2026-11-03") });
    queue(queryClient, SAVE_ACTIVITY, { account: null, activity: activity("old", "2026-09-01") });
    queue(queryClient, DELETE_ACTIVITY, { account: null, id: "a" });

    expect(
      withPendingActivities(queryClient, [activity("a", "2026-11-01")], "2026-10-15").map(
        (one) => one.id,
      ),
    ).toEqual(["c"]);
  });
});
