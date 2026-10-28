"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { SubmitEvent } from "react";

import { authClient } from "@/shared/api/auth-client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import { formErrors, RATE_LIMITED, UNAVAILABLE } from "./errors";
import { FormAlert } from "./form-alert";
import {
  awaitsEmailVerification,
  awaitsFlow,
  errorsOf,
  refused,
  textValue,
  type Outcome,
} from "./form";
import type { PrivateRoute } from "./private-routes";
import { TextLink } from "./text-link";

type LoginOutcome = Outcome<"signed-in" | "verify-email" | "second-factor">;

async function login(email: string, password: string): Promise<LoginOutcome> {
  const { response, error } = await authClient.POST("/api/v1/auth/app/v1/auth/login", {
    body: { email, password },
  });
  // 409 : une session est déjà ouverte, l'utilisateur est donc connecté.
  if (response.ok || response.status === 409) return { kind: "signed-in" };
  if (response.status === 400) return { kind: "refused", errors: formErrors(error) };
  // 401 : identifiants corrects mais adresse à vérifier ; allauth vient d'envoyer un code.
  if (response.status === 401) {
    if (awaitsEmailVerification(error)) return { kind: "verify-email" };
    // Mot de passe correct, double authentification active : le code est demandé ensuite.
    if (awaitsFlow(error, "mfa_authenticate")) return { kind: "second-factor" };
    return refused(UNAVAILABLE);
  }
  if (response.status === 429) return refused(RATE_LIMITED);
  return refused(UNAVAILABLE);
}

/** Formulaire de connexion : e-mail et mot de passe, erreurs annoncées, puis `redirectTo`. */
export function LoginForm({ redirectTo = "/" }: { redirectTo?: PrivateRoute | "/" }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      login(email, password),
    onSuccess: (outcome) => {
      if (outcome.kind === "verify-email") router.push("/verification");
      if (outcome.kind === "second-factor") {
        router.push(
          redirectTo === "/" ? "/connexion/code" : `/connexion/code?suivant=${redirectTo}`,
        );
      }
      if (outcome.kind !== "signed-in") return;
      // Les données en cache appartenaient peut-être à une autre session.
      queryClient.clear();
      router.push(redirectTo);
    },
  });
  const errors = errorsOf(mutation.data, mutation.isError);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({ email: textValue(form, "email"), password: textValue(form, "password") });
  }

  return (
    // `post` : un envoi natif (avant hydratation) ne met jamais les identifiants dans l’URL.
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
        autoComplete="current-password"
        error={errors.fields.password}
      />
      <TextLink href="/mot-de-passe-oublie" className="-mt-3 self-start">
        Mot de passe oublié ?
      </TextLink>
      <FormAlert messages={errors.global} />
      <div className="mt-auto pt-4 sm:mt-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!hydrated || mutation.isPending}
        >
          {mutation.isPending ? "Connexion…" : "Se connecter"}
        </Button>
      </div>
    </form>
  );
}
