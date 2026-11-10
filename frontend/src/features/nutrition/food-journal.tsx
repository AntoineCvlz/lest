"use client";

import { onlineManager } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { PendingWrites } from "@/features/offline/pending-writes";
import { localDay, longDay, shiftDay } from "@/shared/lib/days";
import { formatNumber, parseDecimal } from "@/shared/lib/number";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { Stepper } from "@/shared/ui/stepper";
import { TextField } from "@/shared/ui/text-field";

import { FoodPicker, foodLabel } from "./food-picker";
import { useTargets } from "./use-targets";
import {
  type Entry,
  type Meal,
  MEALS,
  useDayJournal,
  useAddEntry,
  useDeleteEntry,
  useSaveEntry,
  useSaveWater,
} from "./use-nutrition";

export const JOURNAL_UNAVAILABLE = "Journal indisponible pour le moment.";
const NBSP = " ";
const WATER_STEP_ML = 250;

/** « 2 450 kcal », « 182,5 g » : valeurs du journal, unités insécables. */
export function kcal(value: number): string {
  return `${formatNumber(Math.round(value))}${NBSP}kcal`;
}

export function grams(value: number): string {
  return `${formatNumber(Math.round(value * 10) / 10)}${NBSP}g`;
}

function mealLabel(meal: Meal): string {
  return MEALS.find((m) => m.value === meal)?.label ?? meal;
}

/** « au petit-déjeuner », « à la collation » : complément d'un bouton d'ajout. */
function toMeal(meal: Meal): string {
  return meal === "snack" ? "à la collation" : `au ${mealLabel(meal).toLowerCase()}`;
}

/** Hors ligne, la saisie est gardée sur l'appareil jusqu'au retour du réseau. */
function savedWhere(): string {
  return onlineManager.isOnline() ? "" : " sur cet appareil, envoi au retour du réseau";
}

/**
 * Journal alimentaire d'un jour (ADR 0010) : totaux, eau, quatre repas ; ajout depuis les
 * aliments récents, la recherche ou un code-barres ; correction de la quantité, retrait confirmé.
 * Le focus suit chaque étape, comme sur les écrans de Corps.
 */
