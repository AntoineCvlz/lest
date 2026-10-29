"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";

import { authClient } from "@/shared/api/auth-client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import {
  formErrors,
  NO_ERRORS,
  RATE_LIMITED,
  SECOND_FACTOR_MESSAGES,
  UNAVAILABLE,
  type FormErrors,
} from "../auth/errors";
import { FormAlert } from "../auth/form-alert";
import { requiresReauthentication, textValue } from "../auth/form";
import { QrCode } from "./qr-code";

const AUTHENTICATORS = "/api/v1/auth/app/v1/account/authenticators";
const TOTP = "/api/v1/auth/app/v1/account/authenticators/totp";
const RECOVERY_CODES = "/api/v1/auth/app/v1/account/authenticators/recovery-codes";
export const MFA_QUERY_KEY = ["mfa-authenticators"] as const;
export const MFA_ENABLED = "Double authentification activée (application).";
export const CONFIRM_AGAIN = "Votre confirmation a expiré : confirmez à nouveau pour continuer.";
export const CODES_UNAVAILABLE =
  "Vos codes de secours n’ont pas pu être affichés. Affichez-les avant de quitter cet écran.";

/**
 * Ce que l'utilisateur confirme : activer et afficher les codes se confirment par le mot de
 * passe ; désactiver exige un second facteur (code de l'application ou de secours), pour qu'un
 * mot de passe vu par-dessus l'épaule ne suffise pas à retirer la protection.
 */
type Intent = "enable" | "disable" | "codes";
type Step =
  | { kind: "idle" }
  | { kind: "confirm"; intent: Intent }
  | { kind: "setup"; secret: string; url: string }
  | { kind: "codes"; codes: string[] };

function errorsFrom(status: number, body: unknown, messages?: Record<string, string>): FormErrors {
  if (status === 400) return formErrors(body, messages);
  return { fields: {}, global: [status === 429 ? RATE_LIMITED : UNAVAILABLE] };
}

/** Méthodes actives du compte (`totp`, `recovery_codes`). */
function useAuthenticators() {
  return useQuery({
    queryKey: MFA_QUERY_KEY,
    queryFn: async (): Promise<string[]> => {
      const { data, response } = await authClient.GET(AUTHENTICATORS);
      if (!data) throw new Error(`Méthodes indisponibles (${String(response.status)})`);
      return data.data.map((authenticator) => authenticator.type);
    },
    retry: false,
  });
}

/**
 * Double authentification, optionnelle : activation (mot de passe, QR code, premier code, codes
 * de secours) et désactivation (second facteur). Les secrets ne quittent pas cet écran : rien
 * n'est gardé dans le cache de requêtes, et les mutations sont remises à zéro une fois réglées
 * (ni mot de passe ni code dans leurs variables).
 */
