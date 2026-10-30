"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { Schemas } from "@/shared/api/client";
import { formatNumber } from "@/shared/lib/number";
import {
  displayToKilograms,
  kilogramsToDisplay,
  WEIGHT_UNITS,
  type UnitSystem,
} from "@/shared/lib/units";
import { Button } from "@/shared/ui/button";
import { ChoiceGroup } from "@/shared/ui/choice-group";
import { Stepper } from "@/shared/ui/stepper";

import { recordsLine, RECORD_LABELS, setLine, setText, weightText } from "./format";
import { RestTimer } from "./rest-timer";
import type { RestTimer as Timer } from "./use-rest-timer";
import { nextSet, useDeleteSet, useLastSets, useSaveSet } from "./use-sets";

type SetOut = Schemas["SetOut"];
type Item = Schemas["WorkoutExerciseDetailOut"];

export const SET_NOT_SAVED = "Série non enregistrée. Vérifiez la connexion et validez à nouveau.";
export const SET_NOT_DELETED = "Série non supprimée. Vérifiez la connexion et réessayez.";
const RPE_OPTIONS = [7, 7.5, 8, 8.5, 9, 9.5].map((value) => ({
  value,
  label: formatNumber(value),
}));
// Sans historique : barre olympique à vide et une série de 8.
const EMPTY_BAR = { metric: 20, imperial: 45 } as const;
const DEFAULT_REPS = 8;
const MAX_REPS = 100;
const MAX_WEIGHT_KG = 1000;

function editButtonId(one: SetOut): string {
  return `modifier-${one.id}`;
}

interface Values {
  weight: number;
  reps: number;
  rpe?: number;
  warmup: boolean;
}

/** Charge et répétitions proposées : dernière série de la séance, sinon de la dernière fois. */
export function prefill(
  item: Item,
  lastSets: SetOut[],
  system: UnitSystem,
): { weight: number; reps: number } {
  const ownLast = item.sets.at(-1);
  const reference = ownLast ?? lastSets.find((one) => !one.is_warmup) ?? lastSets.at(0);
  return reference
    ? { weight: kilogramsToDisplay(reference.weight_kg, system), reps: reference.reps }
    : { weight: EMPTY_BAR[system], reps: DEFAULT_REPS };
}

/** Série en cours de modification et son numéro affiché (« série 2 »). */
interface Editing {
  set: SetOut;
  number: number;
}

