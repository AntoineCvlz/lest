import type { Schemas } from "@/shared/api/client";
import { formatNumber } from "@/shared/lib/number";
import { kilogramsToDisplay, WEIGHT_UNITS, type UnitSystem } from "@/shared/lib/units";

export const RECORD_LABELS = {
  weight: "charge max",
  e1rm: "1RM estimé",
  volume: "volume d'une série",
  reps: "répétitions max",
  duration: "durée max",
  distance: "distance max",
} as const;

type Record = Schemas["RecordOut"];

/** Charge stockée en kilos, affichée dans l'unité du profil (« 82,5 kg », « 225 lb »). */
export function weightText(kilograms: number, system: UnitSystem): string {
  return `${formatNumber(kilogramsToDisplay(kilograms, system))} ${WEIGHT_UNITS[system].symbol}`;
}

/** Durée d'un effort : « 45 s », « 2:30 », « 1:05:00 ». */
export function effortDurationText(seconds: number): string {
  if (seconds < 60) return `${String(seconds)} s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${String(minutes)}:${rest}`;
}

/** Distance : « 400 m », « 5,2 km ». */
export function distanceText(meters: number): string {
  return meters < 1000 ? `${formatNumber(meters)} m` : `${formatNumber(meters / 1000)} km`;
}

/** Série courte, selon ce qu'elle mesure (ADR 0017) : « 80 kg × 8 », « 12 reps », « 5 km en 25:00 ». */
export function setText(one: Schemas["SetOut"], system: UnitSystem): string {
  const load = one.weight_kg === null ? null : weightText(one.weight_kg, system);
  if (one.reps !== null) {
    return load === null ? `${String(one.reps)} reps` : `${load} × ${String(one.reps)}`;
  }
  const parts = [
    one.distance_m === null ? null : distanceText(one.distance_m),
    load,
    one.duration_s === null ? null : effortDurationText(one.duration_s),
  ].filter((part) => part !== null);
  return parts.join(one.duration_s !== null && one.distance_m !== null ? " en " : ", ");
}

/** Valeur d'un record dans son unité : « 82,5 kg », « 12 reps », « 2:30 », « 5 km ». */
export function recordValueText(record: Record, system: UnitSystem): string {
  switch (record.kind) {
    case "reps":
      return `${String(record.value)} reps`;
    case "duration":
      return effortDurationText(record.value);
    case "distance":
      return distanceText(record.value);
    default:
      return weightText(record.value, system);
  }
}

/** Série détaillée : « Série 2 : 80 kg × 8, RPE 8,5, échauffement ». */
export function setLine(one: Schemas["SetOut"], number: number, system: UnitSystem): string {
  return [
    `Série ${String(number)} : ${setText(one, system)}`,
    one.rpe === null ? null : `RPE ${formatNumber(one.rpe)}`,
    one.set_type === "warmup" ? "échauffement" : null,
    one.set_type === "drop" ? "dégressive" : null,
    one.set_type === "failure" ? "à l'échec" : null,
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
