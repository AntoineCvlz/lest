"use client";

import { useState, type SubmitEvent } from "react";

import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import type { FormErrors } from "../auth/errors";
import { FormAlert } from "../auth/form-alert";
import { textValue } from "../auth/form";
import { getPasskey, PASSKEY_FAILED, PasskeyError } from "@/shared/lib/webauthn";

/** Preuve d'identité donnée pour confirmer une action sensible. */
export type Proof =
  | { by: "password"; password: string }
  | { by: "code"; code: string }
  | { by: "passkey"; credential: Record<string, unknown> };

interface ConfirmFormProps {
  /** Mot de passe tant que le compte n'a aucun facteur ; second facteur ensuite. */
  bySecondFactor: boolean;
  /** Faux si le compte n'a que des passkeys : seul un code de secours peut alors être saisi. */
  appCode: boolean;
  /** Options de réauthentification par passkey, chargées d'avance (absentes : pas de bouton). */
  passkeyOptions: unknown;
  submitLabel: string;
  danger?: boolean;
  busy: boolean;
  /** Options de passkey en cours de chargement : aucun envoi avant leur réponse. */
  loadingChallenge: boolean;
  errors: FormErrors;
  onProof: (proof: Proof) => void;
  onPasskeyError: (message: string) => void;
  onCancel: () => void;
}

/**
 * Confirmation d'une action sensible. Les options de passkey sont chargées avant le clic :
 * certains navigateurs (Safari) n'ouvrent la passkey qu'au plus près du geste de l'utilisateur.
 */
export function ConfirmForm({
  bySecondFactor,
  appCode,
  passkeyOptions,
  submitLabel,
  danger = false,
  busy,
  loadingChallenge,
  errors,
  onProof,
  onPasskeyError,
  onCancel,
}: ConfirmFormProps) {
  const hydrated = useHydrated();
  const [usingPasskey, setUsingPasskey] = useState(false);
  const disabled = !hydrated || busy || usingPasskey || loadingChallenge;

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onProof(
      bySecondFactor
        ? { by: "code", code: textValue(form, "code").replace(/\s+/g, "") }
        : { by: "password", password: textValue(form, "password") },
    );
  }

  async function confirmWithPasskey() {
    setUsingPasskey(true);
    try {
      onProof({ by: "passkey", credential: await getPasskey(passkeyOptions) });
    } catch (error) {
      onPasskeyError(error instanceof PasskeyError ? error.message : PASSKEY_FAILED);
    } finally {
      setUsingPasskey(false);
    }
  }

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {bySecondFactor ? (
        <TextField
          label={
            appCode
              ? "Code de l’application ou code de secours, pour confirmer"
              : "Code de secours, pour confirmer"
          }
          name="code"
          autoComplete="one-time-code"
          maxLength={20}
          error={errors.fields.code}
        />
      ) : (
        <TextField
          label="Mot de passe, pour confirmer"
          name="password"
          type="password"
          autoComplete="current-password"
          error={errors.fields.password}
        />
      )}
      <FormAlert messages={errors.global} />
      <Button type="submit" variant={danger ? "danger" : "secondary"} disabled={disabled}>
        {submitLabel}
      </Button>
      {bySecondFactor && passkeyOptions !== undefined && (
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            void confirmWithPasskey();
          }}
        >
          Confirmer avec une passkey
        </Button>
      )}
      {/* Désactivé pendant l'envoi : une réponse arrivée après coup ne rouvre pas l'écran. */}
      <Button variant="ghost" onClick={onCancel} disabled={busy || usingPasskey}>
        Annuler
      </Button>
    </form>
  );
}
