"use client";

import { useRef, useState } from "react";

import { useProfile } from "@/features/profile/use-profile";
import { formatNumber } from "@/shared/lib/number";
import { displayToKilograms, kilogramsToDisplay, WEIGHT_UNITS } from "@/shared/lib/units";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { ChoiceGroup } from "@/shared/ui/choice-group";
import { TextField } from "@/shared/ui/text-field";

import { localDay, longDay, shiftDay, shortDay } from "./days";
import {
  PERIODS,
  type PeriodDays,
  useDeleteWeight,
  useSaveWeight,
  useWeights,
} from "./use-weights";
import { bodyWeightText, WeightChart } from "./weight-chart";

export const WEIGHTS_UNAVAILABLE = "Pesées indisponibles pour le moment.";
export const WEIGHT_NOT_SAVED = "Pesée non enregistrée. Vérifiez la connexion, puis réessayez.";
export const WEIGHT_NOT_DELETED = "Pesée non supprimée. Réessayez dans un instant.";
export const NO_WEIGHT =
  "Aucune pesée sur la période. Pesez-vous le matin, à jeun, pour une courbe régulière.";

// Bornes de l'API (20 à 400 kg), dans l'unité affichée.
const LIMITS = {
  metric: { min: 20, max: 400 },
  imperial: { min: 45, max: 880 },
} as const;

/** Nombre saisi au format français (« 81,4 ») ou anglais (« 81.4 »), sinon `null`. */
export function parseWeight(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

/**
 * Journal du poids : pesée du jour (pré-remplie avec la dernière), courbe et moyenne sur 7 jours,
 * tableau des pesées de la période (alternative à la courbe), correction et suppression.
 */
export function WeightJournal() {
  const hydrated = useHydrated();
  const profile = useProfile();
  const system = profile.data?.unit_system ?? "metric";
  const unit = WEIGHT_UNITS[system];
  const [days, setDays] = useState<PeriodDays>(30);
  const weights = useWeights(days);
  const save = useSaveWeight();
  const remove = useDeleteWeight();
  const today = localDay();
  const [day, setDay] = useState(today);
  // `null` : pas encore touché, le champ montre la dernière pesée.
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const points = weights.data ?? [];
  const latest = points.at(-1);
  const shown = text ?? (latest ? formatNumber(kilogramsToDisplay(latest.weight_kg, system)) : "");
  const existing = points.find((p) => p.date === day);
  const limits = LIMITS[system];

  function reset(message: string) {
    setNotice(message);
    setText(null);
    setDay(today);
    setInvalid(false);
    setConfirming(false);
  }

  function edit(date: string, kilograms: number) {
    setDay(date);
    setText(formatNumber(kilogramsToDisplay(kilograms, system)));
    setInvalid(false);
    setConfirming(false);
    setNotice("");
    formRef.current?.querySelector<HTMLInputElement>("input[name=weight]")?.focus();
  }

  return (
    <div className="flex flex-col gap-10">
      <form
        ref={formRef}
        method="post"
        noValidate
        className="flex flex-col gap-4"
        aria-labelledby="weigh-in-title"
        onSubmit={(event) => {
          event.preventDefault();
          const value = parseWeight(shown);
          if (value === null || value < limits.min || value > limits.max) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          save.mutate(
            { day, kilograms: displayToKilograms(value, system) },
            {
              onSuccess: () => {
                reset(`Pesée du ${longDay(day)} enregistrée.`);
              },
            },
          );
        }}
      >
        <h2 id="weigh-in-title" className="text-xl font-extrabold [font-stretch:112%]">
          {day === today ? "Pesée du jour" : `Pesée du ${longDay(day)}`}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={`Poids (${unit.symbol})`}
            name="weight"
            inputMode="decimal"
            autoComplete="off"
            value={shown}
            error={
              invalid
                ? `Saisissez un poids entre ${String(limits.min)} et ${String(limits.max)} ${unit.symbol}.`
                : undefined
            }
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <TextField
            label="Date"
            type="date"
            min="2000-01-01"
            max={today}
            value={day}
            onChange={(event) => {
              // Champ vidé par le sélecteur : on garde le jour précédent.
              if (event.target.value) setDay(event.target.value);
              setConfirming(false);
            }}
          />
        </div>
        <div role="alert" className="empty:hidden">
          {(save.isError || remove.isError) && (
            <p className="rounded-control border-danger text-danger border p-4 font-semibold">
              {save.isError ? WEIGHT_NOT_SAVED : WEIGHT_NOT_DELETED}
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
          disabled={!hydrated || save.isPending || shown.trim() === ""}
        >
          Enregistrer la pesée
        </Button>
        {existing &&
          (confirming ? (
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(day, {
                    onSuccess: () => {
                      reset(`Pesée du ${longDay(day)} supprimée.`);
                    },
                  });
                }}
              >
                Confirmer la suppression
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Garder
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {`Supprimer la pesée du ${shortDay(day)}`}
            </Button>
          ))}
      </form>

      <section aria-labelledby="trend-title" className="flex flex-col gap-5">
        <h2 id="trend-title" className="text-xl font-extrabold [font-stretch:112%]">
          Tendance
        </h2>
        <ChoiceGroup
          legend="Période"
          options={PERIODS}
          value={days}
          onChange={setDays}
          layout="row"
        />
        {weights.isPending && <p className="text-ink-muted">Chargement des pesées…</p>}
        {weights.isError && (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-danger font-semibold">{WEIGHTS_UNAVAILABLE}</p>
            <Button
              variant="secondary"
              onClick={() => {
                void weights.refetch();
              }}
            >
              Réessayer
            </Button>
          </div>
        )}
        {weights.isSuccess &&
          (points.length === 0 ? (
            <p className="text-ink-muted">{NO_WEIGHT}</p>
          ) : (
            <>
              <WeightChart
                points={points}
                start={shiftDay(today, -(days - 1))}
                end={today}
                system={system}
              />
              <table className="w-full border-collapse text-left tabular-nums">
                <caption className="text-ink-muted pb-2 text-left text-sm">
                  Pesées de la période, les plus récentes d’abord
                </caption>
                <thead>
                  <tr className="border-line-subtle text-ink-muted border-b text-sm">
                    <th scope="col" className="py-2 font-semibold">
                      Date
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      Poids
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      Moyenne 7 j
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {points.toReversed().map((p) => (
                    <tr key={p.date} className="border-line-subtle border-b">
                      <th scope="row" className="py-1 font-semibold">
                        {shortDay(p.date)}
                      </th>
                      <td className="py-1">{bodyWeightText(p.weight_kg, system)}</td>
                      <td className="text-ink-muted py-1">{bodyWeightText(p.trend_kg, system)}</td>
                      <td className="py-1 text-right">
                        <Button
                          variant="ghost"
                          aria-label={`Modifier la pesée du ${longDay(p.date)}`}
                          onClick={() => {
                            edit(p.date, p.weight_kg);
                          }}
                        >
                          Modifier
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ))}
      </section>
    </div>
  );
}
