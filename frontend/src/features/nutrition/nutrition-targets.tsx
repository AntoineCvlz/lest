"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { dayToDate, localDay } from "@/shared/lib/days";
import { formatNumber } from "@/shared/lib/number";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { ChoiceGroup } from "@/shared/ui/choice-group";
import { SelectField } from "@/shared/ui/select-field";
import { TextField } from "@/shared/ui/text-field";

import {
  ACTIVITIES,
  type Macros,
  type TargetsIn,
  type TargetsOut,
  TargetsRejected,
  useSaveTargets,
  useTargets,
} from "./use-targets";

export const TARGETS_UNAVAILABLE = "Objectifs indisponibles pour le moment.";
export const TARGETS_NOT_SAVED = "Objectifs non enregistrés. Vérifiez les valeurs, puis réessayez.";

const SEXES = [
  { value: "male", label: "Formule masculine" },
  { value: "female", label: "Formule féminine" },
] as const;

/** Âges acceptés par l'API (ADR 0011). */
const MIN_AGE = 14;
const MAX_AGE = 100;

type Field = "kcal" | "protein_g" | "carbs_g" | "fat_g";
type FormField = "sex" | "birth" | Field;

const FIELDS: readonly { key: Field; label: string; unit: string; min: number; max: number }[] = [
  { key: "kcal", label: "Énergie", unit: "kcal", min: 1000, max: 8000 },
  { key: "protein_g", label: "Protéines", unit: "g", min: 0, max: 500 },
  { key: "carbs_g", label: "Glucides", unit: "g", min: 0, max: 1000 },
  { key: "fat_g", label: "Lipides", unit: "g", min: 0, max: 400 },
];

/** Ordre du formulaire : le focus va au premier champ fautif. */
const ORDER: readonly FormField[] = ["sex", "birth", "kcal", "protein_g", "carbs_g", "fat_g"];

/** Nom des champs de l'API vers ceux du formulaire (refus 422). */
const API_FIELDS: Readonly<Record<string, FormField>> = {
  sex: "sex",
  birth_date: "birth",
  kcal: "kcal",
  protein_g: "protein_g",
  carbs_g: "carbs_g",
  fat_g: "fat_g",
};

/** « 3 030 kcal », « 160 g » : un objectif. */
export function targetText(macros: Macros, key: Field): string {
  const unit = FIELDS.find((f) => f.key === key)?.unit ?? "";
  return `${formatNumber(macros[key])} ${unit}`;
}

/** Même jour et même mois, `years` ans plus tôt (AAAA-MM-JJ). */
function yearsBefore(day: string, years: number): string {
  return `${String(Number(day.slice(0, 4)) - years).padStart(4, "0")}${day.slice(4)}`;
}

function numericDay(day: string): string {
  return dayToDate(day).toLocaleDateString("fr-FR");
}

/** Message d'enregistrement : dit aussi ce qui manque pour calculer. */
function savedMessage(data: TargetsOut): string {
  if (data.missing.includes("weight")) {
    return "Objectifs enregistrés. Pour les calculer, notez une première pesée dans Corps.";
  }
  if (data.missing.includes("profile")) {
    return "Objectifs enregistrés. Pour les calculer, complétez votre taille et votre objectif plus haut.";
  }
  return "Objectifs enregistrés.";
}

