"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";

import { fetchClient } from "@/shared/api/client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

const EXPORT_URL = "/api/v1/me/export/";
export const WRONG_PASSWORD = "Mot de passe incorrect.";
const TOO_MANY = "Trop de tentatives. Réessayez plus tard.";
const NOT_DELETED = "Le compte n’a pas pu être supprimé. Réessayez dans un instant.";

type Outcome = "deleted" | "wrong-password" | "too-many" | "failed";

async function deleteAccount(password: string): Promise<Outcome> {
  const { response } = await fetchClient.DELETE("/api/v1/me/", { body: { password } });
  if (response.status === 204) return "deleted";
  if (response.status === 403) return "wrong-password";
  if (response.status === 429) return "too-many";
  return "failed";
}

/**
 * Droits RGPD : télécharger ses données (JSON) et supprimer son compte. La suppression est
 * immédiate et définitive : elle demande d'abord de l'afficher, puis le mot de passe.
 */
export function MyData() {
  const hydrated = useHydrated();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const deletion = useMutation({
    mutationFn: deleteAccount,
    onSuccess: (outcome) => {
      if (outcome !== "deleted") return;
      queryClient.clear();
      router.push("/compte-supprime");
    },
  });
  const outcome = deletion.data;
  const alert =
    outcome === "too-many"
      ? TOO_MANY
      : outcome === "failed" || deletion.isError
        ? NOT_DELETED
        : undefined;

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("password");
    deletion.mutate(typeof value === "string" ? value : "");
  }

  return (
    <section
      aria-labelledby="my-data-title"
      className="border-line-subtle flex flex-col gap-4 border-t pt-8"
    >
      <h2 id="my-data-title" className="text-xl font-extrabold [font-stretch:112%]">
        Mes données
      </h2>
      <p className="text-ink-muted">
        Vos données vous appartiennent : téléchargez-les à tout moment, ou supprimez votre compte.
      </p>
      {/* Lien simple : le BFF ajoute le jeton, le navigateur enregistre le fichier JSON. */}
      <a
        href={EXPORT_URL}
        download
        className="rounded-control border-line bg-surface text-ink inline-flex min-h-11 items-center justify-center border px-4 font-bold"
      >
        Télécharger mes données (JSON)
      </a>
      {confirming ? (
        <form method="post" noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="text-danger font-semibold">
            La suppression est immédiate et définitive : votre compte et toutes vos données seront
            effacés, sans retour possible.
          </p>
          <TextField
            label="Mot de passe, pour confirmer"
            name="password"
            type="password"
            autoComplete="current-password"
            error={outcome === "wrong-password" ? WRONG_PASSWORD : undefined}
          />
          <div role="alert" className="empty:hidden">
            {alert && (
              <p className="rounded-control border-danger text-danger border p-4 font-semibold">
                {alert}
              </p>
            )}
          </div>
          <Button type="submit" variant="danger" block disabled={!hydrated || deletion.isPending}>
            {deletion.isPending ? "Suppression…" : "Supprimer définitivement mon compte"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setConfirming(false);
              deletion.reset();
            }}
          >
            Annuler
          </Button>
        </form>
      ) : (
        <Button
          variant="danger"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Supprimer mon compte
        </Button>
      )}
    </section>
  );
}
