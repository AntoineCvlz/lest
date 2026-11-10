"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { formatNumber, parseDecimal } from "@/shared/lib/number";
import { useDebouncedValue } from "@/shared/lib/use-debounced-value";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import { BarcodeScanner } from "./barcode-scanner";
import {
  type Food,
  NutritionRequestFailed,
  useBarcodeLookup,
  useFoodSearch,
  useRecentFoods,
} from "./use-nutrition";

const SEARCH_DELAY_MS = 250;
const MAX_GRAMS = 5000;

export const NO_RESULT = "Aucun aliment trouvé. Essayez un mot plus court, ou sans marque.";
export const SEARCH_UNAVAILABLE = "Recherche indisponible pour le moment.";

/** « Nutella, Ferrero » : nom et marque d'un aliment. */
/** Mention exigée par la licence de la source de l'aliment (ADR 0009). */
export function FoodCredit({ food }: { food: Food }) {
  if (food.source === "ciqual") {
    return (
      <p className="text-ink-muted -mt-2 text-sm">
        Table Ciqual 2025, Anses, Licence Ouverte Etalab 2.0.
      </p>
    );
  }
  if (food.source === "off" && food.source_url) {
    return (
      <p className="text-ink-muted -mt-2 text-sm">
        <a
          href={food.source_url}
          rel="noopener noreferrer"
          className="text-ink inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Données Open Food Facts, sous licence ODbL
        </a>
      </p>
    );
  }
  return null;
}

export function foodLabel(food: Food): string {
  return food.brand ? `${food.name}, ${food.brand}` : food.name;
}

/** Message d'un code-barres sans aliment, selon la réponse de l'API (ADR 0009). */
export function barcodeError(error: unknown): string {
  const status = error instanceof NutritionRequestFailed ? error.status : 0;
  if (status === 404)
    return "Code-barres inconnu : vérifiez-le, ou cherchez l’aliment par son nom.";
  if (status === 422) {
    return "Produit sans valeurs nutritionnelles exploitables : choisissez un aliment proche.";
  }
  if (status === 429) return "Trop de produits nouveaux scannés : réessayez plus tard.";
  return "Recherche du produit indisponible. Réessayez dans un instant.";
}

/** Énergie d'une quantité : « 300 kcal ». */
export function kcalFor(food: Food, grams: number): string {
  return `${formatNumber(Math.round((food.kcal_100g * grams) / 100))} kcal`;
}

export interface FoodPickerProps {
  /** « au déjeuner » : complète le libellé du bouton d'ajout. */
  mealLabel: string;
  onAdd: (food: Food, grams: number) => void;
  onCancel: () => void;
}

/**
 * Choix d'un aliment à ajouter : aliments récents, recherche locale (sans accents), code-barres
 * saisi au clavier ; puis la quantité en grammes (portion de la source ou 100 g par défaut).
 */
