import { QueryClient } from "@tanstack/react-query";

import type { Schemas } from "@/shared/api/client";

import { isRecentSearch, KEPT_SEARCHES, searchSeen, seenExercises } from "./offline-catalog";
import type { ExerciseSearch } from "./use-exercises";

function exercise(id: string, name: string, overrides: Partial<Schemas["ExerciseOut"]> = {}) {
  return {
    id,
    name,
    name_language: "fr" as const,
    category: "chest" as const,
    muscles: [{ id: 4, name: "Pectoralis major" }],
    equipment: [{ id: 1, name: "Barre" }],
    image: null,
    ...overrides,
  };
}

const bench = exercise("a", "Développé couché");
const incline = exercise("b", "Développé incliné", { equipment: [{ id: 2, name: "Haltères" }] });
const squat = exercise("c", "Squat", { category: "legs", muscles: [] });

const all: ExerciseSearch = { q: "", category: null, muscle: null, equipment: null };

function cacheSearch(queryClient: QueryClient, q: string, items: object[]): void {
  queryClient.setQueryData(["exercises", { ...all, q }], {
    pages: [{ items, next_cursor: null }],
    pageParams: [null],
  });
}

describe("searchSeen", () => {
  it("cherche chaque mot dans le nom, sans accents ni casse, et applique les filtres", () => {
    const seen = [squat, incline, bench];

    expect(searchSeen(seen, { ...all, q: "DEVELOPPE" })).toEqual([bench, incline]);
    expect(searchSeen(seen, { ...all, q: "dév couché" })).toEqual([bench]);
    expect(searchSeen(seen, { ...all, category: "legs" })).toEqual([squat]);
    expect(searchSeen(seen, { ...all, muscle: 4 })).toEqual([bench, incline]);
    expect(searchSeen(seen, { ...all, equipment: 2 })).toEqual([incline]);
  });
});

describe("seenExercises", () => {
  it("réunit une fois chacun les exercices des recherches en cache", () => {
    const queryClient = new QueryClient();
    cacheSearch(queryClient, "", [bench, squat]);
    cacheSearch(queryClient, "dev", [bench, incline]);
    queryClient.setQueryData(["profile"], { unit_system: "metric" });

    expect(
      seenExercises(queryClient)
        .map((one) => one.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("isRecentSearch", () => {
  it("ne garde que les recherches les plus récentes", () => {
    vi.useFakeTimers();
    try {
      const queryClient = new QueryClient();
      for (let index = 0; index <= KEPT_SEARCHES; index += 1) {
        vi.setSystemTime(index * 1000);
        cacheSearch(queryClient, `recherche ${String(index)}`, [bench]);
      }
      const oldest = queryClient
        .getQueryCache()
        .find({ queryKey: ["exercises", { ...all, q: "recherche 0" }] });
      const newest = queryClient
        .getQueryCache()
        .find({ queryKey: ["exercises", { ...all, q: `recherche ${String(KEPT_SEARCHES)}` }] });

      expect(oldest && isRecentSearch(queryClient, oldest)).toBe(false);
      expect(newest && isRecentSearch(queryClient, newest)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
