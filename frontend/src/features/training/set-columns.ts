import type { Schemas } from "@/shared/api/client";
import {
  displayToKilograms,
  distanceToMetres,
  kilogramsToDisplay,
  metresToDistance,
  type UnitSystem,
} from "@/shared/lib/units";

export type ExerciseKind = Schemas["WorkoutExerciseDetailOut"]["exercise_kind"];
export type Column = "weight" | "reps" | "duration" | "distance";
type SetOut = Schemas["SetOut"];

/**
 * Colonnes d'une série selon le type de l'exercice : le miroir de `training.measures.COLUMNS`
 * côté API (ADR 0017), qui reste seule juge (422 sinon). Ordre d'affichage.
 */
export const COLUMNS: Readonly<Record<ExerciseKind, readonly Column[]>> = {
  weight_reps: ["weight", "reps"],
  reps: ["reps"],
  weighted_reps: ["weight", "reps"],
  assisted_reps: ["weight", "reps"],
  duration: ["duration"],
  distance_duration: ["distance", "duration"],
  weight_distance: ["weight", "distance"],
};

/** Nom de la charge selon le type : le lest d'une traction lestée, l'aide d'une assistée. */
export const WEIGHT_LABELS: Readonly<Record<ExerciseKind, string>> = {
  weight_reps: "Charge",
  reps: "Charge",
  weighted_reps: "Lest",
  assisted_reps: "Assistance",
  duration: "Charge",
  distance_duration: "Charge",
  weight_distance: "Charge",
};

/** Distance facultative (course sur tapis sans distance notée) : 0 veut dire « non notée ». */
export function distanceIsOptional(kind: ExerciseKind): boolean {
  return kind === "distance_duration";
}

/**
 * Unité de la distance saisie : kilomètres ou miles pour le cardio, mètres pour un portage
 * (quelques dizaines de mètres, dans les deux systèmes d'unités).
 */
export function distanceUnit(
  kind: ExerciseKind,
  system: UnitSystem,
): { symbol: string; name: string; stepName: string; step: number; max: number } {
  if (kind === "weight_distance") {
    return { symbol: "m", name: "mètres", stepName: "mètres", step: 5, max: 1000 };
  }
  return system === "metric"
    ? { symbol: "km", name: "kilomètres", stepName: "kilomètre", step: 0.1, max: 1000 }
    : { symbol: "mi", name: "miles", stepName: "mile", step: 0.1, max: 621 };
}

/** Valeurs du formulaire de série, dans les unités affichées. */
export interface Measures {
  weight: number;
  reps: number;
  minutes: number;
  seconds: number;
  distance: number;
}

/** Valeurs de départ sans historique, selon le type. */
export function defaultMeasures(kind: ExerciseKind, system: UnitSystem): Measures {
  return {
    // Barre olympique à vide pour une charge ; rien pour un lest ou une assistance.
    weight: kind === "weight_reps" ? (system === "metric" ? 20 : 45) : 0,
    reps: 8,
    // Gainage d'une minute ; une demi-heure de cardio.
    minutes: kind === "duration" ? 1 : 30,
    seconds: 0,
    distance: kind === "weight_distance" ? 20 : 0,
  };
}

function round(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Valeurs d'une série enregistrée, pour la reprendre (modifier, ou pré-remplir la suivante). */
export function measuresOf(
  one: SetOut,
  kind: ExerciseKind,
  system: UnitSystem,
  fallback: Measures,
): Measures {
  const unit = distanceUnit(kind, system);
  const distance =
    one.distance_m === null
      ? fallback.distance
      : kind === "weight_distance"
        ? one.distance_m
        : round(metresToDistance(one.distance_m, system), 0.01);
  return {
    weight: one.weight_kg === null ? fallback.weight : kilogramsToDisplay(one.weight_kg, system),
    reps: one.reps ?? fallback.reps,
    minutes: one.duration_s === null ? fallback.minutes : Math.floor(one.duration_s / 60),
    seconds: one.duration_s === null ? fallback.seconds : one.duration_s % 60,
    distance: Math.min(distance, unit.max),
  };
}

/** Colonnes envoyées à l'API : celles du type seulement, les autres à `null`. */
export function measuresToSet(
  values: Measures,
  kind: ExerciseKind,
  system: UnitSystem,
): {
  weightKg: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
} {
  const columns = COLUMNS[kind];
  const metres =
    kind === "weight_distance" ? values.distance : distanceToMetres(values.distance, system);
  return {
    weightKg: columns.includes("weight") ? displayToKilograms(values.weight, system) : null,
    reps: columns.includes("reps") ? values.reps : null,
    durationS: columns.includes("duration") ? values.minutes * 60 + values.seconds : null,
    distanceM:
      !columns.includes("distance") || (distanceIsOptional(kind) && values.distance === 0)
        ? null
        : Math.round(metres * 10) / 10,
  };
}
