"use client";

import { useState } from "react";

import { TextLink } from "@/features/auth/text-link";
import { PendingWrites } from "@/features/offline/pending-writes";
import { useProfile } from "@/features/profile/use-profile";
import type { Schemas } from "@/shared/api/client";
import { useWakeLock } from "@/shared/lib/use-wake-lock";
import { Button } from "@/shared/ui/button";

import { ExerciseImage } from "./exercise-image";
import { ExerciseLibrary } from "./exercise-library";
import { RestTimer } from "./rest-timer";
import { SetEntry } from "./set-entry";
import { usePrograms } from "./use-programs";
import { useRestTimer } from "./use-rest-timer";
import { WorkoutHistory } from "./workout-history";
import {
  useAddExercise,
  useFinishWorkout,
  useOngoingWorkout,
  useStartWorkout,
  useWorkout,
} from "./use-workout";

export const WORKOUT_UNAVAILABLE = "Séance indisponible. Réessayez dans un instant.";
export const NOT_SAVED = "Enregistrement impossible. Vérifiez la connexion et réessayez.";
export const FINISHED = "Séance terminée et enregistrée.";

const TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

function setCount(count: number): string {
  if (count === 0) return "Aucune série";
  return count === 1 ? "1 série" : `${String(count)} séries`;
}

function Alert({ children }: { children: string }) {
  return (
    <p className="rounded-control border-danger text-danger border p-4 font-semibold">{children}</p>
  );
}

