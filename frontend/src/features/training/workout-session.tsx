"use client";

import { useState } from "react";

import type { Schemas } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";

import { ExerciseLibrary } from "./exercise-library";
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
  const exercises = workout.data?.exercises ?? [];
  const failed = add.isError || finish.isError;

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
              onSuccess: () => {
                setPicking(false);
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
      <p role="status" className="text-ink-muted empty:hidden">
        {workout.isPending ? "Chargement de la séance…" : ""}
      </p>
      <div role="alert" className="empty:hidden">
        {workout.isError && <Alert>{WORKOUT_UNAVAILABLE}</Alert>}
        {failed && <Alert>{NOT_SAVED}</Alert>}
      </div>
      {workout.isSuccess &&
        (exercises.length === 0 ? (
          <p>Ajoutez un premier exercice pour commencer.</p>
        ) : (
          <ol aria-label="Exercices de la séance" className="border-line-subtle border-t">
            {exercises.map((item) => (
              <li key={item.id} className="border-line-subtle flex flex-col gap-1 border-b py-3">
                <span className="text-[17px] font-bold" lang={item.exercise_name_language}>
                  {item.exercise_name}
                </span>
                <span className="text-ink-muted text-sm">{setCount(item.sets.length)}</span>
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

/** Séance du jour : la démarrer, y ajouter des exercices, la terminer. */
export function WorkoutSession() {
  const ongoing = useOngoingWorkout();
  const start = useStartWorkout();
  const [finished, setFinished] = useState(false);

  if (ongoing.isPending) {
    return (
      <p role="status" className="text-ink-muted">
        Recherche d’une séance en cours…
      </p>
    );
  }
  if (ongoing.isError) {
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
    </div>
  );
}
