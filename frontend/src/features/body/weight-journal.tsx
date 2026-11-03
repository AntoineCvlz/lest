"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useProfile } from "@/features/profile/use-profile";
import { formatNumber, parseDecimal } from "@/shared/lib/number";
import { displayToKilograms, kilogramsToDisplay, WEIGHT_UNITS } from "@/shared/lib/units";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { ChoiceGroup } from "@/shared/ui/choice-group";
import { TextField } from "@/shared/ui/text-field";

import { localDay, longDay, shiftDay, shortDay } from "@/shared/lib/days";
import {
  PERIODS,
  type PeriodDays,
  useDeleteWeight,
  useSaveWeight,
  useWeights,
  WeightRequestFailed,
} from "./use-weights";
import { bodyWeightText, WeightChart } from "./weight-chart";

export const WEIGHTS_UNAVAILABLE = "Pesées indisponibles pour le moment.";
export const WEIGHT_NOT_SAVED = "Pesée non enregistrée. Vérifiez la connexion, puis réessayez.";
export const WEIGHT_REFUSED = "Pesée refusée : vérifiez le poids et la date.";
export const WEIGHT_NOT_DELETED = "Pesée non supprimée. Réessayez dans un instant.";
export const NO_WEIGHT =
  "Aucune pesée sur la période. Pesez-vous le matin, à jeun, pour une courbe régulière.";
export const DATE_OUT_OF_RANGE = "Choisissez une date entre le 1er janvier 2000 et aujourd’hui.";

const EARLIEST = "2000-01-01";

// Bornes de l'API (20 à 400 kg), dans l'unité affichée.
const LIMITS = {
  metric: { min: 20, max: 400 },
  imperial: { min: 45, max: 880 },
} as const;

/**
 * Journal du poids : pesée du jour (pré-remplie avec la dernière), courbe et moyenne sur 7 jours,
 * tableau des pesées de la période (alternative à la courbe), correction et suppression.
 *
 * Le focus suit chaque étape (champ fautif, confirmation, retour au formulaire) : un utilisateur
 * au clavier ou au lecteur d'écran ne repart jamais du haut de la page.
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
  // `null` : pas encore touché, le champ montre la pesée du jour choisi, sinon la dernière.
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<"weight" | "date" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const points = weights.data ?? [];
  const latest = points.at(-1);
  const existing = points.find((p) => p.date === day);
  const prefill = existing ?? latest;
  const shown =
    text ?? (prefill ? formatNumber(kilogramsToDisplay(prefill.weight_kg, system)) : "");
  const limits = LIMITS[system];
  const refused = save.error instanceof WeightRequestFailed && save.error.status === 422;

  /** Donne le focus à un élément du formulaire, une fois le nouvel état affiché. */
  function focus(selector: string) {
    formRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }

  function clearMessages() {
    setNotice("");
    save.reset();
    remove.reset();
  }

  function reset(message: string) {
    clearMessages();
    setNotice(message);
    setText(null);
    setDay(today);
    setInvalid(null);
    setConfirming(false);
  }

  function edit(date: string, kilograms: number) {
    flushSync(() => {
      clearMessages();
      setDay(date);
      setText(formatNumber(kilogramsToDisplay(kilograms, system)));
      setInvalid(null);
      setConfirming(false);
      setNotice(`Modification de la pesée du ${longDay(date)}.`);
    });
    focus("input[name=weight]");
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
          // Pas de `disabled` pendant l'envoi (le focus serait perdu) : un second envoi est ignoré.
          if (save.isPending) return;
          clearMessages();
          const value = parseDecimal(shown);
          const fault =
            value === null || value < limits.min || value > limits.max
              ? "weight"
              : day < EARLIEST || day > today
                ? "date"
                : null;
          flushSync(() => {
            setInvalid(fault);
          });
          if (fault !== null || value === null) {
            // Le message relié au champ est lu avec lui.
            focus(fault === "date" ? "input[name=day]" : "input[name=weight]");
            return;
          }
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
            hint={
              existing
                ? `Pesée déjà notée ce jour : ${bodyWeightText(existing.weight_kg, system)}, remplacée à l’enregistrement.`
                : undefined
            }
            error={
              invalid === "weight"
                ? `Saisissez un poids entre ${String(limits.min)} et ${String(limits.max)} ${unit.symbol}.`
                : undefined
            }
            onChange={(event) => {
              setText(event.target.value);
              setNotice("");
            }}
          />
          <TextField
            label="Date"
            name="day"
            type="date"
            min={EARLIEST}
            max={today}
            value={day}
            error={invalid === "date" ? DATE_OUT_OF_RANGE : undefined}
            onChange={(event) => {
              // Champ vidé par le sélecteur : on garde le jour précédent. La valeur du jour choisi
              // reprend la main sur une saisie en cours (pas de remplacement à l'aveugle).
              if (event.target.value) setDay(event.target.value);
              setText(null);
              setConfirming(false);
              setNotice("");
            }}
          />
        </div>
        <div role="alert" className="empty:hidden">
          {(save.isError || remove.isError) && (
            <p className="rounded-control border-danger text-danger border p-4 font-semibold">
              {save.isError ? (refused ? WEIGHT_REFUSED : WEIGHT_NOT_SAVED) : WEIGHT_NOT_DELETED}
            </p>
          )}
        </div>
        <p aria-live="polite" className="text-ink-muted empty:sr-only">
          {notice}
        </p>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!hydrated || shown.trim() === ""}
          aria-disabled={save.isPending}
        >
          {existing ? "Remplacer la pesée" : "Enregistrer la pesée"}
        </Button>
        {existing &&
          (confirming ? (
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="danger"
                aria-disabled={remove.isPending}
                onClick={() => {
                  if (remove.isPending) return;
                  remove.mutate(day, {
                    onSuccess: () => {
                      flushSync(() => {
                        reset(`Pesée du ${longDay(day)} supprimée.`);
                      });
                      focus("input[name=weight]");
                    },
                  });
                }}
              >
                {`Confirmer la suppression de la pesée du ${shortDay(day)}`}
              </Button>
              <Button
                variant="secondary"
                data-focus="keep"
                onClick={() => {
                  flushSync(() => {
                    setConfirming(false);
                  });
                  focus("[data-focus=delete]");
                }}
              >
                Garder
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              data-focus="delete"
              onClick={() => {
                flushSync(() => {
                  setConfirming(true);
                });
                // Le choix sans danger d'abord.
                focus("[data-focus=keep]");
              }}
            >
              {`Supprimer la pesée du ${shortDay(day)}`}
            </Button>
          ))}
      </form>

      <section
        aria-labelledby="trend-title"
        aria-busy={weights.isFetching}
        className="flex flex-col gap-5"
      >
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
                    <th scope="col" className="py-2 pr-2 font-semibold">
                      Date
                    </th>
                    <th scope="col" className="py-2 pr-2 font-semibold">
                      Poids
                    </th>
                    <th scope="col" className="py-2 pr-2 font-semibold">
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
                      <th scope="row" className="py-1 pr-2 font-semibold">
                        {shortDay(p.date)}
                      </th>
                      <td className="py-1 pr-2">{bodyWeightText(p.weight_kg, system)}</td>
                      <td className="text-ink-muted py-1 pr-2 text-sm">
                        {bodyWeightText(p.trend_kg, system)}
                      </td>
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
