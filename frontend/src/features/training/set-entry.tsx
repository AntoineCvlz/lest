"use client";

import { useId, useState } from "react";

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

import { nextSet, useLastSets, useSaveSet } from "./use-sets";

type SetOut = Schemas["SetOut"];
type Item = Schemas["WorkoutExerciseDetailOut"];

export const SET_NOT_SAVED = "Série non enregistrée. Vérifiez la connexion et validez à nouveau.";
const RPE_OPTIONS = [7, 7.5, 8, 8.5, 9, 9.5].map((value) => ({
  value,
  label: formatNumber(value),
}));
const RECORD_LABELS = { weight: "charge max", e1rm: "1RM estimé" } as const;
// Sans historique : barre olympique à vide et une série de 8.
const EMPTY_BAR = { metric: 20, imperial: 45 } as const;
const DEFAULT_REPS = 8;
const MAX_REPS = 100;
const MAX_WEIGHT_KG = 1000;

function weightText(kilograms: number, system: UnitSystem): string {
  return `${formatNumber(kilogramsToDisplay(kilograms, system))} ${WEIGHT_UNITS[system].symbol}`;
}

function setText(one: SetOut, system: UnitSystem): string {
  return `${weightText(one.weight_kg, system)} × ${String(one.reps)}`;
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

function SetForm({
  workoutId,
  item,
  system,
  initial,
}: {
  workoutId: string;
  item: Item;
  system: UnitSystem;
  initial: { weight: number; reps: number };
}) {
  const save = useSaveSet(workoutId);
  const [weight, setWeight] = useState(initial.weight);
  const [reps, setReps] = useState(initial.reps);
  const [rpe, setRpe] = useState<number | undefined>(undefined);
  const [warmup, setWarmup] = useState(false);
  const [announce, setAnnounce] = useState("");
  const warmupId = useId();
  const unit = WEIGHT_UNITS[system];

  function validate() {
    const { id, position } = nextSet(item);
    setAnnounce("");
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
        },
      },
      {
        onSuccess: (saved) => {
          const records = saved.records.map(
            (record) => `${RECORD_LABELS[record.kind]} ${weightText(record.value_kg, system)}`,
          );
          setAnnounce(
            records.length > 0
              ? `Série ${String(position + 1)} enregistrée. Nouveau record : ${records.join(", ")}.`
              : `Série ${String(position + 1)} enregistrée.`,
          );
        },
      },
    );
    setRpe(undefined);
    setWarmup(false);
  }

  return (
    <div className="flex flex-col gap-6">
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
      <p role="status" className="font-semibold empty:hidden">
        {announce}
      </p>
      <div role="alert" className="empty:hidden">
        {save.isError && (
          <p className="rounded-control border-danger text-danger border p-4 font-semibold">
            {SET_NOT_SAVED}
          </p>
        )}
      </div>
      {/* Toujours à portée du pouce, au-dessus des onglets. */}
      <div className="bg-ground sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] py-3">
        <Button variant="primary" size="lg" block onClick={validate}>
          Valider la série
        </Button>
      </div>
    </div>
  );
}

/** Saisie des séries d'un exercice de la séance : une série validée d'un appui. */
export function SetEntry({
  workoutId,
  item,
  system,
  onClose,
}: {
  workoutId: string;
  item: Item;
  system: UnitSystem;
  onClose: () => void;
}) {
  const lastSets = useLastSets(item.exercise_id, workoutId);
  const previous = (lastSets.data ?? []).filter((one) => !one.is_warmup);

  return (
    <section aria-labelledby="exercice" className="flex flex-col gap-6">
      <Button variant="ghost" className="self-start" onClick={onClose}>
        Retour à la séance
      </Button>
      <h2
        id="exercice"
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
            <li key={one.id} className="border-line-subtle flex flex-col gap-1 border-b py-3">
              <span className="font-bold [font-variant-numeric:tabular-nums]">
                {`Série ${String(index + 1)} : ${setText(one, system)}`}
                {one.rpe !== null && `, RPE ${formatNumber(one.rpe)}`}
                {one.is_warmup && ", échauffement"}
              </span>
              {one.records.length > 0 && (
                <span className="text-accent-ink text-sm font-bold">
                  {`Record : ${one.records.map((record) => RECORD_LABELS[record.kind]).join(", ")}`}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {lastSets.isPending ? null : (
        <SetForm
          workoutId={workoutId}
          item={item}
          system={system}
          initial={prefill(item, lastSets.data ?? [], system)}
        />
      )}
    </section>
  );
}
