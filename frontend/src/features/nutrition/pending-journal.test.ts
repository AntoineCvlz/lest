import { QueryClient, type MutationState } from "@tanstack/react-query";

import {
  applyDeleteEntry,
  applySaveEntry,
  DELETE_ENTRY,
  entryFromFood,
  SAVE_ENTRY,
  SAVE_WATER,
  withGrams,
  withPendingJournal,
} from "./pending-journal";

const DAY = "2026-11-10";

const rice = {
  id: "f1",
  name: "Riz blanc, cuit",
  brand: "",
  kcal_100g: 130,
  protein_100g: 2.7,
  carbs_100g: 28,
  fat_100g: null,
  serving_g: null,
  is_custom: false,
  source: "ciqual",
  source_url: null,
};

function journal(entries = [] as ReturnType<typeof entryFromFood>[]) {
  return {
    date: DAY,
    entries,
    totals: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    water_ml: 500,
  };
}

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

describe("entryFromFood", () => {
  it("calcule les valeurs de la quantité, un nutriment inconnu compté à zéro", () => {
    const entry = entryFromFood(rice, { id: "e1", date: DAY, meal: "lunch", grams: 200 });

    expect(entry).toMatchObject({ kcal: 260, protein: 5.4, carbs: 56, fat: 0, name: rice.name });
    expect(withGrams(entry, 100)).toMatchObject({ grams: 100, kcal: 130, carbs: 28 });
  });
});

describe("applySaveEntry", () => {
  it("ajoute ou remplace l'entrée et recalcule les totaux du jour", () => {
    const first = entryFromFood(rice, { id: "e1", date: DAY, meal: "lunch", grams: 100 });
    const added = applySaveEntry(journal(), { account: null, entry: first });

    expect(added.totals.kcal).toBe(130);
    const changed = applySaveEntry(added, { account: null, entry: withGrams(first, 200) });
    expect(changed.entries).toHaveLength(1);
    expect(changed.totals.kcal).toBe(260);
    expect(applyDeleteEntry(changed, { account: null, id: "e1", date: DAY }).totals.kcal).toBe(0);
  });

  it("ne touche pas à un autre jour", () => {
    const other = entryFromFood(rice, { id: "e2", date: "2026-11-09", meal: "lunch", grams: 100 });

    expect(applySaveEntry(journal(), { account: null, entry: other }).entries).toEqual([]);
  });
});

describe("withPendingJournal", () => {
  it("réapplique dans l'ordre les entrées et l'eau en file", () => {
    const queryClient = new QueryClient();
    const entry = entryFromFood(rice, { id: "e1", date: DAY, meal: "lunch", grams: 100 });
    queue(queryClient, SAVE_ENTRY, { account: null, entry });
    queue(queryClient, SAVE_WATER, { account: null, day: DAY, ml: 750 });
    queue(queryClient, SAVE_WATER, { account: null, day: DAY, ml: 1000 });
    queue(queryClient, DELETE_ENTRY, { account: null, id: "e1", date: DAY });

    expect(withPendingJournal(queryClient, journal())).toMatchObject({
      entries: [],
      water_ml: 1000,
    });
  });
});