function SetForm({
  workoutId,
  item,
  system,
  initial,
  timer,
  editing,
  onAnnounce,
  onDone,
}: {
  workoutId: string;
  item: Item;
  system: UnitSystem;
  initial: Values;
  timer: Timer;
  editing?: Editing;
  onAnnounce: (message: string) => void;
  /** Fin de la modification (enregistrée, supprimée ou annulée). */
  onDone: () => void;
}) {
  const save = useSaveSet(workoutId);
  const remove = useDeleteSet(workoutId);
  const [weight, setWeight] = useState(initial.weight);
  const [reps, setReps] = useState(initial.reps);
  const [rpe, setRpe] = useState<number | undefined>(initial.rpe);
  const [warmup, setWarmup] = useState(initial.warmup);
  const [confirming, setConfirming] = useState(false);
  const warmupId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const unit = WEIGHT_UNITS[system];

  // En modification, le focus va au titre du formulaire : on sait ce qu'on modifie.
  useEffect(() => {
    if (editing) headingRef.current?.focus();
  }, [editing]);

  function recordsText(saved: SetOut): string {
    const records = saved.records.map(
      (record) => `${RECORD_LABELS[record.kind]} ${weightText(record.value_kg, system)}`,
    );
    return records.length > 0 ? ` Nouveau record : ${records.join(", ")}.` : "";
  }

  function validate() {
    const { id, position } = editing
      ? { id: editing.set.id, position: editing.set.position }
      : nextSet(item);
    const number = editing ? editing.number : item.sets.length + 1;
    onAnnounce("");
    save.mutate(
      {
        id,
        position,
        set: {
          workoutExerciseId: item.id,
          weightKg: displayToKilograms(weight, system),
          reps,
          rpe: rpe ?? null,
          isWarmup: warmup,
          performedAt: editing?.set.performed_at,
        },
      },
      {
        onSuccess: (saved) => {
          const done = editing ? "modifiée" : "enregistrée";
          onAnnounce(`Série ${String(number)} ${done}.${recordsText(saved)}`);
          if (editing) onDone();
        },
      },
    );
    if (editing) return;
    setRpe(undefined);
    setWarmup(false);
    // Le repos commence à la validation, sans attendre la réponse de l'API.
    timer.start();
  }

  function deleteSet() {
    if (!editing) return;
    onAnnounce("");
    remove.mutate(editing.set, {
      onSuccess: () => {
        onAnnounce(`Série ${String(editing.number)} supprimée.`);
        onDone();
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {editing && (
        <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold">
          {`Modifier la série ${String(editing.number)}`}
        </h3>
      )}
      <Stepper
        label="Charge"
        value={weight}
        onChange={setWeight}
        step={unit.step}
        min={0}
        max={kilogramsToDisplay(MAX_WEIGHT_KG, system)}
        unit={unit.name}
        stepUnit={unit.name}
      />
      <Stepper
        label="Répétitions"
        value={reps}
        onChange={setReps}
        step={1}
        min={1}
        max={MAX_REPS}
        unit="répétitions"
        stepUnit="répétition"
        size="md"
      />
      <div className="flex flex-col gap-2">
        <ChoiceGroup
          legend="Effort ressenti (RPE), facultatif"
          options={RPE_OPTIONS}
          value={rpe}
          onChange={setRpe}
        />
        {rpe !== undefined && (
          <Button
            variant="ghost"
            className="self-start"
            onClick={() => {
              setRpe(undefined);
            }}
          >
            Effacer le RPE
          </Button>
        )}
      </div>
      <div className="flex min-h-11 items-center gap-3">
        <input
          id={warmupId}
          type="checkbox"
          className="accent-accent size-6"
          checked={warmup}
          onChange={(event) => {
            setWarmup(event.target.checked);
          }}
        />
        <label htmlFor={warmupId} className="font-semibold">
          Série d’échauffement
        </label>
      </div>
      <div role="alert" className="empty:hidden">
        {save.isError && (
          <p className="rounded-control border-danger text-danger border p-4 font-semibold">
            {SET_NOT_SAVED}
          </p>
        )}
        {remove.isError && (
          <p className="rounded-control border-danger text-danger border p-4 font-semibold">
            {SET_NOT_DELETED}
          </p>
        )}
      </div>
      {editing &&
        (confirming ? (
          <div className="flex flex-col gap-3">
            <p className="font-semibold">{`Supprimer la série ${String(editing.number)} ?`}</p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Garder
              </Button>
              <Button variant="danger" disabled={remove.isPending} onClick={deleteSet}>
                Supprimer
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={onDone}>Annuler</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Supprimer la série
            </Button>
          </div>
        ))}
      {/* Toujours à portée du pouce, au-dessus des onglets. */}
      <div className="bg-ground sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] flex flex-col gap-3 py-3">
        {!editing && <RestTimer timer={timer} />}
        <Button
          variant="primary"
          size="lg"
          block
          disabled={editing ? save.isPending : false}
          onClick={validate}
        >
          {editing ? `Enregistrer la série ${String(editing.number)}` : "Valider la série"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Saisie des séries d'un exercice de la séance : une série validée d'un appui ; « Modifier »
 * sur une série la reprend dans le même formulaire (corriger ou supprimer).
 */
export function SetEntry({
  workoutId,
  item,
  system,
  timer,
  onClose,
}: {
  workoutId: string;
  item: Item;
  system: UnitSystem;
  timer: Timer;
  onClose: () => void;
}) {
  const lastSets = useLastSets(item.exercise_id, workoutId);
  const previous = (lastSets.data ?? []).filter((one) => !one.is_warmup);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [announce, setAnnounce] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  function stopEditing() {
    const edited = editing?.set;
    setEditing(null);
    // Retour au bouton « Modifier » de la série (le titre si elle a été supprimée).
    requestAnimationFrame(() => {
      const button = edited && document.getElementById(editButtonId(edited));
      (button ?? headingRef.current)?.focus();
    });
  }

  return (
    <section aria-labelledby="exercice" className="flex flex-col gap-6">
      <Button variant="ghost" className="self-start" onClick={onClose}>
        Retour à la séance
      </Button>
      <h2
        id="exercice"
        ref={headingRef}
        tabIndex={-1}
        lang={item.exercise_name_language}
        className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]"
      >
        {item.exercise_name}
      </h2>
      <p className="text-ink-muted">
        {lastSets.isPending
          ? "Recherche de la dernière fois…"
          : previous.length > 0
            ? `La dernière fois : ${previous.map((one) => setText(one, system)).join(", ")}.`
            : "Première fois pour cet exercice."}
      </p>
      {item.sets.length > 0 && (
        <ol aria-label="Séries de la séance" className="border-line-subtle border-t">
          {item.sets.map((one, index) => (
            <li
              key={one.id}
              className="border-line-subtle flex items-center justify-between gap-3 border-b py-2"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-bold [font-variant-numeric:tabular-nums]">
                  {setLine(one, index + 1, system)}
                </span>
                {one.records.length > 0 && (
                  <span className="text-accent-ink text-sm font-bold">{recordsLine(one)}</span>
                )}
              </div>
              <Button
                id={editButtonId(one)}
                variant="ghost"
                aria-label={`Modifier la série ${String(index + 1)}`}
                onClick={() => {
                  setAnnounce("");
                  setEditing({ set: one, number: index + 1 });
                }}
              >
                Modifier
              </Button>
            </li>
          ))}
        </ol>
      )}
      <p role="status" className="font-semibold empty:hidden">
        {announce}
      </p>
      {lastSets.isPending ? null : (
        <SetForm
          // Nouveau formulaire à chaque série modifiée : ses valeurs repartent de la série.
          key={editing?.set.id ?? "nouvelle"}
          workoutId={workoutId}
          item={item}
          system={system}
          initial={
            editing
              ? {
                  weight: kilogramsToDisplay(editing.set.weight_kg, system),
                  reps: editing.set.reps,
                  rpe: editing.set.rpe ?? undefined,
                  warmup: editing.set.is_warmup,
                }
              : { ...prefill(item, lastSets.data ?? [], system), warmup: false }
          }
          timer={timer}
          editing={editing ?? undefined}
          onAnnounce={setAnnounce}
          onDone={stopEditing}
        />
      )}
    </section>
  );
}
