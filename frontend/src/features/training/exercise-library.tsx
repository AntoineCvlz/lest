"use client";

import Link from "next/link";
import { useState } from "react";

import type { Schemas } from "@/shared/api/client";
import { useDebouncedValue } from "@/shared/lib/use-debounced-value";
import { Button } from "@/shared/ui/button";
import { SelectField } from "@/shared/ui/select-field";
import { TextField } from "@/shared/ui/text-field";

import { CATEGORY_LABELS, type Category } from "./categories";
import { useExerciseFilters, useExercises, type ExerciseSearch } from "./use-exercises";

export const CATALOG_UNAVAILABLE = "Catalogue indisponible. Réessayez dans un instant.";
export const NO_MATCH = "Aucun exercice ne correspond. Modifiez la recherche ou les filtres.";
export const SEARCH_DELAY_MS = 250;
const CATEGORIES = Object.entries(CATEGORY_LABELS) as [Category, string][];

function toId(value: string): number | null {
  return value === "" ? null : Number(value);
}

function summary(count: number, more: boolean): string {
  const shown = count === 1 ? "1 exercice affiché" : `${String(count)} exercices affichés`;
  return more ? `${shown}, d’autres suivent.` : `${shown}.`;
}

function ExerciseItem({
  exercise,
  onSelect,
  disabled,
}: {
  exercise: Schemas["ExerciseOut"];
  onSelect?: (exercise: Schemas["ExerciseOut"]) => void;
  disabled: boolean;
}) {
  const details = [
    CATEGORY_LABELS[exercise.category],
    ...exercise.muscles.map((muscle) => muscle.name),
    ...exercise.equipment.map((item) => item.name),
  ].join(", ");
  const content = (
    <>
      {/* Nom anglais quand wger n'en a pas de français (ADR 0004) : prononcé en anglais. */}
      <span className="block text-[17px] font-bold" lang={exercise.name_language}>
        {exercise.name}
      </span>
      <span className="text-ink-muted block text-sm">{details}</span>
    </>
  );
  return (
    <li className="border-line-subtle border-b">
      {onSelect ? (
        <button
          type="button"
          disabled={disabled}
          className="hover:bg-surface flex min-h-14 w-full flex-col gap-1 px-1 py-3 text-left disabled:opacity-50"
          onClick={() => {
            onSelect(exercise);
          }}
        >
          {content}
        </button>
      ) : (
        <Link
          href={`/exercices/${exercise.id}`}
          className="hover:bg-surface flex min-h-14 flex-col gap-1 px-1 py-3"
        >
          {content}
        </Link>
      )}
    </li>
  );
}

/**
 * Bibliothèque d'exercices : recherche sans accents, filtres, pages de 30 à la demande.
 * Avec `onSelect`, chaque exercice devient un bouton (choix d'un exercice pour la séance).
 */
export function ExerciseLibrary({
  onSelect,
  selecting = false,
}: {
  onSelect?: (exercise: Schemas["ExerciseOut"]) => void;
  /** Choix en cours d'enregistrement : boutons désactivés (pas de double ajout). */
  selecting?: boolean;
} = {}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [muscle, setMuscle] = useState<number | null>(null);
  const [equipment, setEquipment] = useState<number | null>(null);
  const search: ExerciseSearch = {
    q: useDebouncedValue(q.trim(), SEARCH_DELAY_MS),
    category,
    muscle,
    equipment,
  };
  const exercises = useExercises(search);
  const filters = useExerciseFilters();
  const items = exercises.data?.pages.flatMap((page) => page.items) ?? [];
  const active = [category, muscle, equipment].filter((value) => value !== null).length;
  const filtered = q.trim() !== "" || active > 0;
  const empty = items.length === 0 && !exercises.isPending && !exercises.isError;

  function reset() {
    setQ("");
    setCategory(null);
    setMuscle(null);
    setEquipment(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <search className="flex flex-col gap-4">
        <TextField
          label="Rechercher un exercice"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={100}
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
          }}
        />
        {/* Repliés : sur mobile, les trois listes repousseraient les résultats hors de l'écran. */}
        <details className="group">
          <summary
            className={[
              "rounded-control border-line bg-surface text-ink flex min-h-12 cursor-pointer",
              "items-center justify-between border px-4 font-semibold",
              "list-none [&::-webkit-details-marker]:hidden",
            ].join(" ")}
          >
            {active === 0 ? "Filtres" : `Filtres (${String(active)} actif${active > 1 ? "s" : ""})`}
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="size-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
            >
              <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </summary>
          <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-3">
            <SelectField
              label="Catégorie"
              value={category ?? ""}
              onChange={(event) => {
                setCategory(event.target.value === "" ? null : (event.target.value as Category));
              }}
            >
              <option value="">Toutes</option>
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Muscle"
              value={muscle ?? ""}
              disabled={!filters.data}
              onChange={(event) => {
                setMuscle(toId(event.target.value));
              }}
            >
              <option value="">Tous</option>
              {filters.data?.muscles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Équipement"
              value={equipment ?? ""}
              disabled={!filters.data}
              onChange={(event) => {
                setEquipment(toId(event.target.value));
              }}
            >
              <option value="">Tous</option>
              {filters.data?.equipment.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
          </div>
        </details>
      </search>

      <p role="status" className="text-ink-muted empty:hidden">
        {exercises.isPending || exercises.isPlaceholderData
          ? "Recherche des exercices…"
          : exercises.isError
            ? ""
            : empty
              ? NO_MATCH
              : summary(items.length, exercises.hasNextPage)}
      </p>
      <div role="alert" className="empty:hidden">
        {exercises.isError && (
          <p className="rounded-control border-danger text-danger border p-4 font-semibold">
            {CATALOG_UNAVAILABLE}
          </p>
        )}
      </div>
      {exercises.isError && (
        <Button
          onClick={() => {
            void exercises.refetch();
          }}
        >
          Réessayer
        </Button>
      )}
      {empty && filtered && <Button onClick={reset}>Effacer la recherche et les filtres</Button>}

      {items.length > 0 && (
        <ul
          aria-label="Exercices"
          aria-busy={exercises.isPlaceholderData}
          // Résultats de la recherche précédente : signalés par le statut et `aria-busy`, pas
          // par une opacité réduite (le texte secondaire passerait sous 4,5:1 de contraste).
          className="border-line-subtle border-t"
        >
          {items.map((exercise) => (
            <ExerciseItem
              key={exercise.id}
              exercise={exercise}
              onSelect={onSelect}
              // Liste provisoire (recherche en cours) : pas de choix sur un résultat périmé.
              disabled={selecting || exercises.isPlaceholderData}
            />
          ))}
        </ul>
      )}
      {exercises.hasNextPage && (
        <Button
          onClick={() => {
            void exercises.fetchNextPage();
          }}
          disabled={exercises.isFetchingNextPage}
        >
          {exercises.isFetchingNextPage ? "Chargement…" : "Afficher plus d’exercices"}
        </Button>
      )}
    </div>
  );
}
