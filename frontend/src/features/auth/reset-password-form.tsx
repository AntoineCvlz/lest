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
import { PASSWORD_HINT } from "./signup-form";
import { TextLink } from "./text-link";

export const NO_PENDING_RESET =
  "Aucune réinitialisation en cours. Recommencez depuis « Mot de passe oublié » pour recevoir un nouveau code.";
export const RESET_DONE = "Mot de passe modifié. Vous pouvez vous connecter.";
const RATE_LIMITED = "Trop de tentatives. Réessayez dans quelques minutes.";

async function resetPassword(
  code: string,
  password: string,
): Promise<Outcome<"signed-in" | "done">> {
  const { response, error } = await authClient.POST("/api/v1/auth/app/v1/auth/password/reset", {
    body: { key: code, password },
  });
  if (response.ok) return { kind: "signed-in" };
  // 401 : mot de passe changé, sans ouverture de session (`ACCOUNT_LOGIN_ON_PASSWORD_RESET`).
  if (response.status === 401) return { kind: "done" };
  if (response.status === 400) return { kind: "refused", errors: formErrors(error) };
  // 409 : plus de parcours en attente (expiré, ou code trop de fois faux).
  if (response.status === 409) return refused(NO_PENDING_RESET);
  if (response.status === 429) return refused(RATE_LIMITED);
  return refused(UNAVAILABLE);
}

/** Code reçu par e-mail et nouveau mot de passe, dans un seul envoi. */
export function ResetPasswordForm() {
  const hydrated = useHydrated();
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ code, password }: { code: string; password: string }) =>
      resetPassword(code, password),
    onSuccess: (outcome) => {
      if (outcome.kind !== "signed-in") return;
      queryClient.clear();
      router.push("/");
    },
  });
  const errors = errorsOf(mutation.data, mutation.isError);

  if (mutation.data?.kind === "done") {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-ink font-semibold">
          {RESET_DONE}
        </p>
        <TextLink href="/connexion">Se connecter</TextLink>
      </div>
    );
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      code: textValue(form, "code").trim().toUpperCase(),
      password: textValue(form, "password"),
    });
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
      <TextField
        label="Nouveau mot de passe"
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
          {mutation.isPending ? "Enregistrement…" : "Changer le mot de passe"}
        </Button>
      </div>
    </form>
  );
}
