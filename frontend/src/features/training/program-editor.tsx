"use client";

import { useRouter } from "next/navigation";
import { useState, type SyntheticEvent } from "react";

import { TextLink } from "@/features/auth/text-link";
import type { Schemas } from "@/shared/api/client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { Stepper } from "@/shared/ui/stepper";
import { TextField } from "@/shared/ui/text-field";

import { ExerciseImage } from "./exercise-image";
import { ExerciseLibrary } from "./exercise-library";
import { PROGRAM_NOT_SAVED, PROGRAMS_UNAVAILABLE } from "./program-list";
import {
  nextPosition,
  useDeleteDay,
  useDeletePlannedExercise,
  useDeleteProgram,
  useProgram,
  useSaveDay,
  useSavePlannedExercise,
  useSaveProgram,
} from "./use-programs";

type Day = Schemas["ProgramDayDetailOut"];
type Planned = Schemas["ProgramExerciseDetailOut"];

export const PROGRAM_NOT_FOUND = "Programme introuvable.";
// Cible proposée à l'ajout d'un exercice, modifiable ensuite.
const DEFAULT_TARGET = { sets: 3, reps: 10 } as const;
const MAX_TARGET_SETS = 20;
const MAX_TARGET_REPS = 100;

function Alert({ children }: { children: string }) {
  return (
    <p className="rounded-control border-danger text-danger border p-4 font-semibold">{children}</p>
  );
}

/** Champ de nom avec son bouton, pour créer ou renommer (programme, séance type). */
function NameForm({
  label,
  submitLabel,
  initial = "",
  pending,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial?: string;
  pending: boolean;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}) {
  const hydrated = useHydrated();
  const [name, setName] = useState(initial);

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <form method="post" noValidate className="flex flex-col gap-3" onSubmit={submit}>
      <TextField
        label={label}
        maxLength={80}
        autoComplete="off"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={!hydrated || pending || name.trim() === ""}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}

function TargetEditor({ planned, onDone }: { planned: Planned; onDone: () => void }) {
  const save = useSavePlannedExercise();
  const remove = useDeletePlannedExercise();
  const [sets, setSets] = useState(planned.target_sets);
  const [reps, setReps] = useState(planned.target_reps);

  return (
    <div className="flex flex-col gap-4 py-3">
      <Stepper
        label="Séries"
        value={sets}
        onChange={setSets}
        step={1}
        min={1}
        max={MAX_TARGET_SETS}
        stepUnit="série"
        size="md"
      />
      <Stepper
        label="Répétitions"
        value={reps}
        onChange={setReps}
        step={1}
        min={1}
        max={MAX_TARGET_REPS}
        stepUnit="répétition"
        size="md"
      />
      <div role="alert" className="empty:hidden">
        {(save.isError || remove.isError) && <Alert>{PROGRAM_NOT_SAVED}</Alert>}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={save.isPending}
          onClick={() => {
            save.mutate(
              {
                id: planned.id,
                dayId: planned.day_id,
                exerciseId: planned.exercise_id,
                position: planned.position,
                targetSets: sets,
                targetReps: reps,
              },
              { onSuccess: onDone },
            );
          }}
        >
          Enregistrer la cible
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate(planned.id, { onSuccess: onDone });
          }}
        >
          Retirer l’exercice
        </Button>
      </div>
    </div>
  );
}

