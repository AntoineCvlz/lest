import { QueryClient, type MutationState } from "@tanstack/react-query";

import {
  applyMeasurement,
  SAVE_MEASUREMENT,
  withPendingMeasurements,
} from "./pending-measurements";

const row = (date: string, site: "neck" | "waist", length_m: number) => ({ date, site, length_m });

function queue(queryClient: QueryClient, variables: unknown) {
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
  queryClient.getMutationCache().build(queryClient, { mutationKey: [...SAVE_MEASUREMENT] }, state);
}

describe("applyMeasurement", () => {
  it("remplace ou insère la mesure d'un endroit et d'un jour, ou la retire", () => {
    const rows = [row("2026-11-01", "neck", 0.39), row("2026-11-01", "waist", 0.82)];

    expect(
      applyMeasurement(rows, { account: null, day: "2026-11-01", site: "neck", metres: 0.4 }),
    ).toEqual([row("2026-11-01", "neck", 0.4), row("2026-11-01", "waist", 0.82)]);
    expect(
      applyMeasurement(rows, { account: null, day: "2026-11-01", site: "waist", metres: null }),
    ).toEqual([row("2026-11-01", "neck", 0.39)]);
  });
});

describe("withPendingMeasurements", () => {
  it("réapplique dans l'ordre les mesures en file", () => {
    const queryClient = new QueryClient();
    queue(queryClient, { account: null, day: "2026-11-02", site: "neck", metres: 0.41 });
    queue(queryClient, { account: null, day: "2026-11-02", site: "neck", metres: 0.42 });

    expect(withPendingMeasurements(queryClient, [row("2026-11-01", "neck", 0.39)])).toEqual([
      row("2026-11-01", "neck", 0.39),
      row("2026-11-02", "neck", 0.42),
    ]);
  });
});
