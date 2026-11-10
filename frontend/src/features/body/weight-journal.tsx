"use client";

import { onlineManager } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { PendingWrites } from "@/features/offline/pending-writes";
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
} from "./use-weights";
import { bodyWeightText, WeightChart } from "./weight-chart";

export const WEIGHTS_UNAVAILABLE = "Pesées indisponibles pour le moment.";
export const WEIGHTS_OFFLINE =
  "Hors ligne : la courbe s’affichera au retour du réseau. Une pesée notée est gardée sur cet appareil.";
export const NO_WEIGHT =
  "Aucune pesée sur la période. Pesez-vous le matin, à jeun, pour une courbe régulière.";
export const DATE_OUT_OF_RANGE = "Choisissez une date entre le 1er janvier 2000 et aujourd’hui.";

const EARLIEST = "2000-01-01";

// Bornes de l'API (20 à 400 kg), dans l'unité affichée.
const LIMITS = {
  metric: { min: 20, max: 400 },
  imperial: { min: 45, max: 880 },
} as const;

/** Hors ligne, la saisie est gardée sur l'appareil jusqu'au retour du réseau. */
function savedWhere(): string {
  return onlineManager.isOnline() ? "" : " sur cet appareil, envoi au retour du réseau";
}

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

  /** Donne le focus à un élément du formulaire, une fois le nouvel état affiché. */
  function focus(selector: string) {
    formRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }

  function clearMessages() {
    setNotice("");
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
      {/* Saisies en attente et refus du serveur (ADR 0015). */}
      <PendingWrites />
      <form
        ref={formRef}
        method="post"
        noValidate
        className="flex flex-col gap-4"
        aria-labelledby="weigh-in-title"
        onSubmit={(event) => {
          event.preventDefault();
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
          // En file (ADR 0015) : affichée tout de suite, envoyée dès que le réseau le permet.
          save.mutate({ day, kilograms: displayToKilograms(value, system) });
          reset(`Pesée du ${longDay(day)} enregistrée${savedWhere()}.`);
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
        <p aria-live="polite" className="text-ink-muted empty:sr-only">
          {notice}
        </p>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!hydrated || shown.trim() === ""}
        >
          {existing ? "Remplacer la pesée" : "Enregistrer la pesée"}
        </Button>
        {existing &&
          (confirming ? (
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="danger"
                onClick={() => {
                  remove.mutate(day);
                  flushSync(() => {
                    reset(`Pesée du ${longDay(day)} supprimée${savedWhere()}.`);
                  });
                  focus("input[name=weight]");
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
        {weights.isPending && (
          <p className="text-ink-muted">
            {/* Pas gardées hors ligne (ADR 0015) : la saisie, elle, est gardée. */}
            {weights.fetchStatus === "paused" ? WEIGHTS_OFFLINE : "Chargement des pesées…"}
          </p>
        )}
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
                      <td className="py-1 pr-2">
                        {bodyWeightText(p.weight_kg, system)}
                        {p.source === "basicfit" && (
                          <>
                            {" "}
                            <span className="text-ink-muted block text-sm">
                              (balance Basic-Fit)
                            </span>
                          </>
                        )}
                      </td>
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
