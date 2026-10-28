"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { SubmitEvent } from "react";

import { authClient } from "@/shared/api/auth-client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import { formErrors, UNAVAILABLE } from "./errors";
import { FormAlert } from "./form-alert";
import { errorsOf, refused, textValue, type Outcome } from "./form";

const RATE_LIMITED = "Trop de demandes. Réessayez dans quelques minutes.";

async function requestReset(email: string): Promise<Outcome<"code-sent">> {
  const { response, error } = await authClient.POST("/api/v1/auth/app/v1/auth/password/request", {
    body: { email },
  });
  // Même réponse que l'adresse ait un compte ou non (`ACCOUNT_PREVENT_ENUMERATION`) : 401 avec
  // le parcours « code » en attente.
  if (response.ok || response.status === 401) return { kind: "code-sent" };
  if (response.status === 400) return { kind: "refused", errors: formErrors(error) };
  if (response.status === 429) return refused(RATE_LIMITED);
  return refused(UNAVAILABLE);
}

/** Demande de réinitialisation : l'adresse reçoit un code, saisi à l'écran suivant. */
export function ForgotPasswordForm() {
  const hydrated = useHydrated();
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: requestReset,
    onSuccess: (outcome) => {
      if (outcome.kind === "code-sent") router.push("/mot-de-passe-oublie/code");
    },
  });
  const errors = errorsOf(mutation.data, mutation.isError);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(textValue(new FormData(event.currentTarget), "email"));
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
      <FormAlert messages={errors.global} />
      <div className="mt-auto pt-4 sm:mt-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!hydrated || mutation.isPending}
        >
          {mutation.isPending ? "Envoi…" : "Recevoir un code"}
        </Button>
      </div>
    </form>
  );
}
