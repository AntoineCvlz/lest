"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { localDay, longDay, shiftDay } from "@/shared/lib/days";
import { formatNumber, parseDecimal } from "@/shared/lib/number";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { Stepper } from "@/shared/ui/stepper";
import { TextField } from "@/shared/ui/text-field";

import { FoodPicker, foodLabel } from "./food-picker";
import {
  type Entry,
  type Meal,
  MEALS,
  useDayJournal,
  useDeleteEntry,
  useSaveEntry,
  useSaveWater,
} from "./use-nutrition";

export const JOURNAL_UNAVAILABLE = "Journal indisponible pour le moment.";
export const NOT_SAVED = "Modification non enregistrée. Vérifiez la connexion, puis réessayez.";
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
  // Eau saisie à l'instant : deux appuis rapides partent de la dernière valeur, pas du serveur.
  const [waterDraft, setWaterDraft] = useState<{ day: string; ml: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const data = journal.data;
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
          if (save.isPending) return;
          if (invalid) {
            flushSync(() => {
              setEditInvalid(true);
            });
            focus("input[name=edit-grams]");
            return;
          }
          save.mutate(
            {
              id: entry.id,
              date: entry.date,
              meal: entry.meal,
              foodId: entry.food_id,
              grams: amount,
            },
            {
              onSuccess: () => {
                closeEditor(`[data-entry="${entry.id}"]`, `${entry.name} : ${grams(amount)}.`);
              },
            },
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
          <Button
            type="submit"
            variant="primary"
            disabled={!hydrated}
            aria-disabled={save.isPending}
          >
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
                aria-disabled={remove.isPending}
                onClick={() => {
                  if (remove.isPending) return;
                  remove.mutate(entry.id, {
                    onSuccess: () => {
                      closeEditor(`[data-add="${entry.meal}"]`, `${entry.name} retiré.`);
                    },
                  });
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
              </div>
              {(
                [
                  ["Protéines", data.totals.protein],
                  ["Glucides", data.totals.carbs],
                  ["Lipides", data.totals.fat],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-control bg-surface flex flex-col gap-1 p-3">
                  <dt className="text-ink-muted text-sm">{label}</dt>
                  <dd className="text-[17px] font-bold">{grams(value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <Stepper
            label="Eau bue"
            value={waterDraft?.day === day ? waterDraft.ml : data.water_ml}
            unit="millilitres"
            stepUnit="millilitres"
            step={WATER_STEP_ML}
            min={0}
            max={10000}
            size="md"
            onChange={(ml) => {
              save.reset();
              remove.reset();
              setWaterDraft({ day, ml });
              water.mutate(
                { day, ml },
                {
                  onError: () => {
                    setWaterDraft(null);
                  },
                },
              );
            }}
          />

          <div role="alert" className="empty:hidden">
            {(save.isError || remove.isError || water.isError) && (
              <p className="rounded-control border-danger text-danger border p-4 font-semibold">
                {NOT_SAVED}
              </p>
            )}
          </div>
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
                                water.reset();
                                remove.reset();
                                setEditGrams(formatNumber(entry.grams));
                                setConfirming(false);
                                setNotice("");
                                save.reset();
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
                    pending={save.isPending}
                    onCancel={() => {
                      flushSync(() => {
                        setAdding(null);
                      });
                      focus(`[data-add="${meal}"]`);
                    }}
                    onAdd={(food, amount) => {
                      save.mutate(
                        {
                          id: crypto.randomUUID(),
                          date: day,
                          meal,
                          foodId: food.id,
                          grams: amount,
                        },
                        {
                          onSuccess: () => {
                            flushSync(() => {
                              setAdding(null);
                              setNotice(`${foodLabel(food)} ajouté ${toMeal(meal)}.`);
                            });
                            focus(`[data-add="${meal}"]`);
                          },
                        },
                      );
                    }}
                  />
                ) : (
                  <Button
                    data-add={meal}
                    onClick={() => {
                      flushSync(() => {
                        setEditing(null);
                        setAdding(meal);
                        water.reset();
                        remove.reset();
                        setNotice("");
                        save.reset();
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
