import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import type { Category } from "./categories";
import { searchSeen, seenExercises } from "./offline-catalog";

export interface ExerciseSearch {
  q: string;
  category: Category | null;
  muscle: number | null;
  equipment: number | null;
}

export const EXERCISES_QUERY_KEY = ["exercises"] as const;
export const EXERCISE_FILTERS_KEY = ["exercise-filters"] as const;
const PAGE_SIZE = 30;
// Catalogue commun, importé une fois par mois : inutile de le relire à chaque visite.
const CATALOG_STALE_MS = 60 * 60 * 1000;

/**
 * Recherche dans le catalogue, page par page (curseur de l'API). Sans réseau, `offline` donne
 * les exercices déjà vus sur cet appareil qui correspondent (ADR 0015), sinon `null`.
 */
export function useExercises(search: ExerciseSearch) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: [...EXERCISES_QUERY_KEY, search],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<Schemas["ExercisePageOut"]> => {
      const { data, response } = await fetchClient.GET("/api/v1/exercises/", {
        params: {
          query: {
            q: search.q,
            category: search.category,
            muscle: search.muscle,
            equipment: search.equipment,
            cursor: pageParam,
            limit: PAGE_SIZE,
          },
        },
        signal,
      });
      if (!data) throw new Error(`Catalogue indisponible (${String(response.status)})`);
      return data;
    },
    getNextPageParam: (page) => page.next_cursor,
    // Résultats précédents gardés pendant la recherche suivante : pas de liste qui clignote.
    placeholderData: keepPreviousData,
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
  // En attente du réseau (navigateur hors ligne) ou réseau coupé pendant l'appel.
  const waiting = query.fetchStatus === "paused" && (!query.data || query.isPlaceholderData);
  const cut = query.isError && query.error instanceof TypeError;
  const offline = waiting || cut ? searchSeen(seenExercises(queryClient), search) : null;
  return { ...query, offline };
}

/** Valeurs proposées par les filtres (muscles et équipements utilisés). */
export function useExerciseFilters() {
  return useQuery({
    queryKey: EXERCISE_FILTERS_KEY,
    queryFn: async (): Promise<Schemas["ExerciseFiltersOut"]> => {
      const { data, response } = await fetchClient.GET("/api/v1/exercise-filters/");
      if (!data) throw new Error(`Filtres indisponibles (${String(response.status)})`);
      return data;
    },
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
}
