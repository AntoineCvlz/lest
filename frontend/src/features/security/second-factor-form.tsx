"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { SubmitEvent } from "react";

import { authClient } from "@/shared/api/auth-client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import { formErrors, UNAVAILABLE } from "../auth/errors";
import { FormAlert } from "../auth/form-alert";
import { errorsOf, refused, textValue, type Outcome } from "../auth/form";
import type { PrivateRoute } from "../auth/private-routes";

export const NO_PENDING_LOGIN =
  "Aucune connexion en cours. Saisissez à nouveau votre e-mail et votre mot de passe.";
const RATE_LIMITED = "Trop de tentatives. Réessayez dans quelques minutes.";

async function authenticate(code: string): Promise<Outcome<"signed-in">> {
  const { response, error } = await authClient.POST("/api/v1/auth/app/v1/auth/2fa/authenticate", {
    body: { code },
  });
  if (response.ok) return { kind: "signed-in" };
  if (response.status === 400) return { kind: "refused", errors: formErrors(error) };
  // 409 : parcours expiré ou absent ; 401 : connexion annulée (plafond d'échecs atteint).
  if (response.status === 409 || response.status === 401) return refused(NO_PENDING_LOGIN);
  if (response.status === 429) return refused(RATE_LIMITED);
  return refused(UNAVAILABLE);
}

/** Second facteur à la connexion : code de l'application, ou un code de secours. */
export function SecondFactorForm({ redirectTo = "/" }: { redirectTo?: PrivateRoute | "/" }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: authenticate,
    onSuccess: (outcome) => {
      if (outcome.kind !== "signed-in") return;
      queryClient.clear();
      router.push(redirectTo);
    },
  });
  const errors = errorsOf(mutation.data, mutation.isError);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(textValue(new FormData(event.currentTarget), "code").replace(/\s+/g, ""));
  }

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-1 flex-col gap-6">
      <TextField
        label="Code de vérification"
        name="code"
        autoComplete="one-time-code"
        inputMode="text"
        spellCheck={false}
        maxLength={24}
        hint="Le code à 6 chiffres de votre application, ou l’un de vos codes de secours."
        // allauth rattache l’erreur au paramètre de son API, `code`.
        error={errors.fields.code}
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
          {mutation.isPending ? "Vérification…" : "Valider"}
        </Button>
      </div>
    </form>
  );
}
