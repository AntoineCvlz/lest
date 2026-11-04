"use client";

import Link from "next/link";

import { durationText } from "@/features/activities/activity-journal";
import { bodyWeightText } from "@/features/body/weight-chart";
import { useProfile } from "@/features/profile/use-profile";
import { shortDay } from "@/shared/lib/days";
import { formatNumber } from "@/shared/lib/number";
import {
  DISTANCE_UNITS,
  kilogramsToDisplay,
  metresToDistance,
  type UnitSystem,
  WEIGHT_UNITS,
} from "@/shared/lib/units";
import { Button } from "@/shared/ui/button";

import { type DashboardData, useDashboard } from "./use-dashboard";

export const DASHBOARD_UNAVAILABLE = "Bilan indisponible pour le moment.";

type Weight = DashboardData["weight"];
type Week = DashboardData["weeks"][number];
type Adherence = NonNullable<DashboardData["nutrition"]["last_7"]>;
type MuscleWeek = DashboardData["muscles"][number];

const NBSP = " ";
const LINK = "text-ink font-semibold underline underline-offset-4";
const SECTION = "border-line-subtle flex flex-col gap-4 border-t pt-6";
const TITLE = "text-xl font-extrabold [font-stretch:112%]";

const GOALS = { gain: "prise de masse", maintain: "maintien", cut: "sèche" } as const;
const STATUS = {
  below: "sous le repère",
  within: "dans le repère",
  above: "au-dessus du repère",
} as const;

/** « +1,2 kg » ou « −0,4 kg » : une variation de poids, signe compris. */
export function signedWeight(kilograms: number, system: UnitSystem): string {
  const value = Math.round(kilogramsToDisplay(Math.abs(kilograms), system) * 10) / 10;
  const sign = value === 0 ? "" : kilograms > 0 ? "+" : "−";
  return `${sign}${formatNumber(value)}${NBSP}${WEIGHT_UNITS[system].symbol}`;
}

/** Phrase sur le rythme : « +0,3 kg par semaine sur 4 semaines, dans le repère de la prise de
 * masse (+0,1 à +0,5 kg). » */
export function paceText(weight: Weight, system: UnitSystem): string | null {
  if (weight.pace_kg_per_week === null) return null;
  const pace = `${signedWeight(weight.pace_kg_per_week, system)} par semaine sur 4${NBSP}semaines`;
  if (!weight.goal || !weight.pace_range || !weight.pace_status) return `${pace}.`;
  const range = `${signedWeight(weight.pace_range.low_kg, system)} à ${signedWeight(weight.pace_range.high_kg, system)}`;
  return `${pace}, ${STATUS[weight.pace_status]} de la ${GOALS[weight.goal]} (${range}).`;
}

