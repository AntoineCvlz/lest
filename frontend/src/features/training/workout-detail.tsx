"use client";

import Link from "next/link";

import { TextLink } from "@/features/auth/text-link";
import { useProfile } from "@/features/profile/use-profile";

import { durationText, recordsLine, setLine, weightText } from "./format";
import { useWorkout } from "./use-workout";
import { WORKOUT_DAY } from "./workout-history";

export const WORKOUT_NOT_FOUND = "Séance introuvable.";

/** Détail d'une séance passée, en lecture : exercices, séries, records établis. */
export function WorkoutDetail({ id }: { id: string }) {
  const workout = useWorkout(id);
  const profile = useProfile();
  const system = profile.data?.unit_system ?? "metric";

  if (workout.isPending) {
    return (
      <p role="status" className="text-ink-muted">
        Chargement de la séance…
      </p>
    );
  }
  if (workout.isError) {
    // 404 (inconnue ou d'un autre compte) comme panne : rien à afficher de plus.
    return (
      <div className="flex flex-col gap-4">
        <p
          role="alert"
          className="rounded-control border-danger text-danger border p-4 font-semibold"
        >
          {WORKOUT_NOT_FOUND}
        </p>
        <TextLink href="/seance">Revenir aux séances</TextLink>
      </div>
    );
  }

  const detail = workout.data;
  return (
    <article aria-labelledby="seance" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1
          id="seance"
          className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%] first-letter:uppercase"
        >
          {WORKOUT_DAY.format(new Date(detail.started_at))}
        </h1>
        <p className="text-ink-muted [font-variant-numeric:tabular-nums]">
          {[
            detail.ended_at ? durationText(detail.started_at, detail.ended_at) : "En cours",
            `volume ${weightText(detail.volume_kg, system)}`,
          ].join(", ")}
        </p>
      </div>
      {detail.exercises.length === 0 && <p>Aucun exercice dans cette séance.</p>}
      {detail.exercises.map((item) => (
        <section
          key={item.id}
          aria-labelledby={`exercice-${item.id}`}
          className="flex flex-col gap-2"
        >
          <h2
            id={`exercice-${item.id}`}
            className="text-xl font-bold"
            lang={item.exercise_name_language}
          >
            <Link href={`/exercices/${item.exercise_id}`} className="underline underline-offset-4">
              {item.exercise_name}
            </Link>
          </h2>
          {item.sets.length === 0 ? (
            <p className="text-ink-muted">Aucune série.</p>
          ) : (
            <ol className="border-line-subtle border-t">
              {item.sets.map((one, index) => (
                <li key={one.id} className="border-line-subtle flex flex-col gap-1 border-b py-2">
                  <span className="[font-variant-numeric:tabular-nums]">
                    {setLine(one, index + 1, system)}
                  </span>
                  {one.records.length > 0 && (
                    <span className="text-accent-ink text-sm font-bold">{recordsLine(one)}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </article>
  );
}
