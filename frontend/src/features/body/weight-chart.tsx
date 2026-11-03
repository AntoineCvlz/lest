import type { Schemas } from "@/shared/api/client";
import { formatNumber } from "@/shared/lib/number";
import { kilogramsToDisplay, WEIGHT_UNITS, type UnitSystem } from "@/shared/lib/units";

import { dayToDate, shortDay } from "./days";

type Point = Schemas["WeightPointOut"];

// Repère du dessin : l'image est étirée à la largeur de l'écran (`preserveAspectRatio="none"`),
// les traits gardent leur épaisseur (`vector-effect`).
const WIDTH = 320;
const HEIGHT = 160;
const DAY_MS = 86_400_000;

/** Poids du corps au dixième (« 80,2 kg ») : le centième d'une moyenne n'a pas de sens. */
export function bodyWeightText(kilograms: number, system: UnitSystem): string {
  const value = Math.round(kilogramsToDisplay(kilograms, system) * 10) / 10;
  return `${formatNumber(value)} ${WEIGHT_UNITS[system].symbol}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((dayToDate(to).getTime() - dayToDate(from).getTime()) / DAY_MS);
}

/** Phrase qui résume la courbe : nom accessible de l'image, et texte visible au-dessus. */
export function trendSummary(points: readonly Point[], system: UnitSystem): string {
  const last = points.at(-1);
  const first = points[0];
  if (!last || !first) return "Aucune pesée sur la période.";
  const sentences = [`Moyenne sur 7 jours : ${bodyWeightText(last.trend_kg, system)}.`];
  if (points.length > 1) {
    const change =
      kilogramsToDisplay(last.trend_kg, system) - kilogramsToDisplay(first.trend_kg, system);
    const rounded = Math.round(change * 10) / 10;
    const unit = WEIGHT_UNITS[system].symbol;
    sentences.push(
      rounded === 0
        ? "Stable sur la période."
        : `${rounded > 0 ? "+" : "−"}${formatNumber(Math.abs(rounded))} ${unit} sur la période.`,
    );
  }
  return sentences.join(" ");
}

export interface WeightChartProps {
  points: readonly Point[];
  /** Premier et dernier jour de la période (`AAAA-MM-JJ`) : bornes de l'axe du temps. */
  start: string;
  end: string;
  system: UnitSystem;
}

/**
 * Courbe du poids : un point par pesée, un trait pour la moyenne sur 7 jours (forme, pas
 * seulement couleur). SVG fait main, sans attribut `style` (CSP) ; le tableau des pesées en
 * est l'alternative complète.
 */
export function WeightChart({ points, start, end, system }: WeightChartProps) {
  const values = points.flatMap((p) => [
    kilogramsToDisplay(p.weight_kg, system),
    kilogramsToDisplay(p.trend_kg, system),
  ]);
  // Bornes entières, avec une marge : la courbe ne touche jamais le cadre.
  const low = Math.floor(Math.min(...values) - 0.5);
  const high = Math.ceil(Math.max(...values) + 0.5);
  const span = Math.max(1, daysBetween(start, end));
  const x = (day: string) => (daysBetween(start, day) / span) * WIDTH;
  const y = (kg: number) =>
    HEIGHT - ((kilogramsToDisplay(kg, system) - low) / (high - low)) * HEIGHT;
  const trend = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)} ${y(p.trend_kg).toFixed(1)}`)
    .join(" ");
  // Un point = un trait de longueur nulle aux bouts arrondis : reste rond malgré l'étirement.
  const dots = points
    .map((p) => `M${x(p.date).toFixed(1)} ${y(p.weight_kg).toFixed(1)}h0`)
    .join(" ");
  const unit = WEIGHT_UNITS[system].symbol;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-[17px] font-bold">{trendSummary(points, system)}</figcaption>
      {points.length > 0 && (
        <>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
            <div
              aria-hidden="true"
              className="text-ink-muted flex flex-col justify-between text-right text-sm tabular-nums"
            >
              <span>{`${formatNumber(high)} ${unit}`}</span>
              <span>{`${formatNumber(low)} ${unit}`}</span>
            </div>
            <svg
              role="img"
              aria-label="Courbe du poids sur la période"
              viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
              preserveAspectRatio="none"
              className="border-line h-44 w-full overflow-visible border-b border-l"
            >
              <path
                d={dots}
                vectorEffect="non-scaling-stroke"
                className="stroke-ink-muted fill-none stroke-[7] [stroke-linecap:round]"
              />
              <path
                d={trend}
                vectorEffect="non-scaling-stroke"
                className="stroke-ink fill-none stroke-[2.5] [stroke-linejoin:round]"
              />
            </svg>
            <span aria-hidden="true" />
            <div aria-hidden="true" className="text-ink-muted flex justify-between text-sm">
              <span>{shortDay(start)}</span>
              <span>{shortDay(end)}</span>
            </div>
          </div>
          <p className="text-ink-muted text-sm">Points : pesées. Trait : moyenne sur 7 jours.</p>
        </>
      )}
    </figure>
  );
}
