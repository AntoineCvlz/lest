import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { useAccount } from "@/features/offline/account";
import {
  accountHeaders,
  assertStillQueued,
  isLastQueuedWrite,
  queuedWrite,
} from "@/features/offline/queue";
import { fetchClient, type Schemas } from "@/shared/api/client";
import { localDay } from "@/shared/lib/days";

import {
  applyDeleteEntry,
  applySaveEntry,
  applyWater,
  DELETE_ENTRY,
  entryFromFood,
  SAVE_ENTRY,
  SAVE_WATER,
  withGrams,
  withPendingJournal,
  type DeleteEntryVariables,
  type SaveEntryVariables,
  type SaveWaterVariables,
} from "./pending-journal";
import { NUTRITION_KEY } from "./query-keys";

export type Food = Schemas["FoodOut"];
export type Entry = Schemas["EntryOut"];
export type Meal = Entry["meal"];

export const JOURNAL_KEY = [...NUTRITION_KEY, "journal"] as const;
export const RECENT_KEY = [...NUTRITION_KEY, "recent"] as const;
const SEARCH_KEY = [...NUTRITION_KEY, "search"] as const;

export const MEALS: readonly { value: Meal; label: string }[] = [
  { value: "breakfast", label: "Petit-déjeuner" },
  { value: "lunch", label: "Déjeuner" },
  { value: "dinner", label: "Dîner" },
  { value: "snack", label: "Collation" },
];

