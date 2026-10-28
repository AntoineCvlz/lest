import { z } from "zod";

import type { Schemas } from "@/shared/api/client";
import {
  centimetresToMetres,
  feetInchesToMetres,
  metresToCentimetres,
  metresToFeetInches,
} from "@/shared/lib/units";

type ProfileIn = Schemas["ProfileIn"];

// Bornes du modèle `Profile` (backend/apps/accounts/models.py), rappelées dans les messages.
const MIN_HEIGHT_M = 1;
const MAX_HEIGHT_M = 2.5;
const METRIC_RANGE = "Saisissez une taille entre 100 et 250 cm.";
const IMPERIAL_RANGE = "Saisissez une taille entre 3 ft 4 in et 8 ft 2 in.";
const WHOLE_NUMBER = /^\d+$/;

const GOALS = ["gain", "maintain", "cut"] as const satisfies readonly ProfileIn["goal"][];
const UNIT_SYSTEMS = ["metric", "imperial"] as const satisfies readonly ProfileIn["unit_system"][];

/** Valeurs du formulaire : la taille est saisie en texte, dans le système d'unités choisi. */
export interface ProfileFormValues {
  goal: ProfileIn["goal"];
  unit_system: ProfileIn["unit_system"];
  height_cm: string;
  feet: string;
  inches: string;
}

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : null;
}

/** Taille en mètres saisie dans le système choisi, ou `null` si elle est invalide. */
export function heightInMetres(values: ProfileFormValues): number | null {
  let metres: number | null = null;
  if (values.unit_system === "metric") {
    const centimetres = wholeNumber(values.height_cm);
    metres = centimetres === null ? null : centimetresToMetres(centimetres);
  } else {
    const feet = wholeNumber(values.feet);
    const inches = values.inches.trim() === "" ? 0 : wholeNumber(values.inches);
    const valid = feet !== null && inches !== null && inches < 12;
    metres = valid ? feetInchesToMetres(feet, inches) : null;
  }
  return metres !== null && metres >= MIN_HEIGHT_M && metres <= MAX_HEIGHT_M ? metres : null;
}

// Les contrôles de taille s'exécutent même si un autre champ est invalide (`when`) : toutes les
// erreurs du formulaire s'affichent ensemble, pas l'une après l'autre.
const ALWAYS = { when: () => true };

export const profileFormSchema = z
  .object({
    goal: z.enum(GOALS, { error: "Choisissez un objectif." }),
    unit_system: z.enum(UNIT_SYSTEMS),
    height_cm: z.string(),
    feet: z.string(),
    inches: z.string(),
  })
  .refine((values) => values.unit_system !== "metric" || heightInMetres(values) !== null, {
    ...ALWAYS,
    path: ["height_cm"],
    message: METRIC_RANGE,
  })
  .refine((values) => values.unit_system !== "imperial" || heightInMetres(values) !== null, {
    ...ALWAYS,
    path: ["feet"],
    message: IMPERIAL_RANGE,
  });

/** Corps de `PUT /api/v1/me/profile/` ; à appeler sur des valeurs validées. */
export function toPayload(values: ProfileFormValues): ProfileIn {
  const height_m = heightInMetres(values);
  if (height_m === null) throw new Error("toPayload() appelé sur une taille invalide.");
  return { goal: values.goal, unit_system: values.unit_system, height_m };
}

/** Valeurs initiales : la taille est pré-remplie dans les deux systèmes d'unités. */
export function defaultsFrom(profile: ProfileIn | undefined): Partial<ProfileFormValues> {
  if (!profile) return { unit_system: "metric", height_cm: "", feet: "", inches: "" };
  const { feet, inches } = metresToFeetInches(profile.height_m);
  return {
    goal: profile.goal,
    unit_system: profile.unit_system,
    height_cm: String(metresToCentimetres(profile.height_m)),
    feet: String(feet),
    inches: String(inches),
  };
}
