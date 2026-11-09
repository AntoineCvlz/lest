import { QueryClient, type MutationState } from "@tanstack/react-query";

import {
  applyDeleteWeight,
  applySaveWeight,
  DELETE_WEIGHT,
  SAVE_WEIGHT,
  withPendingWeights,
} from "./pending-weights";

const point = (date: string, weight: number, trend = weight) => ({
  date,
  weight_kg: weight,
  trend_kg: trend,
  source: "manual" as const,
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

describe("applySaveWeight", () => {
  it("remplace la pesée du jour en gardant sa moyenne, ou l'insère à sa place", () => {
    const points = [point("2026-11-01", 80), point("2026-11-03", 81, 80.5)];

    expect(applySaveWeight(points, { account: null, day: "2026-11-03", kilograms: 82 })).toEqual([
      point("2026-11-01", 80),
      { ...point("2026-11-03", 82), trend_kg: 80.5 },
    ]);
    expect(
      applySaveWeight(points, { account: null, day: "2026-11-02", kilograms: 79 }).map(
        (one) => one.date,
      ),
    ).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
  });
});

describe("withPendingWeights", () => {
  it("réapplique dans l'ordre les pesées en file de la période affichée", () => {
    const queryClient = new QueryClient();
    queue(queryClient, SAVE_WEIGHT, { account: null, day: "2026-11-02", kilograms: 79 });
    queue(queryClient, DELETE_WEIGHT, { account: null, day: "2026-11-01" });
    queue(queryClient, SAVE_WEIGHT, { account: null, day: "2026-10-01", kilograms: 90 });

    expect(withPendingWeights(queryClient, [point("2026-11-01", 80)], "2026-10-15")).toEqual([
      point("2026-11-02", 79),
    ]);
  });

  it("ne touche pas aux pesées sans saisie en file", () => {
    const points = [point("2026-11-01", 80)];

    expect(withPendingWeights(new QueryClient(), points, "2026-10-15")).toBe(points);
    expect(applyDeleteWeight(points, { account: null, day: "2026-11-02" })).toEqual(points);
  });
});
