"use client";

import Link from "next/link";

import type { Schemas } from "@/shared/api/client";
import type { UnitSystem } from "@/shared/lib/units";
import { Button } from "@/shared/ui/button";

import { durationText, weightText } from "./format";
import { useWorkoutHistory } from "./use-workout";

export const HISTORY_UNAVAILABLE = "Historique indisponible. Réessayez dans un instant.";
export const NO_HISTORY = "Aucune séance terminée pour l’instant.";

export const WORKOUT_DAY = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count > 1 ? many : one}`;
}

/** Résumé d'une séance : « 3 exercices, 12 séries, 4 250 kg ». */
export function summaryText(workout: Schemas["WorkoutSummaryOut"], system: UnitSystem): string {
  return [
    plural(workout.exercise_count, "exercice", "exercices"),
    plural(workout.working_set_count, "série", "séries"),
    weightText(workout.volume_kg, system),
  ].join(", ");
}

/** Séances terminées, les plus récentes d'abord ; chacune mène à son détail. */
export function WorkoutHistory({ system }: { system: UnitSystem }) {
  const history = useWorkoutHistory();
  const workouts = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section aria-labelledby="historique" className="flex flex-col gap-4">
      <h2 id="historique" className="text-xl font-bold">
        Séances passées
      </h2>
      {history.isPending && <p className="text-ink-muted">Chargement de l’historique…</p>}
      {history.isError && (
        <p
          role="alert"
          className="rounded-control border-danger text-danger border p-4 font-semibold"
        >
          {HISTORY_UNAVAILABLE}
        </p>
      )}
      {history.isSuccess && workouts.length === 0 && <p className="text-ink-muted">{NO_HISTORY}</p>}
      {workouts.length > 0 && (
        <ol aria-labelledby="historique" className="border-line-subtle border-t">
          {workouts.map((workout) => (
            <li key={workout.id} className="border-line-subtle border-b">
              <Link
                href={`/seance/${workout.id}`}
                className="hover:bg-surface flex min-h-14 flex-col gap-1 px-1 py-3"
              >
                <span className="font-bold first-letter:uppercase">
                  {WORKOUT_DAY.format(new Date(workout.started_at))}
                </span>
                <span className="text-ink-muted text-sm [font-variant-numeric:tabular-nums]">
                  {[
                    workout.ended_at && durationText(workout.started_at, workout.ended_at),
                    summaryText(workout, system),
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {history.hasNextPage && (
        <Button
          onClick={() => {
            void history.fetchNextPage();
          }}
          disabled={history.isFetchingNextPage}
        >
          {history.isFetchingNextPage ? "Chargement…" : "Afficher plus de séances"}
        </Button>
      )}
    </section>
  );
}
