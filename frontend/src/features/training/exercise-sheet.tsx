"use client";

import Link from "next/link";
import { useState } from "react";

import { TextLink } from "@/features/auth/text-link";
import { useProfile } from "@/features/profile/use-profile";
import type { Schemas } from "@/shared/api/client";
import { formatNumber } from "@/shared/lib/number";
import { kilogramsToDisplay, WEIGHT_UNITS, type UnitSystem } from "@/shared/lib/units";
import { Button } from "@/shared/ui/button";

import { CATEGORY_LABELS } from "./categories";
import { useExercise, useExerciseRecords } from "./use-exercise";

export const EXERCISE_NOT_FOUND = "Cet exercice n’existe pas ou plus.";
export const SHEET_UNAVAILABLE = "Fiche indisponible. Réessayez dans un instant.";
export const NO_RECORDS =
  "Aucun record pour l’instant : ils apparaissent dès votre première série de travail.";
const RECORD_LABELS = { weight: "Charge max", e1rm: "1RM estimé" } as const;
const SHOWN_AT_FIRST = 10;
const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

type RecordOut = Schemas["RecordOut"];

function weightText(kilograms: number, system: UnitSystem): string {
  return `${formatNumber(kilogramsToDisplay(kilograms, system))} ${WEIGHT_UNITS[system].symbol}`;
}

function names(rows: { name: string }[]): string {
  return rows.map((row) => row.name).join(", ");
}

/** Meilleur record actuel de chaque type : le dernier de l'historique (amélioration stricte). */
function bests(history: RecordOut[]): RecordOut[] {
  return (["weight", "e1rm"] as const).flatMap((kind) => {
    const last = history.findLast((record) => record.kind === kind);
    return last ? [last] : [];
  });
}

function Records({ id, system }: { id: string; system: UnitSystem }) {
  const records = useExerciseRecords(id);
  const [all, setAll] = useState(false);

  if (records.isPending) return <p className="text-ink-muted">Chargement de vos records…</p>;
  if (records.isError) {
    return (
      <p
        role="alert"
        className="rounded-control border-danger text-danger border p-4 font-semibold"
      >
        {SHEET_UNAVAILABLE}
      </p>
    );
  }
  if (records.data.length === 0) return <p className="text-ink-muted">{NO_RECORDS}</p>;

  const newestFirst = records.data.toReversed();
  const shown = all ? newestFirst : newestFirst.slice(0, SHOWN_AT_FIRST);
  return (
    <>
      <dl className="grid grid-cols-2 gap-3">
        {bests(records.data).map((record) => (
          <div key={record.kind} className="rounded-control bg-surface flex flex-col gap-1 p-4">
            <dt className="text-ink-muted text-sm">{RECORD_LABELS[record.kind]}</dt>
            <dd className="text-[28px] leading-none font-extrabold [font-stretch:112%] [font-variant-numeric:tabular-nums]">
              {weightText(record.value_kg, system)}
            </dd>
            <dd className="text-ink-muted text-sm">{DATE.format(new Date(record.achieved_at))}</dd>
          </div>
        ))}
      </dl>
      <table className="w-full text-left [font-variant-numeric:tabular-nums]">
        <caption className="text-ink-muted mb-2 text-left text-sm">
          Progression, du plus récent au plus ancien
        </caption>
        <thead>
          <tr className="border-line-subtle border-b">
            <th scope="col" className="py-2 font-semibold">
              Date
            </th>
            <th scope="col" className="py-2 font-semibold">
              Record
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              Valeur
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((record) => (
            <tr
              key={`${record.kind}-${record.achieved_at}`}
              className="border-line-subtle border-b"
            >
              <td className="py-2">{DATE.format(new Date(record.achieved_at))}</td>
              <td className="py-2">{RECORD_LABELS[record.kind]}</td>
              <td className="py-2 text-right font-bold">{weightText(record.value_kg, system)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!all && newestFirst.length > SHOWN_AT_FIRST && (
        <Button
          onClick={() => {
            setAll(true);
          }}
        >
          {`Afficher les ${String(newestFirst.length)} records`}
        </Button>
      )}
    </>
  );
}

/** Fiche d'exercice : description du catalogue, attribution wger, records du compte. */
export function ExerciseSheet({ id }: { id: string }) {
  const exercise = useExercise(id);
  const profile = useProfile();
  const system = profile.data?.unit_system ?? "metric";

  if (exercise.isPending) {
    return (
      <p role="status" className="text-ink-muted">
        Chargement de la fiche…
      </p>
    );
  }
  if (exercise.isError || exercise.data === null) {
    return (
      <div className="flex flex-col gap-4">
        <p
          role="alert"
          className="rounded-control border-danger text-danger border p-4 font-semibold"
        >
          {exercise.isError ? SHEET_UNAVAILABLE : EXERCISE_NOT_FOUND}
        </p>
        <TextLink href="/exercices">Revenir aux exercices</TextLink>
      </div>
    );
  }

  const sheet = exercise.data;
  return (
    <article aria-labelledby="exercice" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1
          id="exercice"
          lang={sheet.name_language}
          className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]"
        >
          {sheet.name}
        </h1>
        {sheet.name_language === "en" && (
          <p className="text-ink-muted">Pas encore de nom français : nom anglais affiché.</p>
        )}
        {!sheet.is_active && (
          <p className="text-ink-muted">Retiré du catalogue : gardé pour votre historique.</p>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-ink-muted">Catégorie</dt>
        <dd>{CATEGORY_LABELS[sheet.category]}</dd>
        {sheet.muscles.length > 0 && (
          <>
            <dt className="text-ink-muted">Muscles</dt>
            <dd>{names(sheet.muscles)}</dd>
          </>
        )}
        {sheet.secondary_muscles.length > 0 && (
          <>
            <dt className="text-ink-muted">Secondaires</dt>
            <dd>{names(sheet.secondary_muscles)}</dd>
          </>
        )}
        {sheet.equipment.length > 0 && (
          <>
            <dt className="text-ink-muted">Équipement</dt>
            <dd>{names(sheet.equipment)}</dd>
          </>
        )}
      </dl>
      <section aria-labelledby="records" className="flex flex-col gap-4">
        <h2 id="records" className="text-xl font-bold">
          Vos records
        </h2>
        <Records id={id} system={system} />
      </section>
      <p className="text-ink-muted text-sm">
        {`Source : wger, licence ${sheet.license}`}
        {sheet.license_author && `, par ${sheet.license_author}`}.{" "}
        <Link href="/sources" className="text-ink font-semibold underline underline-offset-4">
          Sources et licences
        </Link>
      </p>
    </article>
  );
}
