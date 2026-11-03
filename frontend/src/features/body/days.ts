/**
 * Jours calendaires au format de l'API (`AAAA-MM-JJ`), dans le fuseau de l'appareil : une pesée
 * du matin appartient au jour où l'on se pèse, pas au jour UTC.
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Jour local de `moment` (aujourd'hui par défaut). */
export function localDay(moment: Date = new Date()): string {
  return `${String(moment.getFullYear())}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`;
}

/** Date locale à minuit d'un jour `AAAA-MM-JJ` (jamais `new Date("AAAA-MM-JJ")`, lu en UTC). */
export function dayToDate(day: string): Date {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

/** Jour décalé de `days` jours (négatif : dans le passé). */
export function shiftDay(day: string, days: number): string {
  const moment = dayToDate(day);
  moment.setDate(moment.getDate() + days);
  return localDay(moment);
}

const SHORT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const LONG = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** « 3 nov. » : colonnes et axes. */
export function shortDay(day: string): string {
  return SHORT.format(dayToDate(day));
}

/** « 3 novembre 2026 » : messages. */
export function longDay(day: string): string {
  return LONG.format(dayToDate(day));
}
