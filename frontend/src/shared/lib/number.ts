export interface StepOptions {
  step: number;
  min?: number;
  max?: number;
}

/** Nombre de décimales d'un nombre (2,5 → 1 ; 1,25 → 2), pour arrondir les calculs flottants. */
function decimalsOf(n: number): number {
  const [, fraction = ""] = String(n).split(".");
  return fraction.length;
}

/**
 * Ajoute `direction` pas à `value`, borné par `min`/`max`, sans erreur d'arrondi flottant
 * (0,1 + 0,2 doit valoir 0,3, pas 0,30000000000000004).
 */
export function stepValue(
  value: number,
  direction: 1 | -1,
  { step, min, max }: StepOptions,
): number {
  const precision = 10 ** Math.max(decimalsOf(value), decimalsOf(step));
  const next = Math.round((value + direction * step) * precision) / precision;
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next));
}

const FRENCH_NUMBER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Format français : virgule décimale, espace insécable pour les milliers, pas de zéros inutiles. */
export function formatNumber(value: number): string {
  return FRENCH_NUMBER.format(value);
}
