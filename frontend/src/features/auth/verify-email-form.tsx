"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { SubmitEvent } from "react";

import { authClient } from "@/shared/api/auth-client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import { formErrors, UNAVAILABLE } from "./errors";
import { FormAlert } from "./form-alert";
import { errorsOf, refused, textValue, type Outcome } from "./form";

// 409 : aucune vérification en cours (session expirée, code trop de fois faux, page ouverte
// directement). Il faut repartir de la connexion ou de l'inscription.
export const NO_PENDING =
  "Aucune vérification en cours. Connectez-vous ou créez un compte pour recevoir un nouveau code.";
const RESENT = "Un nouveau code vient d’être envoyé.";
const RESEND_EXHAUSTED =
  "Plus de renvoi possible pour ce code. Reconnectez-vous pour en recevoir un nouveau.";
const RESEND_LIMITED = "Un code vient déjà d’être envoyé. Patientez avant d’en demander un autre.";

async function verify(code: string): Promise<Outcome<"signed-in">> {
  const { response, error } = await authClient.POST("/api/v1/auth/app/v1/auth/email/verify", {
    body: { key: code },
  });
  if (response.ok) return { kind: "signed-in" };
  if (response.status === 400) return { kind: "refused", errors: formErrors(error) };
  if (response.status === 409) return refused(NO_PENDING);
  return refused(UNAVAILABLE);
}

async function resend(): Promise<string> {
  const { response } = await authClient.POST("/api/v1/auth/app/v1/auth/email/verify/resend");
  if (response.ok) return RESENT;
  if (response.status === 429) return RESEND_LIMITED;
  // 409 : renvois épuisés (2 par parcours) ou plus de parcours en attente.
  if (response.status === 409) return RESEND_EXHAUSTED;
  return UNAVAILABLE;
}

/** Saisie du code de vérification reçu par e-mail ; un code juste ouvre la session. */
export function VerifyEmailForm() {
  const hydrated = useHydrated();
  const router = useRouter();
  const queryClient = useQueryClient();
  const verification = useMutation({
    mutationFn: verify,
    onSuccess: (outcome) => {
      if (outcome.kind !== "signed-in") return;
      queryClient.clear();
      router.push("/");
    },
  });
  const resending = useMutation({ mutationFn: resend });
  const errors = errorsOf(verification.data, verification.isError);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    verification.mutate(textValue(form, "code").trim().toUpperCase());
  }

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-1 flex-col gap-6">
      <TextField
        label="Code reçu par e-mail"
        name="code"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={20}
        hint="Il ressemble à ABCD-EFGH."
        // allauth rattache l’erreur au paramètre de son API, `key`.
        error={errors.fields.key}
        className="[&_input]:tracking-[0.2em] [&_input]:uppercase"
      />
      <FormAlert messages={errors.global} />
      <div className="flex flex-col items-start gap-2">
        <Button
          variant="secondary"
          disabled={!hydrated || resending.isPending}
          onClick={() => {
            resending.mutate();
          }}
        >
          Renvoyer un code
        </Button>
        <p role="status" className="text-ink-muted text-sm">
          {resending.data ?? (resending.isError ? UNAVAILABLE : "")}
        </p>
      </div>
      <div className="mt-auto pt-4 sm:mt-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!hydrated || verification.isPending}
        >
          {verification.isPending ? "Vérification…" : "Valider le code"}
        </Button>
      </div>
    </form>
  );
}
