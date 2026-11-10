import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";

import { useAccount } from "@/features/offline/account";
import {
  accountHeaders,
  assertStillQueued,
  isLastQueuedWrite,
  queuedWrite,
} from "@/features/offline/queue";
import { fetchClient, type Schemas } from "@/shared/api/client";
import { localDay, shiftDay } from "@/shared/lib/days";

import {
  applyDeleteActivity,
  applySaveActivity,
  DELETE_ACTIVITY,
  SAVE_ACTIVITY,
  withPendingActivities,
  type DeleteActivityVariables,
  type SaveActivityVariables,
} from "./pending-activities";
import { ACTIVITIES_KEY } from "./query-keys";

export type Sport = Schemas["SportOut"];
export type SportKey = Sport["key"];
export type Activity = Schemas["ActivityOut"];
export type ActivityIn = Schemas["ActivityIn"];

/** Activités montrées : les 30 derniers jours, aujourd'hui compris. */
export const JOURNAL_DAYS = 30;

/** Catalogue public des sports : gardé hors ligne, sans lui le formulaire ne s'affiche pas. */
export const SPORTS_KEY = ["sports"] as const;
const JOURNAL_KEY = [...ACTIVITIES_KEY, JOURNAL_DAYS] as const;

export const ACTIVITY_REFUSED = "Activité refusée par le serveur : elle n’a pas été enregistrée.";
export const ACTIVITY_DELETE_REFUSED =
  "Suppression refusée par le serveur : l’activité est gardée.";

/** Réponse inattendue de l'API : le message ne reprend aucune donnée saisie. */
export class ActivityRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Activités : réponse ${String(status)}`);
  }
}

/** Catalogue des sports (ADR 0012) : fixe, versionné avec l'API. */
export function useSports() {
  return useQuery({
    queryKey: SPORTS_KEY,
    queryFn: async (): Promise<Sport[]> => {
      const { data, response } = await fetchClient.GET("/api/v1/sports/");
      if (!data) throw new ActivityRequestFailed(response.status);
      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

function journalStart(): string {
  return shiftDay(localDay(), -(JOURNAL_DAYS - 1));
}

/** Activités des `JOURNAL_DAYS` derniers jours, par date puis ordre de saisie. */
export function useActivities() {
  return useQuery({
    queryKey: JOURNAL_KEY,
    queryFn: async ({ client }): Promise<Activity[]> => {
      const start = journalStart();
      const { data, response } = await fetchClient.GET("/api/v1/activities/", {
        params: { query: { start, end: localDay() } },
      });
      if (!data) throw new ActivityRequestFailed(response.status);
      // Activités saisies hors ligne, pas encore envoyées : toujours affichées (ADR 0015).
      return withPendingActivities(client, data, start);
    },
    retry: false,
  });
}

async function show(
  queryClient: QueryClient,
  change: (activities: Activity[]) => Activity[],
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: JOURNAL_KEY });
  queryClient.setQueryData<Activity[]>(
    JOURNAL_KEY,
    (activities) => activities && change(activities),
  );
}

/** Relit les activités une fois la file vide : l'état du serveur fait foi. */
function refreshActivities(queryClient: QueryClient): void {
  if (isLastQueuedWrite(queryClient)) {
    void queryClient.invalidateQueries({ queryKey: ACTIVITIES_KEY });
  }
}

/**
 * Activités enregistrées et supprimées en file d'attente (ADR 0015) : affichées tout de suite,
 * envoyées dans l'ordre de saisie (`PUT` et `DELETE` idempotents, ADR 0003).
 */
export function registerActivityWrites(queryClient: QueryClient): void {
  queryClient.setMutationDefaults<unknown, Error, SaveActivityVariables>(SAVE_ACTIVITY, {
    ...queuedWrite(ACTIVITY_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      const { id, ...body } = variables.activity;
      const { data, response } = await fetchClient.PUT("/api/v1/activities/{activity_id}/", {
        params: { path: { activity_id: id } },
        headers: accountHeaders(variables.account),
        body,
      });
      if (!data) throw new ActivityRequestFailed(response.status);
      return data;
    },
    onMutate: (variables) =>
      show(queryClient, (activities) =>
        variables.activity.date < journalStart()
          ? activities
          : applySaveActivity(activities, variables),
      ),
    onSettled: () => {
      refreshActivities(queryClient);
    },
  });
  queryClient.setMutationDefaults<undefined, Error, DeleteActivityVariables>(DELETE_ACTIVITY, {
    ...queuedWrite(ACTIVITY_DELETE_REFUSED),
    mutationFn: async (variables) => {
      assertStillQueued(queryClient, variables);
      const { response } = await fetchClient.DELETE("/api/v1/activities/{activity_id}/", {
        params: { path: { activity_id: variables.id } },
        headers: accountHeaders(variables.account),
      });
      if (!response.ok) throw new ActivityRequestFailed(response.status);
      return undefined;
    },
    onMutate: (variables) =>
      show(queryClient, (activities) => applyDeleteActivity(activities, variables)),
    onSettled: () => {
      refreshActivities(queryClient);
    },
  });
}

/** Crée ou remplace une activité sous l'UUID du client, en file d'attente. */
export function useSaveActivity() {
  const account = useAccount();
  const mutation = useMutation<unknown, Error, SaveActivityVariables>({
    mutationKey: SAVE_ACTIVITY,
  });
  return {
    ...mutation,
    mutate: ({ id, body }: { id: string; body: ActivityIn & { distance_m: number | null } }) => {
      const activity: Activity = {
        id,
        date: body.date,
        sport: body.sport,
        duration_s: body.duration_s,
        distance_m: body.distance_m,
        avg_heart_rate: body.avg_heart_rate ?? null,
        feeling: body.feeling ?? null,
        metrics: body.metrics ?? {},
      };
      mutation.mutate({ account, activity });
    },
  };
}

/** Supprime une activité (idempotent), en file d'attente. */
export function useDeleteActivity() {
  const account = useAccount();
  const mutation = useMutation<undefined, Error, DeleteActivityVariables>({
    mutationKey: DELETE_ACTIVITY,
  });
  return {
    ...mutation,
    mutate: (id: string) => {
      mutation.mutate({ account, id });
    },
  };
}
