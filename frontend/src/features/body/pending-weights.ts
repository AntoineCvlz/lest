import type { QueryClient } from "@tanstack/react-query";

import { isWrite, pendingWrites, QUEUED_KEY } from "@/features/offline/queue";
import type { Schemas } from "@/shared/api/client";

type Point = Schemas["WeightPointOut"];

export const SAVE_WEIGHT = [...QUEUED_KEY, "body", "save-weight"] as const;
export const DELETE_WEIGHT = [...QUEUED_KEY, "body", "delete-weight"] as const;

/** Pesée en file : tout est fixé à la saisie, l'envoi peut avoir lieu bien plus tard. */
export interface SaveWeightVariables {
  account: string | null;
  day: string;
  kilograms: number;
}

export interface DeleteWeightVariables {
  account: string | null;
  day: string;
}

/**
 * Pesées telles qu'elles seront une fois la pesée enregistrée. La moyenne sur 7 jours reste
 * celle connue (ou le poids saisi) : l'API la recalcule, et la relit à l'envoi.
 */
export function applySaveWeight(points: Point[], { day, kilograms }: SaveWeightVariables): Point[] {
  const existing = points.find((point) => point.date === day);
  const shown: Point = {
    date: day,
    weight_kg: kilograms,
    source: "manual",
    trend_kg: existing?.trend_kg ?? kilograms,
  };
  return [...points.filter((point) => point.date !== day), shown].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export function applyDeleteWeight(points: Point[], { day }: DeleteWeightVariables): Point[] {
  return points.filter((point) => point.date !== day);
}

/** Pesées lues sur le serveur, avec celles encore en file réappliquées dans l'ordre de saisie. */
export function withPendingWeights(queryClient: QueryClient, points: Point[], start: string) {
  return pendingWrites(queryClient).reduce((shown, { key, variables }) => {
    // Hors de la période affichée (`day < start`) : la pesée n'y apparaît pas.
    if (isWrite(key, SAVE_WEIGHT)) {
      const save = variables as SaveWeightVariables;
      return save.day < start ? shown : applySaveWeight(shown, save);
    }
    if (isWrite(key, DELETE_WEIGHT)) {
      const remove = variables as DeleteWeightVariables;
      return remove.day < start ? shown : applyDeleteWeight(shown, remove);
    }
    return shown;
  }, points);
}