function TargetsForm({ data, onSaved }: { data: TargetsOut; onSaved: (message: string) => void }) {
  const hydrated = useHydrated();
  const save = useSaveTargets();
  // Formulaire jamais recréé après un enregistrement : le focus reste sur le bouton. Ses valeurs
  // sont déjà celles que l'API renvoie.
  const inputs = data.inputs;
  const [sex, setSex] = useState<TargetsIn["sex"] | undefined>(inputs?.sex);
  const [birth, setBirth] = useState(inputs?.birth_date ?? "");
  const [activity, setActivity] = useState<TargetsIn["activity"]>(inputs?.activity ?? "moderate");
  const [manual, setManual] = useState<Record<Field, string>>({
    kcal: inputs?.kcal == null ? "" : String(inputs.kcal),
    protein_g: inputs?.protein_g == null ? "" : String(inputs.protein_g),
    carbs_g: inputs?.carbs_g == null ? "" : String(inputs.carbs_g),
    fat_g: inputs?.fat_g == null ? "" : String(inputs.fat_g),
  });
  const [invalid, setInvalid] = useState<FormField[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const today = localDay();
  const latestBirth = yearsBefore(today, MIN_AGE);
  const earliestBirth = yearsBefore(today, MAX_AGE);
  const detail = ACTIVITIES.find((a) => a.value === activity)?.detail;

  function showFaults(faults: FormField[]) {
    flushSync(() => {
      setInvalid(faults);
    });
    const first = ORDER.find((field) => faults.includes(field));
    if (!first) return;
    const selector = first === "sex" ? "[data-field=sex] input" : `input[name=${first}]`;
    formRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }

  function birthError(): string | undefined {
    if (!invalid.includes("birth")) return undefined;
    if (!birth) return "Indiquez votre date de naissance.";
    return `Date de naissance du ${numericDay(earliestBirth)} au ${numericDay(latestBirth)}.`;
  }

  return (
    <form
      ref={formRef}
      method="post"
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending) return;
        save.reset();
        onSaved("");
        const faults: FormField[] = [];
        if (!sex) faults.push("sex");
        if (!birth || birth < earliestBirth || birth > latestBirth) faults.push("birth");
        const values: Partial<Record<Field, number | null>> = {};
        for (const { key, min, max } of FIELDS) {
          const text = manual[key].trim();
          if (text === "") {
            values[key] = null;
            continue;
          }
          const value = Number(text);
          if (!Number.isInteger(value) || value < min || value > max) faults.push(key);
          else values[key] = value;
        }
        showFaults(faults);
        if (faults.length > 0 || !sex) return;
        save.mutate(
          {
            sex,
            birth_date: birth,
            activity,
            kcal: values.kcal ?? null,
            protein_g: values.protein_g ?? null,
            carbs_g: values.carbs_g ?? null,
            fat_g: values.fat_g ?? null,
          },
          {
            onSuccess: (saved) => {
              onSaved(savedMessage(saved));
            },
            onError: (error) => {
              if (!(error instanceof TargetsRejected)) return;
              const fields = error.fields.flatMap((name) => API_FIELDS[name] ?? []);
              if (fields.length > 0) showFaults(fields);
            },
          },
        );
      }}
    >
      <div data-field="sex">
        <ChoiceGroup
          legend="Formule de calcul"
          options={SEXES}
          value={sex}
          onChange={setSex}
          layout="row"
          hint="La formule de Mifflin-St Jeor prévoit une constante pour chacune : choisissez celle qui vous correspond le mieux."
          error={invalid.includes("sex") ? "Choisissez une formule de calcul." : undefined}
        />
      </div>
      <TextField
        label="Date de naissance"
        name="birth"
        type="date"
        autoComplete="bday"
        min={earliestBirth}
        max={latestBirth}
        value={birth}
        error={birthError()}
        onChange={(event) => {
          setBirth(event.target.value);
        }}
      />
      <SelectField
        label="Niveau d’activité"
        value={activity}
        hint={detail}
        onChange={(event) => {
          const chosen = ACTIVITIES.find((a) => a.value === event.target.value);
          if (chosen) setActivity(chosen.value);
        }}
      >
        {ACTIVITIES.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </SelectField>
      <fieldset aria-describedby="targets-manual-hint" className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">Objectifs à la main (facultatif)</legend>
        <p id="targets-manual-hint" className="text-ink-muted -mt-1 text-sm">
          Laissez vide pour garder la valeur calculée.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
          {FIELDS.map(({ key, label, unit, min, max }) => (
            <TextField
              key={key}
              label={`${label} (${unit})`}
              name={key}
              inputMode="numeric"
              autoComplete="off"
              value={manual[key]}
              hint={data.computed ? `Calcul : ${targetText(data.computed, key)}` : undefined}
              error={
                invalid.includes(key)
                  ? `Nombre entier de ${formatNumber(min)} à ${formatNumber(max)}.`
                  : undefined
              }
              onChange={(event) => {
                const text = event.target.value;
                setManual((current) => ({ ...current, [key]: text }));
              }}
            />
          ))}
        </div>
      </fieldset>
      <div role="alert" className="empty:hidden">
        {save.isError && (
          <p className="rounded-control border-danger text-danger border p-4 font-semibold">
            {TARGETS_NOT_SAVED}
          </p>
        )}
      </div>
      <Button
        type="submit"
        variant="primary"
        block
        disabled={!hydrated}
        aria-disabled={save.isPending}
      >
        {data.configured ? "Enregistrer les objectifs" : "Activer mes objectifs"}
      </Button>
    </form>
  );
}

/**
 * Objectifs nutritionnels (ADR 0011) : calcul proposé à partir du poids, de la taille, de l'âge
 * et de l'activité, chaque valeur modifiable. Rien n'est demandé tant qu'on ne les active pas.
 */
export function NutritionTargets() {
  const targets = useTargets();
  const data = targets.data;
  const [notice, setNotice] = useState("");
  const chosen = data?.targets;

  return (
    <section
      aria-labelledby="targets-title"
      className="border-line-subtle flex flex-col gap-4 border-t pt-8"
    >
      <h2 id="targets-title" className="text-xl font-extrabold [font-stretch:112%]">
        Objectifs nutritionnels
      </h2>
      <p className="text-ink-muted">
        Une estimation de départ, pas un avis médical : ajustez-la selon l’évolution de votre poids.
      </p>
      {targets.isPending && <p className="text-ink-muted">Chargement des objectifs…</p>}
      {targets.isError && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-danger font-semibold">{TARGETS_UNAVAILABLE}</p>
          <Button
            onClick={() => {
              void targets.refetch();
            }}
          >
            Réessayer
          </Button>
        </div>
      )}
      {data && (
        <>
          {chosen && (
            <div className="flex flex-col gap-2">
              <h3 className="text-ink-muted text-sm font-semibold">Objectifs retenus</h3>
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3 tabular-nums">
                {FIELDS.map(({ key, label }) => (
                  <div key={key} className="rounded-control bg-surface flex flex-col gap-1 p-3">
                    <dt className="text-ink-muted text-sm">{label}</dt>
                    <dd className="text-[17px] font-bold">{targetText(chosen, key)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {data.configured && data.missing.includes("weight") && (
            <p className="text-ink-muted">
              Pour calculer, notez une première pesée dans{" "}
              <Link href="/corps" className="text-ink font-semibold underline">
                Corps
              </Link>
              .
            </p>
          )}
          {data.configured && data.missing.includes("profile") && (
            <p className="text-ink-muted">
              Pour calculer, complétez votre taille et votre objectif plus haut.
            </p>
          )}
          <TargetsForm data={data} onSaved={setNotice} />
          <p aria-live="polite" className="text-ink-muted empty:sr-only">
            {notice}
          </p>
        </>
      )}
    </section>
  );
}