export function SecurityPanel() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const authenticators = useAuthenticators();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const enabled = authenticators.data?.includes("totp") ?? false;

  function confirmAgain(intent: Intent) {
    setStep({ kind: "confirm", intent });
    setErrors({ fields: {}, global: [CONFIRM_AGAIN] });
  }

  async function showRecoveryCodes(): Promise<void> {
    const { data, error, response } = await authClient.GET(RECOVERY_CODES);
    if (requiresReauthentication(response.status, error)) {
      confirmAgain("codes");
      return;
    }
    // Liste vide : l'écran le signale et propose de réessayer (jamais une liste vide « à noter »).
    setStep({
      kind: "codes",
      codes: data && "unused_codes" in data.data ? data.data.unused_codes : [],
    });
  }

  const confirm = useMutation({
    gcTime: 0,
    mutationFn: async ({ secret, intent }: { secret: string; intent: Intent }) => {
      const reauth =
        intent === "disable"
          ? await authClient.POST("/api/v1/auth/app/v1/auth/2fa/reauthenticate", {
              body: { code: secret },
            })
          : await authClient.POST("/api/v1/auth/app/v1/auth/reauthenticate", {
              body: { password: secret },
            });
      if (!reauth.response.ok) {
        setErrors(errorsFrom(reauth.response.status, reauth.error, SECOND_FACTOR_MESSAGES));
        return;
      }
      setErrors(NO_ERRORS);
      if (intent === "codes") {
        await showRecoveryCodes();
        return;
      }
      if (intent === "disable") {
        const { response } = await authClient.DELETE(TOTP);
        setStep({ kind: "idle" });
        if (!response.ok) setErrors({ fields: {}, global: [UNAVAILABLE] });
        await queryClient.invalidateQueries({ queryKey: MFA_QUERY_KEY });
        return;
      }
      // 404 : pas encore actif ; allauth propose alors un secret et son URL `otpauth://`.
      const { error, response } = await authClient.GET(TOTP);
      const meta = response.status === 404 && error && "meta" in error ? error.meta : undefined;
      if (!meta || !("secret" in meta)) {
        setErrors({ fields: {}, global: [UNAVAILABLE] });
        return;
      }
      setStep({ kind: "setup", secret: meta.secret, url: meta.totp_url });
    },
  });

  const activate = useMutation({
    gcTime: 0,
    mutationFn: async (code: string) => {
      const activated = await authClient.POST(TOTP, { body: { code } });
      // Confirmation trop ancienne (QR code scanné après le délai d'allauth) : la refaire.
      if (requiresReauthentication(activated.response.status, activated.error)) {
        confirmAgain("enable");
        return;
      }
      if (!activated.response.ok) {
        setErrors(errorsFrom(activated.response.status, activated.error));
        return;
      }
      setErrors(NO_ERRORS);
      await showRecoveryCodes();
    },
  });

  const busy = confirm.isPending || activate.isPending;

  function onConfirm(event: SubmitEvent<HTMLFormElement>, intent: Intent) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const secret =
      intent === "disable"
        ? textValue(form, "code").replace(/\s+/g, "")
        : textValue(form, "password");
    confirm.mutate(
      { secret, intent },
      {
        onSettled: () => {
          confirm.reset();
        },
      },
    );
  }

  function onCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    activate.mutate(textValue(new FormData(event.currentTarget), "code").replace(/\s+/g, ""), {
      onSettled: () => {
        activate.reset();
      },
    });
  }

  function cancel() {
    setStep({ kind: "idle" });
    setErrors(NO_ERRORS);
  }

  return (
    <section
      aria-labelledby="security-title"
      className="border-line-subtle flex flex-col gap-4 border-t pt-8"
    >
      <h2 id="security-title" className="text-xl font-extrabold [font-stretch:112%]">
        Sécurité
      </h2>

      {step.kind === "idle" && (
        <>
          <p role="status" className={enabled ? "text-ink font-semibold" : "text-ink-muted"}>
            {authenticators.isPending
              ? "Vérification…"
              : enabled
                ? MFA_ENABLED
                : "Ajoutez un code de vérification à la connexion : votre compte reste protégé même si votre mot de passe fuite."}
          </p>
          <FormAlert messages={errors.global} />
          {!authenticators.isPending && (
            <Button
              variant={enabled ? "danger" : "secondary"}
              onClick={() => {
                setErrors(NO_ERRORS);
                setStep({ kind: "confirm", intent: enabled ? "disable" : "enable" });
              }}
            >
              {enabled
                ? "Désactiver la double authentification"
                : "Activer la double authentification"}
            </Button>
          )}
        </>
      )}

      {step.kind === "confirm" && (
        <form
          method="post"
          noValidate
          onSubmit={(event) => {
            onConfirm(event, step.intent);
          }}
          className="flex flex-col gap-4"
        >
          {step.intent === "disable" ? (
            <TextField
              label="Code de l’application ou code de secours, pour confirmer"
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
          <Button
            type="submit"
            variant={step.intent === "disable" ? "danger" : "secondary"}
            disabled={!hydrated || busy}
          >
            {step.intent === "disable" ? "Désactiver" : "Continuer"}
          </Button>
          {/* Désactivé pendant l'envoi : une réponse arrivée après coup ne rouvre pas l'écran. */}
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            Annuler
          </Button>
        </form>
      )}

      {step.kind === "setup" && (
        <form method="post" noValidate onSubmit={onCode} className="flex flex-col gap-4">
          <p>Scannez ce QR code avec votre application d’authentification.</p>
          <QrCode value={step.url} label="QR code de configuration de l’application" />
          <p className="text-ink-muted text-sm">
            Ou saisissez cette clé :{" "}
            <code className="text-ink font-semibold break-all [font-variant-numeric:tabular-nums]">
              {step.secret}
            </code>
          </p>
          <TextField
            label="Code affiché par l’application"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={10}
            error={errors.fields.code}
          />
          <FormAlert messages={errors.global} />
          <Button type="submit" variant="secondary" disabled={!hydrated || busy}>
            Activer
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            Annuler
          </Button>
        </form>
      )}

      {step.kind === "codes" && (
        <div className="flex flex-col gap-4">
          <p role="status" className="font-semibold">
            {MFA_ENABLED}
          </p>
          {step.codes.length === 0 ? (
            <>
              <FormAlert messages={[CODES_UNAVAILABLE]} />
              <Button
                variant="secondary"
                onClick={() => {
                  setErrors(NO_ERRORS);
                  setStep({ kind: "confirm", intent: "codes" });
                }}
              >
                Afficher mes codes de secours
              </Button>
            </>
          ) : (
            <>
              <p>
                Notez ces codes de secours maintenant et gardez-les à l’abri : chacun permet une
                connexion si vous n’avez plus votre application.
              </p>
              <ul
                aria-label="Codes de secours"
                className="bg-surface-raised rounded-control grid grid-cols-2 gap-2 p-4 font-semibold [font-variant-numeric:tabular-nums]"
              >
                {step.codes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <Button
                variant="secondary"
                onClick={() => {
                  setStep({ kind: "idle" });
                  void queryClient.invalidateQueries({ queryKey: MFA_QUERY_KEY });
                }}
              >
                J’ai noté mes codes
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
