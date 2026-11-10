import type { QueryClient } from "@tanstack/react-query";

import { isWrite, pendingWrites, QUEUED_KEY } from "@/features/offline/queue";
import type { Schemas } from "@/shared/api/client";

import type { Site } from "./sites";

type Row = Schemas["MeasurementOut"];

export const SAVE_MEASUREMENT = [...QUEUED_KEY, "body", "save-measurement"] as const;

/** Une mesure en file : nouvelle longueur en mètres, ou `null` pour la retirer. */
export interface SaveMeasurementVariables {
  account: string | null;
  day: string;
  site: Site;
  metres: number | null;
}

/** Mensurations telles qu'elles seront une fois la mesure enregistrée ou retirée. */
export function applyMeasurement(
  rows: Row[],
  { day, site, metres }: SaveMeasurementVariables,
): Row[] {
  const others = rows.filter((row) => row.date !== day || row.site !== site);
  if (metres === null) return others;
  return [...others, { date: day, site, length_m: metres }].sort(
    (a, b) => a.date.localeCompare(b.date) || a.site.localeCompare(b.site),
  );
}

/** Mensurations lues sur le serveur, avec celles encore en file réappliquées dans l'ordre. */
export function withPendingMeasurements(queryClient: QueryClient, rows: Row[]): Row[] {
  return pendingWrites(queryClient).reduce(
    (shown, { key, variables }) =>
      isWrite(key, SAVE_MEASUREMENT)
        ? applyMeasurement(shown, variables as SaveMeasurementVariables)
        : shown,
    rows,
  );
}