function WeightBlock({ weight, system }: { weight: Weight; system: UnitSystem }) {
  const pace = paceText(weight, system);
  return (
    <section aria-labelledby="weight-title" className={SECTION}>
      <h2 id="weight-title" className={TITLE}>
        Poids
      </h2>
      {weight.trend_kg === null ? (
        <p className="text-ink-muted">
          Aucune pesée sur les 12 dernières semaines.{" "}
          <Link href="/corps" className={LINK}>
            Noter une pesée
          </Link>
        </p>
      ) : (
        <>
          <p className="flex flex-col gap-1">
            <span className="text-ink-muted text-sm">Moyenne sur 7 jours</span>
            <span className="text-[40px] leading-none font-extrabold tabular-nums [font-stretch:112%]">
              {bodyWeightText(weight.trend_kg, system)}
            </span>
          </p>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(9rem,100%),1fr))] gap-3 tabular-nums">
            {(
              [
                ["Sur 4 semaines", weight.change_4w_kg],
                ["Sur 12 semaines", weight.change_12w_kg],
              ] as const
            ).map(([label, change]) => (
              <div key={label} className="rounded-control bg-surface flex flex-col gap-1 p-3">
                <dt className="text-ink-muted text-sm">{label}</dt>
                <dd className="text-[17px] font-bold">
                  {change === null ? "Pas assez de pesées" : signedWeight(change, system)}
                </dd>
              </div>
            ))}
          </dl>
          {pace && <p>{pace}</p>}
          {weight.pace_status && (
            <p className="text-ink-muted text-sm">
              Repère général, pas un avis médical : ajustez selon votre ressenti.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Temps actif d'une semaine : musculation et autres sports. */
function activeSeconds(week: Week): number {
  return week.workout_duration_s + week.activity_duration_s;
}

/** Résumé de la semaine en cours, nom de la figure. */
export function weekSummary(week: Week | undefined): string {
  if (!week || activeSeconds(week) === 0) return "Rien de noté cette semaine pour l’instant.";
  const parts: string[] = [];
  if (week.workouts > 0) {
    parts.push(
      `${String(week.workouts)} ${week.workouts > 1 ? "séances" : "séance"} de musculation (${durationText(week.workout_duration_s)})`,
    );
  }
  if (week.activities > 0) {
    parts.push(
      `${String(week.activities)} ${week.activities > 1 ? "activités" : "activité"} d’autres sports (${durationText(week.activity_duration_s)})`,
    );
  }
  return `Cette semaine : ${parts.join(" et ")}.`;
}

// Repère du dessin : étiré à la largeur de l'écran, barres en attributs (pas de `style`, CSP).
const WIDTH = 320;
const HEIGHT = 120;

function ActivityBlock({ weeks, system }: { weeks: readonly Week[]; system: UnitSystem }) {
  const highest = Math.max(1, ...weeks.map(activeSeconds));
  const slot = WIDTH / Math.max(1, weeks.length);
  const unit = DISTANCE_UNITS[system].symbol;
  return (
    <section aria-labelledby="activity-title" className={SECTION}>
      <h2 id="activity-title" className={TITLE}>
        Activité des 8 dernières semaines
      </h2>
      <figure className="flex flex-col gap-3">
        <figcaption className="text-[17px] font-bold">{weekSummary(weeks.at(-1))}</figcaption>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
          <div
            aria-hidden="true"
            className="text-ink-muted flex flex-col justify-between text-right text-sm tabular-nums"
          >
            <span>{durationText(highest)}</span>
            <span>0</span>
          </div>
          <svg
            role="img"
            aria-label="Temps actif par semaine, détaillé dans le tableau qui suit"
            viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
            preserveAspectRatio="none"
            className="border-line h-32 w-full border-b"
          >
            {weeks.map((week, index) => {
              const height = (activeSeconds(week) / highest) * HEIGHT;
              return (
                <rect
                  key={week.week}
                  x={index * slot + slot * 0.2}
                  y={HEIGHT - height}
                  width={slot * 0.6}
                  height={height}
                  className={index === weeks.length - 1 ? "fill-ink" : "fill-ink-muted"}
                />
              );
            })}
          </svg>
          <span aria-hidden="true" />
          <div aria-hidden="true" className="text-ink-muted flex justify-between text-sm">
            <span>{weeks[0] ? shortDay(weeks[0].week) : ""}</span>
            <span>Cette semaine</span>
          </div>
        </div>
      </figure>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm tabular-nums">
          <caption className="text-ink-muted mb-2 text-left text-sm font-semibold">
            Détail par semaine, la plus récente d’abord
          </caption>
          <thead>
            <tr className="border-line-subtle border-b">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Semaine du
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Musculation
              </th>
              <th scope="col" className="py-2 font-semibold">
                Autres sports
              </th>
            </tr>
          </thead>
          <tbody>
            {weeks.toReversed().map((week) => (
              <tr key={week.week} className="border-line-subtle border-b">
                <th scope="row" className="py-2 pr-3 font-semibold">
                  {shortDay(week.week)}
                </th>
                <td className="py-2 pr-3">
                  {week.workouts === 0
                    ? "—"
                    : `${String(week.workouts)} ${week.workouts > 1 ? "séances" : "séance"}, ${durationText(week.workout_duration_s)}`}
                </td>
                <td className="py-2">
                  {week.activities === 0
                    ? "—"
                    : `${String(week.activities)} ${week.activities > 1 ? "activités" : "activité"}, ${durationText(week.activity_duration_s)}${
                        week.distance_m > 0
                          ? `, ${formatNumber(metresToDistance(week.distance_m, system))}${NBSP}${unit}`
                          : ""
                      }`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** « 5 jours notés sur 7 : énergie dans l'objectif 3 jours, protéines 4 jours. » */
export function adherenceText(adherence: Adherence): string {
  const days = (n: number) => `${String(n)}${NBSP}${n > 1 ? "jours" : "jour"}`;
  if (adherence.logged_days === 0) {
    return `Aucun repas noté sur les ${String(adherence.days)} derniers jours.`;
  }
  return `${days(adherence.logged_days)} notés sur ${String(adherence.days)} : énergie dans l’objectif ${days(adherence.kcal_days)}, protéines ${days(adherence.protein_days)}.`;
}

function NutritionBlock({ nutrition }: { nutrition: DashboardData["nutrition"] }) {
  return (
    <section aria-labelledby="nutrition-title" className={SECTION}>
      <h2 id="nutrition-title" className={TITLE}>
        Nutrition
      </h2>
      {!nutrition.configured || !nutrition.last_7 || !nutrition.last_28 ? (
        <p className="text-ink-muted">
          Activez vos objectifs pour suivre vos repas.{" "}
          <Link href="/profil" className={LINK}>
            Objectifs dans le profil
          </Link>
        </p>
      ) : (
        <>
          <p className="text-ink-muted text-sm tabular-nums">
            {`Objectifs : ${formatNumber(nutrition.kcal_target ?? 0)}${NBSP}kcal, ${formatNumber(nutrition.protein_target ?? 0)}${NBSP}g de protéines par jour. Énergie à 10 % près, protéines à 90 % au moins ; aujourd’hui n’est pas compté.`}
          </p>
          <dl className="flex flex-col gap-3">
            {(
              [
                ["7 derniers jours", nutrition.last_7],
                ["28 derniers jours", nutrition.last_28],
              ] as const
            ).map(([label, adherence]) => (
              <div key={label} className="rounded-control bg-surface flex flex-col gap-1 p-3">
                <dt className="text-ink-muted text-sm">{label}</dt>
                <dd className="font-semibold">{adherenceText(adherence)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

interface MuscleRow {
  muscle: string;
  thisWeek: number;
  total: number;
  volume: number;
}

/** Séries par muscle : cette semaine, total des 8 semaines, volume de la semaine. */
export function muscleRows(muscles: readonly MuscleWeek[], currentWeek: string): MuscleRow[] {
  const rows = new Map<string, MuscleRow>();
  for (const m of muscles) {
    const row = rows.get(m.muscle) ?? { muscle: m.muscle, thisWeek: 0, total: 0, volume: 0 };
    row.total += m.sets;
    if (m.week === currentWeek) {
      row.thisWeek += m.sets;
      row.volume += m.volume_kg;
    }
    rows.set(m.muscle, row);
  }
  return [...rows.values()].toSorted(
    (a, b) => b.total - a.total || a.muscle.localeCompare(b.muscle, "fr"),
  );
}

function MuscleBlock({
  muscles,
  currentWeek,
  system,
}: {
  muscles: readonly MuscleWeek[];
  currentWeek: string;
  system: UnitSystem;
}) {
  const rows = muscleRows(muscles, currentWeek);
  const highest = Math.max(1, ...rows.map((r) => r.total));
  const unit = WEIGHT_UNITS[system].symbol;
  return (
    <section aria-labelledby="muscle-title" className={SECTION}>
      <h2 id="muscle-title" className={TITLE}>
        Volume par muscle
      </h2>
      {rows.length === 0 ? (
        <p className="text-ink-muted">
          Aucune série de travail sur les 8 dernières semaines.{" "}
          <Link href="/seance" className={LINK}>
            Commencer une séance
          </Link>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <caption className="text-ink-muted mb-2 text-left text-sm font-semibold">
              Séries de travail par muscle principal, échauffement exclu
            </caption>
            <thead>
              <tr className="border-line-subtle border-b">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Muscle
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Cette semaine
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  8 semaines
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Volume de la semaine
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.muscle} className="border-line-subtle border-b">
                  <th scope="row" className="py-2 pr-3 font-semibold">
                    {row.muscle}
                  </th>
                  <td className="py-2 pr-3">{formatNumber(row.thisWeek)}</td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <span className="min-w-6">{formatNumber(row.total)}</span>
                      {/* Barre décorative : la valeur est écrite à côté. */}
                      <svg aria-hidden="true" viewBox="0 0 100 8" className="h-2 w-16">
                        <rect
                          x="0"
                          y="0"
                          width={(row.total / highest) * 100}
                          height="8"
                          className="fill-ink-muted"
                        />
                      </svg>
                    </span>
                  </td>
                  <td className="py-2">
                    {row.volume === 0
                      ? "—"
                      : `${formatNumber(Math.round(kilogramsToDisplay(row.volume, system)))}${NBSP}${unit}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Bilan (ADR 0013) : poids et rythme, activité des 8 semaines, adhérence nutrition, volume par
 * muscle. Chaque graphique a son résumé en texte et son tableau.
 */
export function Dashboard() {
  const dashboard = useDashboard();
  const profile = useProfile();
  const system = profile.data?.unit_system ?? "metric";
  const data = dashboard.data;

  if (dashboard.isPending) return <p className="text-ink-muted">Chargement du bilan…</p>;
  if (!data) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-danger font-semibold">{DASHBOARD_UNAVAILABLE}</p>
        <Button
          variant="secondary"
          onClick={() => {
            void dashboard.refetch();
          }}
        >
          Réessayer
        </Button>
      </div>
    );
  }
  const currentWeek = data.weeks.at(-1)?.week ?? "";
  return (
    <div className="flex flex-col gap-8">
      <WeightBlock weight={data.weight} system={system} />
      <ActivityBlock weeks={data.weeks} system={system} />
      <NutritionBlock nutrition={data.nutrition} />
      <MuscleBlock muscles={data.muscles} currentWeek={currentWeek} system={system} />
    </div>
  );
}
