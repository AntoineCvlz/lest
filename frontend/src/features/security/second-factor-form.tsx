"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";

import { authClient } from "@/shared/api/auth-client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { getPasskey, PASSKEY_FAILED, PasskeyError, passkeysSupported } from "@/shared/lib/webauthn";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import { formErrors, SECOND_FACTOR_MESSAGES, UNAVAILABLE } from "../auth/errors";
import { FormAlert } from "../auth/form-alert";
import { errorsOf, pendingSecondFactorTypes, refused, textValue, type Outcome } from "../auth/form";
import type { PrivateRoute } from "../auth/private-routes";

export const NO_PENDING_LOGIN =
  "Aucune connexion en cours. Saisissez à nouveau votre e-mail et votre mot de passe.";
export const PASSKEY_REFUSED = "Passkey refusée. Utilisez une passkey enregistrée sur ce compte.";
const RATE_LIMITED = "Trop de tentatives. Réessayez dans quelques minutes.";

type Proof = { by: "code"; code: string } | { by: "passkey"; options: unknown };

async function authenticate(proof: Proof): Promise<Outcome<"signed-in">> {
  let result;
  if (proof.by === "code") {
    result = await authClient.POST("/api/v1/auth/app/v1/auth/2fa/authenticate", {
      body: { code: proof.code },
    });
  } else {
    let credential: Record<string, unknown>;
    try {
      credential = await getPasskey(proof.options);
    } catch (error) {
      return refused(error instanceof PasskeyError ? error.message : PASSKEY_FAILED);
    }
    result = await authClient.POST("/api/v1/auth/app/v1/auth/webauthn/authenticate", {
      body: { credential },
    });
  }
  const { response, error } = result;
  if (response.ok) return { kind: "signed-in" };
  if (response.status === 400) {
    // allauth rattache le refus d'une passkey au paramètre `credential`, sans champ à l'écran.
    return proof.by === "passkey"
      ? refused(PASSKEY_REFUSED)
      : { kind: "refused", errors: formErrors(error, SECOND_FACTOR_MESSAGES) };
  }
  // 409 : parcours expiré ou absent ; 401 : connexion annulée (plafond d'échecs atteint).
  if (response.status === 409 || response.status === 401) return refused(NO_PENDING_LOGIN);
  if (response.status === 429) return refused(RATE_LIMITED);
  return refused(UNAVAILABLE);
}

/** Méthodes du compte dont la connexion attend le second facteur (`null` : aucune connexion). */
function usePendingTypes() {
  return useQuery({
    queryKey: ["pending-second-factor"],
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { error } = await authClient.GET("/api/v1/auth/app/v1/auth/session");
      return pendingSecondFactorTypes(error);
    },
  });
}

/**
 * Second facteur à la connexion : code de l'application, code de secours, ou passkey. Les
 * options de passkey sont chargées avant le clic : certains navigateurs (Safari) n'ouvrent la
 * passkey qu'au plus près du geste de l'utilisateur.
 */
export function SecondFactorForm({ redirectTo = "/" }: { redirectTo?: PrivateRoute | "/" }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Change après chaque essai de passkey : un défi ne sert qu'une fois.
  const [challenge, setChallenge] = useState(0);
  // Connecté : plus de défi à demander (le cache vidé relancerait sinon la requête d'options).
  const [signedIn, setSignedIn] = useState(false);
  const types = usePendingTypes().data ?? null;
  const withPasskey = hydrated && passkeysSupported() && (types?.includes("webauthn") ?? false);
  const appCode = types?.includes("totp") ?? true;

  const passkeyOptions = useQuery({
    queryKey: ["passkey-second-factor", challenge],
    enabled: withPasskey && !signedIn,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data } = await authClient.GET("/api/v1/auth/app/v1/auth/webauthn/authenticate");
      if (!data) throw new Error("Options de passkey indisponibles");
      return data.data.request_options;
    },
  });

  const mutation = useMutation({
    // Mot de passe ou code dans les variables : rien ne reste en mémoire après le démontage.
    gcTime: 0,
    mutationFn: authenticate,
    onSuccess: (outcome, proof) => {
      if (outcome.kind !== "signed-in") {
        if (proof.by === "passkey") setChallenge((value) => value + 1);
        return;
      }
      setSignedIn(true);
      queryClient.clear();
      router.push(redirectTo);
    },
  });
  const errors = errorsOf(mutation.data, mutation.isError);
  const pending = mutation.isPending ? mutation.variables.by : null;

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = textValue(new FormData(event.currentTarget), "code").replace(/\s+/g, "");
    mutation.mutate({ by: "code", code });
  }

  // Compte sans application : la passkey devient l'action principale (une seule par écran).
  const passkeyFirst = withPasskey && !appCode;
  const passkeyButton = withPasskey && (
    <Button
      variant={passkeyFirst ? "primary" : "secondary"}
      size={passkeyFirst ? "lg" : "md"}
      block
      disabled={mutation.isPending || passkeyOptions.data === undefined}
      onClick={() => {
        mutation.mutate({ by: "passkey", options: passkeyOptions.data });
      }}
    >
      {pending === "passkey" ? "Vérification…" : "Utiliser une passkey"}
    </Button>
  );

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-1 flex-col gap-6">
      <TextField
        label="Code de vérification"
        name="code"
        autoComplete="one-time-code"
        inputMode="text"
        spellCheck={false}
        maxLength={24}
        hint={
          appCode
            ? "Le code à 6 chiffres de votre application, ou l’un de vos codes de secours."
            : "L’un de vos codes de secours, si vous n’avez pas votre passkey."
        }
        // allauth rattache l’erreur au paramètre de son API, `code`.
        error={errors.fields.code}
      />
      <FormAlert messages={errors.global} />
      <div className="mt-auto flex flex-col gap-3 pt-4 sm:mt-2">
        {passkeyFirst && passkeyButton}
        <Button
          type="submit"
          variant={passkeyFirst ? "secondary" : "primary"}
          size={passkeyFirst ? "md" : "lg"}
          block
          disabled={!hydrated || mutation.isPending}
        >
          {pending === "code" ? "Vérification…" : "Valider"}
        </Button>
        {!passkeyFirst && passkeyButton}
      </div>
    </form>
  );
}
