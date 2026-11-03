"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useProfile } from "@/features/profile/use-profile";
import type { Schemas } from "@/shared/api/client";
import { formatNumber, parseDecimal } from "@/shared/lib/number";
import { LENGTH_UNITS, lengthToMetres, metresToLength, type UnitSystem } from "@/shared/lib/units";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import { localDay, longDay, shortDay } from "./days";
import { type MeasurementChange, useMeasurements, useSaveMeasurements } from "./use-measurements";
import { type Site, SITES } from "./sites";

type Row = Schemas["MeasurementOut"];

export const MEASUREMENTS_UNAVAILABLE = "Mensurations indisponibles pour le moment.";
export const MEASUREMENTS_NOT_SAVED =
  "Mensurations non enregistrées, en tout ou partie. Vérifiez la connexion, puis réessayez.";
export const NO_MEASUREMENT =
  "Aucune mensuration sur l’année. Mesurez-vous au même moment de la journée, ruban à plat, sans serrer.";
export const NOTHING_CHANGED = "Aucune mesure modifiée.";

const EARLIEST = "2000-01-01";

// Bornes de l'API (10 cm à 2,50 m), dans l'unité affichée.
const LIMITS = {
  metric: { min: 10, max: 250 },
  imperial: { min: 4, max: 98 },
} as const;

type Texts = Partial<Record<Site, string>>;

// Espace insécable : un nombre ne se sépare jamais de son unité ni de son libellé.
const NBSP = " ";

/** « 38,5 cm » : une mensuration dans l'unité du profil. */
export function lengthText(metres: number, system: UnitSystem): string {
  return `${formatNumber(metresToLength(metres, system))}${NBSP}${LENGTH_UNITS[system].symbol}`;
}

/** « +1,5 cm depuis le 3 nov. » : évolution entre la première et la dernière mesure. */
export function changeText(first: Row, last: Row, system: UnitSystem): string | null {
  if (first.date === last.date) return null;
  const delta =
    Math.round(
      (metresToLength(last.length_m, system) - metresToLength(first.length_m, system)) * 10,
    ) / 10;
  const amount =
    delta === 0
      ? "stable"
      : `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))}${NBSP}${LENGTH_UNITS[system].symbol}`;
  return `${amount} depuis le ${shortDay(first.date)}`;
}

/**
 * Mensurations : saisie du jour (seulement les endroits mesurés, un champ vidé supprime la mesure),
 * dernière valeur et évolution par endroit, historique par date avec correction.
 */
