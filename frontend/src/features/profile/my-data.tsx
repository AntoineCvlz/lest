"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState, type SubmitEvent } from "react";

import { fetchClient } from "@/shared/api/client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

export const WRONG_PASSWORD = "Mot de passe incorrect.";
export const EXPORT_FAILED = "L’export n’a pas pu être préparé. Réessayez dans un instant.";
const TOO_MANY = "Trop de tentatives. Réessayez plus tard.";
const NOT_DELETED = "Le compte n’a pas pu être supprimé. Réessayez dans un instant.";
// Type RFC 9457 du mauvais mot de passe (backend/apps/accounts/api/router.py) : les autres 403
// (jeton CSRF manquant, origine refusée) ne doivent pas être affichés comme tels.
const WRONG_CREDENTIALS_TYPE = "urn:lest:problem:incorrect-password";

type Outcome = "deleted" | "wrong-password" | "too-many" | "failed";

function problemType(body: unknown): unknown {
  return typeof body === "object" && body !== null && "type" in body ? body.type : undefined;
}

async function deleteAccount(password: string): Promise<Outcome> {
  const { response, error } = await fetchClient.DELETE("/api/v1/me/", { body: { password } });
  if (response.status === 204) return "deleted";
  if (response.status === 403 && problemType(error) === WRONG_CREDENTIALS_TYPE) {
    return "wrong-password";
  }
  if (response.status === 429) return "too-many";
  return "failed";
}

/** Télécharge l'export ; `false` si la session a expiré (401). Lève une erreur sinon. */
async function downloadExport(): Promise<boolean> {
  const { data, response } = await fetchClient.GET("/api/v1/me/export/", { parseAs: "blob" });
  if (response.status === 401) return false;
  if (!data) throw new Error(EXPORT_FAILED);
  // Statut vérifié avant d'enregistrer : un lien `download` enregistrerait aussi une erreur.
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `lest-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return true;
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
  // Le mot de passe ne passe pas par les `variables` de la mutation : TanStack les garderait
  // en mémoire (et dans un futur cache hors ligne) après un échec ou une annulation.
  const password = useRef("");
  const exporting = useMutation({
    mutationFn: downloadExport,
    onSuccess: (downloaded) => {
      if (!downloaded) router.push("/connexion?suivant=/profil");
    },
  });
  const deletion = useMutation({
    mutationFn: () => deleteAccount(password.current),
    gcTime: 0,
    onSettled: () => {
      password.current = "";
    },
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
    password.current = typeof value === "string" ? value : "";
    deletion.mutate();
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
      <Button
        onClick={() => {
          exporting.mutate();
        }}
        disabled={!hydrated || exporting.isPending}
      >
        {exporting.isPending ? "Préparation de l’export…" : "Télécharger mes données (JSON)"}
      </Button>
      <div role="alert" className="empty:hidden">
        {exporting.isError && (
          <p className="rounded-control border-danger text-danger border p-4 font-semibold">
            {EXPORT_FAILED}
          </p>
        )}
      </div>
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