export function FoodJournal() {
  const hydrated = useHydrated();
  const today = localDay();
  const [day, setDay] = useState(today);
  const journal = useDayJournal(day);
  const add = useAddEntry();
  const save = useSaveEntry();
  const remove = useDeleteEntry();
  const water = useSaveWater();
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editGrams, setEditGrams] = useState("");
  // Erreur de quantité montrée à la validation seulement, champ vide compris.
  const [editInvalid, setEditInvalid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const data = journal.data;
  // Objectifs retenus (ADR 0011), s'ils sont activés : affichés en regard des totaux.
  const goals = useTargets().data?.targets ?? undefined;
  const entries = data?.entries ?? [];

  function focus(selector: string) {
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }

  function closeEditor(selector: string, message = "") {
    flushSync(() => {
      setEditing(null);
      setConfirming(false);
      setNotice(message);
    });
    focus(selector);
  }

  function editor(entry: Entry) {
    const amount = parseDecimal(editGrams);
    const invalid = amount === null || amount <= 0 || amount > 5000;
    return (
      <form
        method="post"
        noValidate
        className="flex flex-col gap-3 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid) {
            flushSync(() => {
              setEditInvalid(true);
            });
            focus("input[name=edit-grams]");
            return;
          }
          // En file (ADR 0015) : affichée tout de suite, envoyée dès que le réseau le permet.
          save.mutate(entry, amount);
          closeEditor(
            `[data-entry="${entry.id}"]`,
            `${entry.name} : ${grams(amount)}${savedWhere()}.`,
          );
        }}
      >
        <TextField
          label={`Quantité de ${entry.name} (g)`}
          name="edit-grams"
          inputMode="decimal"
          autoComplete="off"
          value={editGrams}
          error={editInvalid ? "Saisissez une quantité entre 0 et 5 000 g." : undefined}
          announceError
          onChange={(event) => {
            setEditGrams(event.target.value);
            setEditInvalid(false);
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Button type="submit" variant="primary" disabled={!hydrated}>
            Enregistrer
          </Button>
          <Button
            onClick={() => {
              closeEditor(`[data-entry="${entry.id}"]`);
            }}
          >
            Annuler
          </Button>
        </div>
        {confirming ? (
          <div role="group" aria-labelledby={`remove-${entry.id}`} className="flex flex-col gap-2">
            <p id={`remove-${entry.id}`} className="text-sm font-semibold">
              {`Retirer ${entry.name} du ${mealLabel(entry.meal).toLowerCase()} ?`}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="danger"
                onClick={() => {
                  remove.mutate(entry);
                  closeEditor(`[data-add="${entry.meal}"]`, `${entry.name} retiré${savedWhere()}.`);
                }}
              >
                Retirer
              </Button>
              <Button
                data-focus="keep"
                onClick={() => {
                  flushSync(() => {
                    setConfirming(false);
                  });
                  focus("[data-focus=remove]");
                }}
              >
                Garder
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            data-focus="remove"
            onClick={() => {
              flushSync(() => {
                setConfirming(true);
              });
              focus("[data-focus=keep]");
            }}
          >
            {`Retirer ${entry.name}`}
          </Button>
        )}
      </form>
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-8">
      {/* Saisies en attente et refus du serveur (ADR 0015). */}
      <PendingWrites />
      <nav aria-label="Jour du journal" className="flex items-center justify-between gap-2">
        <Button
          aria-label="Jour précédent"
          onClick={() => {
            setDay(shiftDay(day, -1));
            setAdding(null);
            setEditing(null);
          }}
        >
          ←
        </Button>
        <h2 aria-live="polite" className="text-center text-xl font-extrabold [font-stretch:112%]">
          {day === today ? "Aujourd’hui" : longDay(day)}
        </h2>
        <Button
          aria-label="Jour suivant"
          // Pas `disabled` : arriver à aujourd'hui ne doit pas faire perdre le focus au bouton.
          aria-disabled={day >= today}
          onClick={() => {
            if (day >= today) return;
            setDay(shiftDay(day, 1));
            setAdding(null);
            setEditing(null);
          }}
        >
          →
        </Button>
      </nav>

      <p role="status" className="text-ink-muted empty:sr-only">
        {journal.isFetching && !data ? "Chargement du journal…" : ""}
      </p>
      {journal.isError && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-danger font-semibold">{JOURNAL_UNAVAILABLE}</p>
          <Button
            onClick={() => {
              void journal.refetch();
            }}
          >
            Réessayer
          </Button>
        </div>
      )}

      {data && (
        <>
          <section aria-labelledby="totals-title" className="flex flex-col gap-3">
            <h2 id="totals-title" className="sr-only">
              Totaux du jour
            </h2>
            <dl className="grid grid-cols-3 gap-3 tabular-nums">
              <div className="col-span-3">
                <dt className="sr-only">Énergie</dt>
                <dd className="text-[40px] leading-none font-extrabold [font-stretch:112%]">
                  {kcal(data.totals.kcal)}
                </dd>
                {goals && (
                  <dd className="text-ink-muted mt-2 text-sm">
                    {`sur ${kcal(goals.kcal)}, ${
                      goals.kcal >= data.totals.kcal
                        ? `reste ${kcal(goals.kcal - data.totals.kcal)}`
                        : `dépassé de ${kcal(data.totals.kcal - goals.kcal)}`
                    }`}
                  </dd>
                )}
              </div>
              {(
                [
                  ["Protéines", data.totals.protein, goals?.protein_g],
                  ["Glucides", data.totals.carbs, goals?.carbs_g],
                  ["Lipides", data.totals.fat, goals?.fat_g],
                ] as const
              ).map(([label, value, goal]) => (
                <div key={label} className="rounded-control bg-surface flex flex-col gap-1 p-3">
                  <dt className="text-ink-muted text-sm">{label}</dt>
                  <dd className="text-[17px] font-bold">
                    {grams(value)}
                    {goal !== undefined && (
                      <span className="text-ink-muted block text-sm font-normal">{` sur ${grams(goal)}`}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <Stepper
            label="Eau bue"
            value={data.water_ml}
            unit="millilitres"
            stepUnit="millilitres"
            step={WATER_STEP_ML}
            min={0}
            max={10000}
            size="md"
            onChange={(ml) => {
              // En file : le total affiché suit l'appui, deux appuis rapides s'additionnent.
              water.mutate({ day, ml });
            }}
          />

          <p aria-live="polite" className="text-ink-muted empty:sr-only">
            {notice}
          </p>

          {MEALS.map(({ value: meal, label }) => {
            const items = entries.filter((e) => e.meal === meal);
            const subtotal = items.reduce((sum, e) => sum + e.kcal, 0);
            return (
              <section key={meal} aria-labelledby={`meal-${meal}`} className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id={`meal-${meal}`} className="text-xl font-extrabold [font-stretch:112%]">
                    {label}
                  </h2>
                  <span className="text-ink-muted tabular-nums">{kcal(subtotal)}</span>
                </div>
                {items.length > 0 && (
                  <ul aria-labelledby={`meal-${meal}`} className="border-line-subtle border-t">
                    {items.map((entry) => (
                      <li key={entry.id} className="border-line-subtle border-b">
                        {editing === entry.id ? (
                          editor(entry)
                        ) : (
                          <button
                            type="button"
                            data-entry={entry.id}
                            className="hover:bg-surface flex min-h-14 w-full items-center justify-between gap-3 px-1 py-2 text-left"
                            onClick={() => {
                              flushSync(() => {
                                setAdding(null);
                                setEditing(entry.id);
                                setEditInvalid(false);
                                setEditGrams(formatNumber(entry.grams));
                                setConfirming(false);
                                setNotice("");
                              });
                              focus("input[name=edit-grams]");
                            }}
                          >
                            {/* Nom accessible = texte visible, précédé de l'action (WCAG 2.5.3). */}
                            <span>
                              <span className="sr-only">Modifier</span>{" "}
                              <span className="block font-semibold">{entry.name}</span>
                              <span className="sr-only">,</span>{" "}
                              <span className="text-ink-muted text-sm tabular-nums">
                                {grams(entry.grams)}
                              </span>
                            </span>
                            <span className="sr-only">,</span>{" "}
                            <span className="tabular-nums">{kcal(entry.kcal)}</span>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {adding === meal ? (
                  <FoodPicker
                    mealLabel={toMeal(meal)}
                    onCancel={() => {
                      flushSync(() => {
                        setAdding(null);
                      });
                      focus(`[data-add="${meal}"]`);
                    }}
                    onAdd={(food, amount) => {
                      add.mutate(food, { date: day, meal, grams: amount });
                      flushSync(() => {
                        setAdding(null);
                        setNotice(`${foodLabel(food)} ajouté ${toMeal(meal)}${savedWhere()}.`);
                      });
                      focus(`[data-add="${meal}"]`);
                    }}
                  />
                ) : (
                  <Button
                    data-add={meal}
                    onClick={() => {
                      flushSync(() => {
                        setEditing(null);
                        setAdding(meal);
                        setNotice("");
                      });
                    }}
                  >
                    {`Ajouter ${toMeal(meal)}`}
                  </Button>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
