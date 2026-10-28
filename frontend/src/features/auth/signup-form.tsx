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
import { awaitsEmailVerification, errorsOf, refused, textValue, type Outcome } from "./form";

// Règles de `AUTH_PASSWORD_VALIDATORS` (backend/config/settings/base.py).
export const PASSWORD_HINT =
  "12 caractères au moins. Évitez un mot de passe courant, uniquement des chiffres ou proche de votre adresse.";
const RATE_LIMITED = "Trop d’inscriptions depuis cette connexion. Réessayez dans quelques minutes.";

type SignupOutcome = Outcome<"verify-email" | "signed-in">;

async function signup(email: string, password: string): Promise<SignupOutcome> {
  const { response, error } = await authClient.POST("/api/v1/auth/app/v1/auth/signup", {
    body: { email, password },
  });
  // 401 : compte créé (ou adresse déjà inscrite, sans le révéler) ; un e-mail vient de partir.
  if (response.status === 401) {
    return awaitsEmailVerification(error) ? { kind: "verify-email" } : refused(UNAVAILABLE);
  }
  if (response.ok || response.status === 409) return { kind: "signed-in" };
  if (response.status === 400) return { kind: "refused", errors: formErrors(error) };
  if (response.status === 429) return refused(RATE_LIMITED);
  return refused(UNAVAILABLE);
}

/** Inscription : e-mail et mot de passe, puis saisie du code reçu par e-mail. */
export function SignupForm() {
  const hydrated = useHydrated();
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      signup(email, password),
    onSuccess: (outcome) => {
      if (outcome.kind === "verify-email") router.push("/verification");
      if (outcome.kind !== "signed-in") return;
      queryClient.clear();
      router.push("/");
    },
  });
  const errors = errorsOf(mutation.data, mutation.isError);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({ email: textValue(form, "email"), password: textValue(form, "password") });
  }

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-1 flex-col gap-6">
      <TextField
        label="Adresse e-mail"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        error={errors.fields.email}
      />
      <TextField
        label="Mot de passe"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={PASSWORD_HINT}
        error={errors.fields.password}
      />
      <FormAlert messages={errors.global} />
      <div className="mt-auto pt-4 sm:mt-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!hydrated || mutation.isPending}
        >
          {mutation.isPending ? "Création du compte…" : "Créer mon compte"}
        </Button>
      </div>
    </form>
  );
}
