"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { SubmitEvent } from "react";

import { authClient } from "@/shared/api/auth-client";
import { Button } from "@/shared/ui/button";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { TextField } from "@/shared/ui/text-field";

import { formErrors, NO_ERRORS, RATE_LIMITED, UNAVAILABLE, type FormErrors } from "./errors";

const VERIFY_EMAIL = "Confirmez d’abord votre adresse e-mail : un code vient de vous être envoyé.";

type LoginOutcome = { kind: "signed-in" } | { kind: "refused"; errors: FormErrors };

function refused(...global: string[]): LoginOutcome {
  return { kind: "refused", errors: { fields: {}, global } };
}

async function login(email: string, password: string): Promise<LoginOutcome> {
  const { response, error } = await authClient.POST("/api/v1/auth/app/v1/auth/login", {
    body: { email, password },
  });
  // 409 : une session est déjà ouverte, l'utilisateur est donc connecté.
  if (response.ok || response.status === 409) return { kind: "signed-in" };
  if (response.status === 400) return { kind: "refused", errors: formErrors(error) };
  // 401 : identifiants corrects mais parcours en attente (adresse e-mail à vérifier).
  if (response.status === 401) return refused(VERIFY_EMAIL);
  if (response.status === 429) return refused(RATE_LIMITED);
  return refused(UNAVAILABLE);
}

function textValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Formulaire de connexion : e-mail et mot de passe, erreurs annoncées, puis accueil. */
export function LoginForm() {
  const hydrated = useHydrated();
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      login(email, password),
    onSuccess: (outcome) => {
      if (outcome.kind !== "signed-in") return;
      // Les données en cache appartenaient peut-être à une autre session.
      queryClient.clear();
      router.push("/");
    },
  });
  const errors =
    mutation.data?.kind === "refused"
      ? mutation.data.errors
      : mutation.isError
        ? { fields: {}, global: [UNAVAILABLE] }
        : NO_ERRORS;

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      email: textValue(form, "email"),
      password: textValue(form, "password"),
    });
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
      <div role="alert" className="empty:hidden">
        {errors.global.length > 0 && (
          <div className="rounded-control border-danger text-danger border p-4 font-semibold">
            {errors.global.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
      </div>
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