function DayEditor({ day }: { day: Day }) {
  const add = useSavePlannedExercise();
  const rename = useSaveDay();
  const remove = useDeleteDay();
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const headingId = `seance-type-${day.id}`;

  return (
    <section
      aria-labelledby={headingId}
      className="border-line-subtle flex flex-col gap-4 border-t pt-6"
    >
      {renaming ? (
        <NameForm
          label="Nom de la séance type"
          submitLabel="Renommer"
          initial={day.name}
          pending={rename.isPending}
          onSubmit={(name) => {
            rename.mutate(
              { id: day.id, programId: day.program_id, name, position: day.position },
              {
                onSuccess: () => {
                  setRenaming(false);
                },
              },
            );
          }}
          onCancel={() => {
            setRenaming(false);
          }}
        />
      ) : (
        <h2 id={headingId} className="text-xl font-bold">
          {day.name}
        </h2>
      )}
      {day.exercises.length === 0 && (
        <p className="text-ink-muted">Aucun exercice : ajoutez le premier.</p>
      )}
      {day.exercises.length > 0 && (
        <ol aria-labelledby={headingId} className="border-line-subtle border-t">
          {day.exercises.map((planned) => (
            <li key={planned.id} className="border-line-subtle border-b">
              <div className="flex items-center gap-3 py-2">
                <ExerciseImage
                  image={planned.exercise_image}
                  category={planned.exercise_category}
                  size="thumb"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-bold" lang={planned.exercise_name_language}>
                    {planned.exercise_name}
                  </span>
                  <span className="text-ink-muted text-sm [font-variant-numeric:tabular-nums]">
                    {`${String(planned.target_sets)} × ${String(planned.target_reps)}`}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  aria-label={`Modifier la cible de ${planned.exercise_name}`}
                  onClick={() => {
                    setEditing(planned.id);
                  }}
                >
                  Modifier
                </Button>
              </div>
              {editing === planned.id && (
                <TargetEditor
                  planned={planned}
                  onDone={() => {
                    setEditing(null);
                  }}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <div role="alert" className="empty:hidden">
        {(add.isError || remove.isError || rename.isError) && <Alert>{PROGRAM_NOT_SAVED}</Alert>}
      </div>
      {picking ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-bold">{`Ajouter à ${day.name}`}</h3>
            <Button
              variant="ghost"
              onClick={() => {
                setPicking(false);
              }}
            >
              Annuler
            </Button>
          </div>
          <ExerciseLibrary
            selecting={add.isPending}
            onSelect={(exercise) => {
              add.mutate(
                {
                  dayId: day.id,
                  exerciseId: exercise.id,
                  position: nextPosition(day.exercises),
                  targetSets: DEFAULT_TARGET.sets,
                  targetReps: DEFAULT_TARGET.reps,
                },
                {
                  onSuccess: () => {
                    setPicking(false);
                  },
                },
              );
            }}
          />
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => {
              add.reset();
              setPicking(true);
            }}
          >
            Ajouter un exercice
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setRenaming(true);
            }}
          >
            Renommer
          </Button>
          {confirming ? (
            <>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(day.id);
                }}
              >
                {`Supprimer ${day.name}`}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Garder
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Supprimer la séance type
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** Édition d'un programme : nom, séances types, exercices et leur cible. */
export function ProgramEditor({ id }: { id: string }) {
  const { program, ...programs } = useProgram(id);
  const rename = useSaveProgram();
  const addDay = useSaveDay();
  const remove = useDeleteProgram();
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (programs.isPending) {
    return (
      <p role="status" className="text-ink-muted">
        Chargement du programme…
      </p>
    );
  }
  if (programs.isError || program === null) {
    return (
      <div className="flex flex-col gap-4">
        <div role="alert">
          <Alert>{programs.isError ? PROGRAMS_UNAVAILABLE : PROGRAM_NOT_FOUND}</Alert>
        </div>
        <TextLink href="/seance/programmes">Revenir aux programmes</TextLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {renaming ? (
        <NameForm
          label="Nom du programme"
          submitLabel="Renommer"
          initial={program.name}
          pending={rename.isPending}
          onSubmit={(name) => {
            rename.mutate(
              { id: program.id, name },
              {
                onSuccess: () => {
                  setRenaming(false);
                },
              },
            );
          }}
          onCancel={() => {
            setRenaming(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]">
            {program.name}
          </h1>
          <Button
            variant="ghost"
            aria-label={`Renommer le programme ${program.name}`}
            onClick={() => {
              setRenaming(true);
            }}
          >
            Renommer
          </Button>
        </div>
      )}
      {program.days.length === 0 && (
        <p className="text-ink-muted">
          Ajoutez une première séance type, par exemple « Poussée » ou « Jambes ».
        </p>
      )}
      {program.days.map((day) => (
        <DayEditor key={day.id} day={day} />
      ))}
      <section aria-labelledby="nouvelle-seance-type" className="flex flex-col gap-3">
        <h2 id="nouvelle-seance-type" className="text-xl font-bold">
          Nouvelle séance type
        </h2>
        <div role="alert" className="empty:hidden">
          {addDay.isError && <Alert>{PROGRAM_NOT_SAVED}</Alert>}
        </div>
        <NameForm
          key={program.days.length}
          label="Nom de la séance type"
          submitLabel="Ajouter la séance type"
          pending={addDay.isPending}
          onSubmit={(name) => {
            addDay.mutate({ programId: program.id, name, position: nextPosition(program.days) });
          }}
        />
      </section>
      <div className="border-line-subtle flex flex-col gap-3 border-t pt-6">
        <div role="alert" className="empty:hidden">
          {remove.isError && <Alert>{PROGRAM_NOT_SAVED}</Alert>}
        </div>
        {confirming ? (
          <>
            <p className="font-semibold">
              Supprimer ce programme ? Les séances déjà faites restent dans l’historique.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Garder
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(program.id, {
                    onSuccess: () => {
                      router.push("/seance/programmes");
                    },
                  });
                }}
              >
                Supprimer
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="danger"
            className="self-start"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Supprimer le programme
          </Button>
        )}
      </div>
    </div>
  );
}
