import type { QueryClient } from "@tanstack/react-query";

import { isWrite, pendingWrites, QUEUED_KEY } from "@/features/offline/queue";
import type { Schemas } from "@/shared/api/client";

type Activity = Schemas["ActivityOut"];

export const SAVE_ACTIVITY = [...QUEUED_KEY, "activities", "save-activity"] as const;
export const DELETE_ACTIVITY = [...QUEUED_KEY, "activities", "delete-activity"] as const;

/** Activité en file : la ligne affichée, envoyée telle quelle (`PUT` idempotent, ADR 0003). */
export interface SaveActivityVariables {
  account: string | null;
  activity: Activity;
}

export interface DeleteActivityVariables {
  account: string | null;
  id: string;
}

/** Activités telles qu'elles seront une fois l'activité enregistrée (par date, ordre gardé). */
export function applySaveActivity(
  activities: Activity[],
  { activity }: SaveActivityVariables,
): Activity[] {
  const known = activities.some((one) => one.id === activity.id);
  const next = known
    ? activities.map((one) => (one.id === activity.id ? activity : one))
    : [...activities, activity];
  return next.toSorted((a, b) => a.date.localeCompare(b.date));
}

export function applyDeleteActivity(
  activities: Activity[],
  { id }: DeleteActivityVariables,
): Activity[] {
  return activities.filter((one) => one.id !== id);
}

/** Activités lues sur le serveur, avec celles encore en file réappliquées dans l'ordre. */
export function withPendingActivities(
  queryClient: QueryClient,
  activities: Activity[],
  start: string,
): Activity[] {
  return pendingWrites(queryClient).reduce((shown, { key, variables }) => {
    if (isWrite(key, SAVE_ACTIVITY)) {
      const save = variables as SaveActivityVariables;
      // Hors de la période affichée : l'activité n'y apparaît pas.
      return save.activity.date < start ? shown : applySaveActivity(shown, save);
    }
    if (isWrite(key, DELETE_ACTIVITY)) {
      return applyDeleteActivity(shown, variables as DeleteActivityVariables);
    }
    return shown;
  }, activities);
}
