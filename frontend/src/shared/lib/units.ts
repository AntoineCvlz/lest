/**
 * Conversions des tailles, stockées en mètres (unités SI) et affichées en centimètres ou en
 * pieds et pouces. Le stockage est au centimètre : les conversions arrondissent à cette précision.
 */

const METRES_PER_INCH = 0.0254;
const INCHES_PER_FOOT = 12;

/** Arrondi à `decimals` décimales, sans l'erreur flottante (1,005 × 100 vaut 100,4999…). */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(Number((value * factor).toFixed(6))) / factor;
}

export function metresToCentimetres(metres: number): number {
  return round(metres * 100, 0);
}

export function centimetresToMetres(centimetres: number): number {
  return round(centimetres / 100, 2);
}

export function feetInchesToMetres(feet: number, inches: number): number {
  return round((feet * INCHES_PER_FOOT + inches) * METRES_PER_INCH, 2);
}

/** Pieds et pouces entiers les plus proches (jamais 12 pouces : 5 ft 12 in devient 6 ft 0 in). */
export function metresToFeetInches(metres: number): { feet: number; inches: number } {
  const totalInches = Math.round(metres / METRES_PER_INCH);
  return { feet: Math.floor(totalInches / INCHES_PER_FOOT), inches: totalInches % INCHES_PER_FOOT };
}

/** Système d'unités du profil : charges en kilos (métrique) ou en livres (impérial). */
export type UnitSystem = "metric" | "imperial";

const KILOGRAMS_PER_POUND = 0.45359237;

/** Unité de charge affichée, et pas des boutons ±. */
export const WEIGHT_UNITS = {
  metric: { symbol: "kg", name: "kilos", step: 2.5 },
  imperial: { symbol: "lb", name: "livres", step: 5 },
} as const;

/** Charge stockée (kg) dans l'unité du profil : au centième de kilo, au dixième de livre. */
export function kilogramsToDisplay(kilograms: number, system: UnitSystem): number {
  return system === "metric" ? round(kilograms, 2) : round(kilograms / KILOGRAMS_PER_POUND, 1);
}

/** Charge saisie dans l'unité du profil, en kilos au centième (précision du stockage). */
export function displayToKilograms(value: number, system: UnitSystem): number {
  return system === "metric" ? round(value, 2) : round(value * KILOGRAMS_PER_POUND, 2);
}
