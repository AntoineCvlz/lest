"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Schemas } from "@/shared/api/client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import { usePrograms, useSaveProgram } from "./use-programs";

export const PROGRAMS_UNAVAILABLE = "Programmes indisponibles. Réessayez dans un instant.";
export const PROGRAM_NOT_SAVED = "Programme non enregistré. Vérifiez la connexion et réessayez.";
export const NO_PROGRAM =
  "Aucun programme pour l’instant. Créez-en un : quelques séances types, chacune avec ses exercices et leur cible.";

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count > 1 ? many : one}`;
}

/** « 3 séances types, 15 exercices ». */
export function programSummary(program: Schemas["ProgramDetailOut"]): string {
  const exercises = program.days.reduce((total, day) => total + day.exercises.length, 0);
  return [
    plural(program.days.length, "séance type", "séances types"),
    plural(exercises, "exercice", "exercices"),
  ].join(", ");
}

/** Programmes du compte, et création d'un programme (on passe ensuite à son édition). */
export function ProgramList() {
  const programs = usePrograms();
  const save = useSaveProgram();
  const router = useRouter();
  const hydrated = useHydrated();
  const [name, setName] = useState("");

  return (
    <div className="flex flex-col gap-8">
      {programs.isPending && (
        <p role="status" className="text-ink-muted">
          Chargement des programmes…
        </p>
      )}
      {programs.isError && (
        <p
          role="alert"
          className="rounded-control border-danger text-danger border p-4 font-semibold"
        >
          {PROGRAMS_UNAVAILABLE}
        </p>
      )}
      {programs.isSuccess &&
        (programs.data.length === 0 ? (
          <p className="text-ink-muted">{NO_PROGRAM}</p>
        ) : (
          <ul aria-label="Mes programmes" className="border-line-subtle border-t">
            {programs.data.map((program) => (
              <li key={program.id} className="border-line-subtle border-b">
                <Link
                  href={`/seance/programmes/${program.id}`}
                  className="hover:bg-surface flex min-h-14 flex-col gap-1 px-1 py-3"
                >
                  <span className="text-[17px] font-bold">{program.name}</span>
                  <span className="text-ink-muted text-sm">{programSummary(program)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
      <form
        method="post"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          save.mutate(
            { name: trimmed },
            {
              onSuccess: (created) => {
                router.push(`/seance/programmes/${created.id}`);
              },
            },
          );
        }}
      >
        <TextField
          label="Nom du nouveau programme"
          hint="Par exemple : Poussée / Tirage / Jambes"
          maxLength={80}
          autoComplete="off"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <div role="alert" className="empty:hidden">
          {save.isError && (
            <p className="rounded-control border-danger text-danger border p-4 font-semibold">
              {PROGRAM_NOT_SAVED}
            </p>
          )}
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!hydrated || save.isPending || name.trim() === ""}
        >
          Créer le programme
        </Button>
      </form>
    </div>
  );
}
