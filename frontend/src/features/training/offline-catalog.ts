import type { InfiniteData, Query, QueryClient } from "@tanstack/react-query";

import type { Schemas } from "@/shared/api/client";

import type { ExerciseSearch } from "./use-exercises";

type Exercise = Schemas["ExerciseOut"];
type Page = Schemas["ExercisePageOut"];

const EXERCISES = "exercises";
/** Recherches gardées hors ligne : les plus récentes seulement, la copie reste de quelques Ko. */
export const KEPT_SEARCHES = 20;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Vrai si la requête est une recherche du catalogue d'exercices. */
export function isCatalogSearch(query: Query): boolean {
  return query.queryKey[0] === EXERCISES;
}

function searches(queryClient: QueryClient): Query[] {
  return queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => isCatalogSearch(query) && query.state.status === "success");
}

/** Vrai pour une des `KEPT_SEARCHES` recherches les plus récentes (copie hors ligne). */
export function isRecentSearch(queryClient: QueryClient, query: Query): boolean {
  return searches(queryClient)
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    .slice(0, KEPT_SEARCHES)
    .includes(query);
}

/** Exercices déjà reçus sur cet appareil, une fois chacun. */
export function seenExercises(queryClient: QueryClient): Exercise[] {
  const seen = new Map<string, Exercise>();
  for (const query of searches(queryClient)) {
    const data = query.state.data as InfiniteData<Page> | undefined;
    for (const page of data?.pages ?? []) {
      for (const exercise of page.items) seen.set(exercise.id, exercise);
    }
  }
  return [...seen.values()];
}

/**
 * Recherche hors ligne parmi les exercices déjà vus : chaque mot cherché figure dans le nom
 * (sans accents ni casse), filtres appliqués comme l'API, tri par nom.
 */
export function searchSeen(exercises: Exercise[], search: ExerciseSearch): Exercise[] {
  const words = normalize(search.q).split(/\s+/).filter(Boolean);
  return exercises
    .filter(
      (exercise) =>
        words.every((word) => normalize(exercise.name).includes(word)) &&
        (search.category === null || exercise.category === search.category) &&
        (search.muscle === null || exercise.muscles.some((one) => one.id === search.muscle)) &&
        (search.equipment === null ||
          exercise.equipment.some((one) => one.id === search.equipment)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