/** Réponse inattendue de l'API : le message ne reprend aucune donnée saisie. */
export class NutritionRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Nutrition : réponse ${String(status)}`);
  }
}

/** Journal d'un jour : entrées, totaux et eau. */
export function useDayJournal(day: string) {
  return useQuery({
    queryKey: [...JOURNAL_KEY, day],
    queryFn: async ({ client }): Promise<Schemas["DayOut"]> => {
      const { data, response } = await fetchClient.GET("/api/v1/journal/{day}/", {
        params: { path: { day } },
      });
      if (!data) throw new NutritionRequestFailed(response.status);
      // Saisies faites hors ligne, pas encore envoyées : toujours affichées (ADR 0015).
      return withPendingJournal(client, data);
    },
    retry: false,
  });
}

/** Aliments saisis récemment : proposés avant toute recherche. */
export function useRecentFoods() {
  return useQuery({
    queryKey: RECENT_KEY,
    queryFn: async (): Promise<Food[]> => {
      const { data, response } = await fetchClient.GET("/api/v1/foods/recent/");
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}

/** Recherche locale (Ciqual, produits scannés, aliments perso), 2 caractères au moins. */
export function useFoodSearch(query: string) {
  return useQuery({
    queryKey: [...SEARCH_KEY, query],
    queryFn: async (): Promise<Food[]> => {
      const { data, response } = await fetchClient.GET("/api/v1/foods/", {
        params: { query: { q: query } },
      });
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Aliment d'un code-barres (Open Food Facts, ADR 0009) ; l'erreur porte le statut HTTP. */
export function useBarcodeLookup() {
  return useMutation({
    mutationFn: async (code: string): Promise<Food> => {
      const { data, response } = await fetchClient.GET("/api/v1/foods/barcode/{code}/", {
        params: { path: { code } },
      });
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
  });
}

export const ENTRY_REFUSED = "Aliment refusé par le serveur : il n’a pas été enregistré.";
export const ENTRY_DELETE_REFUSED = "Retrait refusé par le serveur : l’aliment est gardé.";
export const WATER_REFUSED = "Eau refusée par le serveur : le total n’a pas été enregistré.";

/**
 * Requêtes de nutrition gardées hors ligne (ADR 0015) : le journal du jour et les aliments
 * récents, pour ajouter un repas déjà connu en salle ou en déplacement.
 */
export function isKeptForNutrition(key: QueryKey): boolean {
  if (key[0] !== NUTRITION_KEY[0]) return false;
  return key[1] === RECENT_KEY[1] || (key[1] === JOURNAL_KEY[1] && key[2] === localDay());
}

/** Montre tout de suite une saisie dans le jour en cache. */
async function show(
  queryClient: QueryClient,
  day: string,
  change: (journal: Schemas["DayOut"]) => Schemas["DayOut"],
): Promise<void> {
  const key = [...JOURNAL_KEY, day];
  await queryClient.cancelQueries({ queryKey: key });
  queryClient.setQueryData<Schemas["DayOut"]>(key, (journal) => journal && change(journal));
}

/** Relit le journal une fois la file vide : valeurs du serveur, refus retirés de l'affichage. */
function refreshJournal(queryClient: QueryClient): void {
  if (!isLastQueuedWrite(queryClient)) return;
  void queryClient.invalidateQueries({ queryKey: NUTRITION_KEY });
  // Relus même sans écran qui les montre : c'est la liste proposée hors ligne (ADR 0015).
  void queryClient.refetchQueries({ queryKey: RECENT_KEY });
}

/**
 * Entrées du journal et eau en file d'attente (ADR 0015) : affichées tout de suite, envoyées
 * dans l'ordre de saisie (`PUT` et `DELETE` idempotents, ADR 0003 et 0010).
 */
export function registerNutritionWrites(queryClient: QueryClient): void {
  queryClient.setMutationDefaults<unknown, Error, SaveEntryVariables>(SAVE_ENTRY, {
    ...queuedWrite(ENTRY_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      const { account, entry } = variables;
      const { data, response } = await fetchClient.PUT("/api/v1/journal-entries/{entry_id}/", {
        params: { path: { entry_id: entry.id } },
        headers: accountHeaders(account),
        body: { date: entry.date, meal: entry.meal, food_id: entry.food_id, grams: entry.grams },
      });
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    onMutate: (variables) =>
      show(queryClient, variables.entry.date, (journal) => applySaveEntry(journal, variables)),
    onSettled: () => {
      refreshJournal(queryClient);
    },
  });
  queryClient.setMutationDefaults<undefined, Error, DeleteEntryVariables>(DELETE_ENTRY, {
    ...queuedWrite(ENTRY_DELETE_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      const { response } = await fetchClient.DELETE("/api/v1/journal-entries/{entry_id}/", {
        params: { path: { entry_id: variables.id } },
        headers: accountHeaders(variables.account),
      });
      if (!response.ok) throw new NutritionRequestFailed(response.status);
      return undefined;
    },
    onMutate: (variables) =>
      show(queryClient, variables.date, (journal) => applyDeleteEntry(journal, variables)),
    onSettled: () => {
      refreshJournal(queryClient);
    },
  });
  queryClient.setMutationDefaults<unknown, Error, SaveWaterVariables>(SAVE_WATER, {
    ...queuedWrite(WATER_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      const { data, response } = await fetchClient.PUT("/api/v1/water/{day}/", {
        params: { path: { day: variables.day } },
        headers: accountHeaders(variables.account),
        body: { ml: variables.ml },
      });
      if (!data) throw new NutritionRequestFailed(response.status);
      return data;
    },
    onMutate: (variables) =>
      show(queryClient, variables.day, (journal) => applyWater(journal, variables)),
    onSettled: () => {
      refreshJournal(queryClient);
    },
  });
}

/** Ajoute un aliment au journal (UUID du client, ADR 0003), en file d'attente. */
export function useAddEntry() {
  const account = useAccount();
  const mutation = useMutation<unknown, Error, SaveEntryVariables>({ mutationKey: SAVE_ENTRY });
  return {
    ...mutation,
    mutate: (food: Food, place: { date: string; meal: Meal; grams: number }) => {
      mutation.mutate({
        account,
        entry: entryFromFood(food, { id: crypto.randomUUID(), ...place }),
      });
    },
  };
}

/** Change la quantité d'une entrée (même identifiant : `PUT` idempotent), en file d'attente. */
export function useSaveEntry() {
  const account = useAccount();
  const mutation = useMutation<unknown, Error, SaveEntryVariables>({ mutationKey: SAVE_ENTRY });
  return {
    ...mutation,
    mutate: (entry: Entry, grams: number) => {
      mutation.mutate({ account, entry: withGrams(entry, grams) });
    },
  };
}

/** Retire une entrée (idempotent), en file d'attente. */
export function useDeleteEntry() {
  const account = useAccount();
  const mutation = useMutation<undefined, Error, DeleteEntryVariables>({
    mutationKey: DELETE_ENTRY,
  });
  return {
    ...mutation,
    mutate: (entry: Entry) => {
      mutation.mutate({ account, id: entry.id, date: entry.date });
    },
  };
}

/** Fixe le total d'eau du jour (idempotent), en file d'attente. */
export function useSaveWater() {
  const account = useAccount();
  const queryClient = useQueryClient();
  const mutation = useMutation<unknown, Error, SaveWaterVariables>({ mutationKey: SAVE_WATER });
  return {
    ...mutation,
    mutate: ({ day, ml }: { day: string; ml: number }) => {
      const variables = { account, day, ml };
      // Affiché dès l'appui, sans attendre `onMutate` : un second appui rapide part de ce total.
      queryClient.setQueryData<Schemas["DayOut"]>(
        [...JOURNAL_KEY, day],
        (journal) => journal && applyWater(journal, variables),
      );
      mutation.mutate(variables);
    },
  };
}
