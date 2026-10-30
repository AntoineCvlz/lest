import type { Schemas } from "@/shared/api/client";
import { formatNumber } from "@/shared/lib/number";
import { kilogramsToDisplay, WEIGHT_UNITS, type UnitSystem } from "@/shared/lib/units";

export const RECORD_LABELS = { weight: "charge max", e1rm: "1RM estimé" } as const;

/** Charge stockée en kilos, affichée dans l'unité du profil (« 82,5 kg », « 225 lb »). */
export function weightText(kilograms: number, system: UnitSystem): string {
  return `${formatNumber(kilogramsToDisplay(kilograms, system))} ${WEIGHT_UNITS[system].symbol}`;
}

/** Série courte : « 80 kg × 8 ». */
export function setText(one: Schemas["SetOut"], system: UnitSystem): string {
  return `${weightText(one.weight_kg, system)} × ${String(one.reps)}`;
}

/** Série détaillée : « Série 2 : 80 kg × 8, RPE 8,5, échauffement ». */
export function setLine(one: Schemas["SetOut"], number: number, system: UnitSystem): string {
  return [
    `Série ${String(number)} : ${setText(one, system)}`,
    one.rpe === null ? null : `RPE ${formatNumber(one.rpe)}`,
    one.is_warmup ? "échauffement" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Records établis par une série : « Record : 1RM estimé, charge max ». */
export function recordsLine(one: Schemas["SetOut"]): string {
  return `Record : ${one.records.map((record) => RECORD_LABELS[record.kind]).join(", ")}`;
}

/** Durée d'une séance : « 45 min », « 1 h 05 ». */
export function durationText(startedAt: string, endedAt: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000));
  if (minutes < 60) return `${String(minutes)} min`;
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60).padStart(2, "0")}`;
}