export function MeasurementJournal() {
  const hydrated = useHydrated();
  const profile = useProfile();
  const system = profile.data?.unit_system ?? "metric";
  const unit = LENGTH_UNITS[system];
  const limits = LIMITS[system];
  const measurements = useMeasurements();
  const save = useSaveMeasurements();
  const today = localDay();
  const [day, setDay] = useState(today);
  // `null` : pas encore touché, les champs montrent les mesures déjà notées ce jour-là.
  const [texts, setTexts] = useState<Texts | null>(null);
  const [invalid, setInvalid] = useState<Site[]>([]);
  const [invalidDate, setInvalidDate] = useState(false);
  const [notice, setNotice] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const rows = measurements.data ?? [];
  const ofDay = new Map(rows.filter((r) => r.date === day).map((r) => [r.site, r]));
  const bySite = new Map<Site, Row[]>(SITES.map((s) => [s.value, []]));
  for (const row of rows) bySite.get(row.site)?.push(row);
  const dates = [...new Set(rows.map((r) => r.date))].toSorted().toReversed();

  function shown(site: Site): string {
    const typed = texts?.[site];
    if (typed !== undefined) return typed;
    const existing = ofDay.get(site);
    return existing ? formatNumber(metresToLength(existing.length_m, system)) : "";
  }

  function focus(selector: string) {
    formRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }

  function edit(date: string) {
    flushSync(() => {
      save.reset();
      setDay(date);
      setTexts(null);
      setInvalid([]);
      setInvalidDate(false);
      setNotice(`Modification des mensurations du ${longDay(date)}.`);
    });
    focus("input[name=neck]");
  }

  return (
    <div className="flex flex-col gap-10">
      <form
        ref={formRef}
        method="post"
        noValidate
        aria-labelledby="measure-title"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.reset();
          setNotice("");
          const changes: MeasurementChange[] = [];
          const faults: Site[] = [];
          for (const { value: site } of SITES) {
            const text = shown(site).trim();
            const existing = ofDay.get(site);
            if (text === "") {
              if (existing) changes.push({ site, metres: null });
              continue;
            }
            const value = parseDecimal(text);
            if (value === null || value < limits.min || value > limits.max) {
              faults.push(site);
              continue;
            }
            // Comparaison dans l'unité affichée : l'aller-retour en pouces (0,385 m → 15,2 in →
            // 0,386 m) ne doit pas réécrire une mesure inchangée.
            if (!existing || metresToLength(existing.length_m, system) !== value) {
              changes.push({ site, metres: lengthToMetres(value, system) });
            }
          }
          const dateFault = day < EARLIEST || day > today;
          flushSync(() => {
            setInvalid(faults);
            setInvalidDate(dateFault);
          });
          const [firstFault] = faults;
          if (firstFault || dateFault) {
            focus(firstFault ? `input[name=${firstFault}]` : "input[name=day]");
            return;
          }
          if (changes.length === 0) {
            setNotice(NOTHING_CHANGED);
            return;
          }
          save.mutate(
            { day, changes },
            {
              onSuccess: () => {
                setTexts(null);
                setDay(today);
                setNotice(`Mensurations du ${longDay(day)} enregistrées.`);
              },
            },
          );
        }}
      >
        <h2 id="measure-title" className="text-xl font-extrabold [font-stretch:112%]">
          {day === today ? "Mensurations du jour" : `Mensurations du ${longDay(day)}`}
        </h2>
        <p className="text-ink-muted text-sm">
          {`En ${unit.name}. Remplissez seulement ce que vous avez mesuré ; videz un champ pour retirer sa mesure.`}
        </p>
        <TextField
          label="Date"
          name="day"
          type="date"
          min={EARLIEST}
          max={today}
          value={day}
          error={
            invalidDate
              ? "Choisissez une date entre le 1er janvier 2000 et aujourd’hui."
              : undefined
          }
          onChange={(event) => {
            if (event.target.value) setDay(event.target.value);
            setTexts(null);
            setNotice("");
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          {SITES.map(({ value: site, label }) => {
            const last = bySite.get(site)?.at(-1);
            return (
              <TextField
                key={site}
                label={`${label} (${unit.symbol})`}
                name={site}
                inputMode="decimal"
                autoComplete="off"
                value={shown(site)}
                hint={
                  last && last.date !== day
                    ? `Dernière : ${lengthText(last.length_m, system)}, le ${shortDay(last.date)}`
                    : undefined
                }
                error={
                  invalid.includes(site)
                    ? `Entre ${String(limits.min)} et ${String(limits.max)} ${unit.symbol}.`
                    : undefined
                }
                onChange={(event) => {
                  const text = event.target.value;
                  setTexts((current) => ({ ...current, [site]: text }));
                  setNotice("");
                }}
              />
            );
          })}
        </div>
        <div role="alert" className="empty:hidden">
          {save.isError && (
            <p className="rounded-control border-danger text-danger border p-4 font-semibold">
              {MEASUREMENTS_NOT_SAVED}
            </p>
          )}
        </div>
        <p aria-live="polite" className="text-ink-muted empty:hidden">
          {notice}
        </p>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!hydrated || save.isPending}
        >
          Enregistrer les mesures
        </Button>
      </form>

      <section
        aria-labelledby="progress-title"
        aria-busy={measurements.isFetching}
        className="flex flex-col gap-5"
      >
        <h2 id="progress-title" className="text-xl font-extrabold [font-stretch:112%]">
          Évolution sur l’année
        </h2>
        {measurements.isPending && <p className="text-ink-muted">Chargement des mensurations…</p>}
        {measurements.isError && (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-danger font-semibold">{MEASUREMENTS_UNAVAILABLE}</p>
            <Button
              variant="secondary"
              onClick={() => {
                void measurements.refetch();
              }}
            >
              Réessayer
            </Button>
          </div>
        )}
        {measurements.isSuccess &&
          (rows.length === 0 ? (
            <p className="text-ink-muted">{NO_MEASUREMENT}</p>
          ) : (
            <>
              <dl className="border-line-subtle border-t">
                {SITES.map(({ value: site, label }) => {
                  const series = bySite.get(site) ?? [];
                  const first = series[0];
                  const last = series.at(-1);
                  if (!first || !last) return null;
                  const change = changeText(first, last, system);
                  return (
                    <div
                      key={site}
                      className="border-line-subtle flex flex-wrap items-baseline justify-between gap-x-4 border-b py-3"
                    >
                      <dt className="font-semibold">{label}</dt>
                      <dd className="tabular-nums">
                        <span className="text-[17px] font-bold">
                          {lengthText(last.length_m, system)}
                        </span>
                        {change && <span className="text-ink-muted text-sm">{`, ${change}`}</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <h3 className="text-ink-muted text-sm font-semibold">Historique</h3>
              <ul aria-label="Mensurations par date" className="border-line-subtle border-t">
                {dates.map((date) => (
                  <li
                    key={date}
                    className="border-line-subtle flex items-center justify-between gap-3 border-b py-2"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold">{longDay(date)}</span>
                      <span className="text-ink-muted text-sm tabular-nums">
                        {SITES.flatMap(({ value: site, label }) => {
                          const row = rows.find((r) => r.date === date && r.site === site);
                          return row ? [`${label}${NBSP}${lengthText(row.length_m, system)}`] : [];
                        }).join(", ")}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      aria-label={`Modifier les mensurations du ${longDay(date)}`}
                      onClick={() => {
                        edit(date);
                      }}
                    >
                      Modifier
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ))}
      </section>
    </div>
  );
}