function OngoingWorkout({
  ongoing,
  onFinished,
}: {
  ongoing: Schemas["WorkoutOut"];
  onFinished: () => void;
}) {
  const workout = useWorkout(ongoing.id);
  const add = useAddExercise(workout.data);
  const finish = useFinishWorkout();
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Exercice dont on saisit les séries (identifiant de l'exercice de séance).
  const [active, setActive] = useState<string | null>(null);
  const profile = useProfile();
  // Partagé par la liste et la saisie : le repos continue quand on change d'exercice.
  const timer = useRestTimer();
  // Écran allumé pendant toute la séance (CLAUDE.md, usage en salle).
  useWakeLock(true);
  const system = profile.data?.unit_system ?? "metric";
  const exercises = workout.data?.exercises ?? [];
  const failed = add.isError || finish.isError;
  const activeItem = exercises.find((item) => item.id === active);

  if (activeItem) {
    return (
      <SetEntry
        workoutId={ongoing.id}
        item={activeItem}
        system={system}
        timer={timer}
        onClose={() => {
          setActive(null);
        }}
      />
    );
  }

  if (picking) {
    return (
      <section aria-labelledby="ajout" className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <h2 id="ajout" className="text-xl font-bold">
            Ajouter un exercice
          </h2>
          <Button
            variant="ghost"
            onClick={() => {
              setPicking(false);
            }}
          >
            Annuler
          </Button>
        </div>
        <div role="alert" className="empty:hidden">
          {add.isError && <Alert>{NOT_SAVED}</Alert>}
        </div>
        <ExerciseLibrary
          selecting={add.isPending}
          onSelect={(exercise) => {
            add.mutate(exercise.id, {
              // Directement à la saisie de la première série de l'exercice ajouté.
              onSuccess: (added) => {
                setPicking(false);
                setActive(added.id);
              },
            });
          }}
        />
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-ink-muted">Commencée à {TIME.format(new Date(ongoing.started_at))}</p>
      <RestTimer timer={timer} />
      <p role="status" className="text-ink-muted empty:hidden">
        {workout.isPending ? "Chargement de la séance…" : ""}
      </p>
      <div role="alert" className="empty:hidden">
        {/* Hors ligne, la copie gardée reste affichée (ADR 0015). */}
        {workout.isError && !workout.data && <Alert>{WORKOUT_UNAVAILABLE}</Alert>}
        {failed && <Alert>{NOT_SAVED}</Alert>}
      </div>
      {workout.data &&
        (exercises.length === 0 ? (
          <p>Ajoutez un premier exercice pour commencer.</p>
        ) : (
          <ol aria-label="Exercices de la séance" className="border-line-subtle border-t">
            {exercises.map((item) => (
              <li key={item.id} className="border-line-subtle border-b">
                <button
                  type="button"
                  className="hover:bg-surface flex min-h-14 w-full items-center gap-3 px-1 py-3 text-left"
                  onClick={() => {
                    setActive(item.id);
                  }}
                >
                  <ExerciseImage
                    image={item.exercise_image}
                    category={item.exercise_category}
                    size="thumb"
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span
                      className="block text-[17px] font-bold"
                      lang={item.exercise_name_language}
                    >
                      {item.exercise_name}
                    </span>
                    <span className="text-ink-muted block text-sm">
                      {item.target_sets === null
                        ? setCount(item.sets.length)
                        : `${String(item.sets.filter((one) => !one.is_warmup).length)} sur ${String(item.target_sets)} séries, cible ${String(item.target_sets)} × ${String(item.target_reps)}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ))}
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!workout.isSuccess}
        onClick={() => {
          add.reset();
          setPicking(true);
        }}
      >
        Ajouter un exercice
      </Button>
      {confirming ? (
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Terminer la séance maintenant ?</p>
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => {
                setConfirming(false);
              }}
            >
              Continuer
            </Button>
            <Button
              disabled={finish.isPending}
              onClick={() => {
                finish.mutate(ongoing, { onSuccess: onFinished });
              }}
            >
              Terminer
            </Button>
          </div>
        </div>
      ) : (
        <Button
          block
          onClick={() => {
            setConfirming(true);
          }}
        >
          Terminer la séance
        </Button>
      )}
    </div>
  );
}

/** Un bouton par séance type des programmes : la séance démarre avec ses exercices. */
function ProgramStarts({
  pending,
  onStart,
}: {
  pending: boolean;
  onStart: (dayId: string) => void;
}) {
  const programs = usePrograms();
  const withDays = (programs.data ?? []).filter((program) => program.days.length > 0);

  return (
    <section aria-labelledby="depuis-un-programme" className="flex flex-col gap-3">
      <h2 id="depuis-un-programme" className="text-xl font-bold">
        Depuis un programme
      </h2>
      {programs.isSuccess && withDays.length === 0 && (
        <p className="text-ink-muted">
          Aucune séance type pour l’instant : créez un programme pour démarrer en un appui.
        </p>
      )}
      {withDays.map((program) => (
        <div key={program.id} className="flex flex-col gap-2">
          <p className="text-ink-muted text-sm">{program.name}</p>
          <div className="flex flex-wrap gap-2">
            {program.days.map((day) => (
              <Button
                key={day.id}
                disabled={pending}
                aria-label={`Démarrer ${day.name} (${program.name})`}
                onClick={() => {
                  onStart(day.id);
                }}
              >
                {day.name}
              </Button>
            ))}
          </div>
        </div>
      ))}
      <TextLink href="/seance/programmes" className="self-start">
        Mes programmes
      </TextLink>
      <TextLink href="/seance/activites" className="self-start">
        Autres sports : course, vélo, natation…
      </TextLink>
      <TextLink href="/exercices" className="self-start">
        Catalogue des exercices
      </TextLink>
    </section>
  );
}

/** Séance du jour : la démarrer, y ajouter des exercices, la terminer. */
export function WorkoutSession() {
  return (
    <>
      <PendingWrites />
      <SessionScreen />
    </>
  );
}

function SessionScreen() {
  const ongoing = useOngoingWorkout();
  const profile = useProfile();
  const start = useStartWorkout();
  const [finished, setFinished] = useState(false);

  if (ongoing.isPending) {
    return (
      <p role="status" className="text-ink-muted">
        Recherche d’une séance en cours…
      </p>
    );
  }
  if (ongoing.isError && ongoing.data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <div role="alert">
          <Alert>{WORKOUT_UNAVAILABLE}</Alert>
        </div>
        <Button
          onClick={() => {
            void ongoing.refetch();
          }}
        >
          Réessayer
        </Button>
      </div>
    );
  }
  if (ongoing.data) {
    return (
      <OngoingWorkout
        ongoing={ongoing.data}
        onFinished={() => {
          setFinished(true);
        }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="empty:hidden">
        {finished ? FINISHED : ""}
      </p>
      <p className="text-ink-muted">Aucune séance en cours.</p>
      <div role="alert" className="empty:hidden">
        {start.isError && <Alert>{NOT_SAVED}</Alert>}
      </div>
      <Button
        variant="primary"
        size="lg"
        block
        disabled={start.isPending}
        onClick={() => {
          setFinished(false);
          start.mutate();
        }}
      >
        Démarrer une séance
      </Button>
      <ProgramStarts
        pending={start.isPending}
        onStart={(dayId) => {
          setFinished(false);
          start.mutate(dayId);
        }}
      />
      <WorkoutHistory system={profile.data?.unit_system ?? "metric"} />
    </div>
  );
}