export function FoodPicker({ mealLabel, onAdd, onCancel }: FoodPickerProps) {
  const hydrated = useHydrated();
  const [query, setQuery] = useState("");
  const [barcode, setBarcode] = useState("");
  const [chosen, setChosen] = useState<Food | null>(null);
  const [grams, setGrams] = useState("");
  const [invalid, setInvalid] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const settled = useDebouncedValue(query.trim(), SEARCH_DELAY_MS);
  const search = useFoodSearch(settled);
  const recent = useRecentFoods();
  const lookup = useBarcodeLookup();

  useEffect(() => {
    rootRef.current?.querySelector<HTMLInputElement>("input[type=search]")?.focus();
  }, []);

  function focus(selector: string) {
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }

  function choose(food: Food) {
    flushSync(() => {
      setChosen(food);
      setGrams(formatNumber(food.serving_g ?? 100));
      setInvalid(false);
    });
    focus("input[name=grams]");
  }

  const searching = query.trim().length >= 2;
  const stale = searching && (settled !== query.trim() || search.isPlaceholderData);
  const foods = searching ? (search.data ?? []) : (recent.data ?? []);
  const status = searching
    ? search.isError
      ? SEARCH_UNAVAILABLE
      : stale || search.isPending
        ? "Recherche…"
        : foods.length === 0
          ? NO_RESULT
          : `${String(foods.length)} aliment${foods.length > 1 ? "s" : ""} trouvé${foods.length > 1 ? "s" : ""}.`
    : recent.isError
      ? "Aliments récents indisponibles : cherchez par nom ou par code-barres."
      : recent.isPending
        ? "Chargement des aliments récents…"
        : foods.length === 0
          ? "Cherchez un aliment par son nom, ou par son code-barres."
          : "";
  const amount = parseDecimal(grams);

  if (chosen) {
    return (
      <div ref={rootRef} className="flex flex-col gap-4">
        <p className="font-semibold">
          {foodLabel(chosen)}
          <span className="text-ink-muted block text-sm font-normal">
            {`${formatNumber(chosen.kcal_100g)} kcal pour 100 g`}
          </span>
        </p>
        <FoodCredit food={chosen} />
        <form
          method="post"
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (amount === null || amount <= 0 || amount > MAX_GRAMS) {
              flushSync(() => {
                setInvalid(true);
              });
              focus("input[name=grams]");
              return;
            }
            onAdd(chosen, Math.round(amount * 10) / 10);
          }}
        >
          <TextField
            label="Quantité (g)"
            name="grams"
            inputMode="decimal"
            autoComplete="off"
            value={grams}
            hint={amount !== null && amount > 0 ? kcalFor(chosen, amount) : undefined}
            error={invalid ? "Saisissez une quantité entre 0 et 5 000 g." : undefined}
            announceError
            onChange={(event) => {
              setGrams(event.target.value);
              setInvalid(false);
            }}
          />
          <Button type="submit" variant="primary" block disabled={!hydrated}>
            {`Ajouter ${mealLabel}`}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              flushSync(() => {
                setChosen(null);
              });
              focus("input[type=search]");
            }}
          >
            Choisir un autre aliment
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <TextField
        label="Rechercher un aliment"
        type="search"
        autoComplete="off"
        enterKeyHint="search"
        value={query}
        hint="Riz cuit, blanc de poulet, flocons d’avoine…"
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <div className="flex flex-col gap-2">
        <h3 className="text-ink-muted text-sm font-semibold">
          {searching ? "Résultats" : "Aliments récents"}
        </h3>
        {/* Toujours présent : l'état de la recherche est annoncé sans quitter le champ. */}
        <p role="status" className="text-ink-muted empty:sr-only">
          {status}
        </p>
        {foods.length > 0 && (
          <ul aria-busy={stale} className="border-line-subtle border-t">
            {foods.map((food) => (
              <li key={food.id} className="border-line-subtle border-b">
                <button
                  type="button"
                  disabled={stale}
                  className="hover:bg-surface flex min-h-14 w-full flex-col items-start justify-center px-1 py-2 text-left"
                  onClick={() => {
                    choose(food);
                  }}
                >
                  <span className="font-semibold">{foodLabel(food)}</span>
                  <span className="text-ink-muted text-sm">
                    {`${formatNumber(food.kcal_100g)} kcal pour 100 g`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <BarcodeScanner
        onDetected={(code) => {
          setBarcode(code);
          lookup.mutate(code, { onSuccess: choose });
        }}
      />
      <form
        method="post"
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const code = barcode.trim();
          if (!code || lookup.isPending) return;
          lookup.mutate(code, { onSuccess: choose });
        }}
      >
        <TextField
          label="Code-barres"
          name="barcode"
          inputMode="numeric"
          autoComplete="off"
          value={barcode}
          hint="8 à 14 chiffres, sous les barres."
          error={lookup.isError ? barcodeError(lookup.error) : undefined}
          announceError
          onChange={(event) => {
            setBarcode(event.target.value);
            lookup.reset();
          }}
        />
        <Button type="submit" disabled={!hydrated} aria-disabled={lookup.isPending}>
          Chercher le code-barres
        </Button>
      </form>
      <Button variant="ghost" onClick={onCancel}>
        Annuler
      </Button>
    </div>
  );
}
