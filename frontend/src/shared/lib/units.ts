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
