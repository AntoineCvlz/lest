"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";

import { authClient } from "@/shared/api/auth-client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import { formErrors, UNAVAILABLE, type FormErrors } from "../auth/errors";
import { FormAlert } from "../auth/form-alert";
import { textValue } from "../auth/form";
import { QrCode } from "./qr-code";

const AUTHENTICATORS = "/api/v1/auth/app/v1/account/authenticators";
const TOTP = "/api/v1/auth/app/v1/account/authenticators/totp";
const RECOVERY_CODES = "/api/v1/auth/app/v1/account/authenticators/recovery-codes";
export const MFA_QUERY_KEY = ["mfa-authenticators"] as const;
export const MFA_ENABLED = "Double authentification activée (application).";

type Intent = "enable" | "disable";
type Step =
  | { kind: "idle" }
  | { kind: "password"; intent: Intent }
  | { kind: "setup"; secret: string; url: string }
  | { kind: "codes"; codes: string[] };

function errorsFrom(status: number, body: unknown): FormErrors {
  return status === 400 ? formErrors(body) : { fields: {}, global: [UNAVAILABLE] };
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
 * de secours affichés une fois) et désactivation (mot de passe). Les secrets ne quittent pas
 * cet écran : rien n'est gardé dans le cache de requêtes.
 */
export function SecurityPanel() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const authenticators = useAuthenticators();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [errors, setErrors] = useState<FormErrors>({ fields: {}, global: [] });
  const enabled = authenticators.data?.includes("totp") ?? false;

  const reauthenticate = useMutation({
    gcTime: 0,
    mutationFn: async ({ password, intent }: { password: string; intent: Intent }) => {
      const reauth = await authClient.POST("/api/v1/auth/app/v1/auth/reauthenticate", {
        body: { password },
      });
      if (!reauth.response.ok) {
        setErrors(errorsFrom(reauth.response.status, reauth.error));
        return;
      }
      setErrors({ fields: {}, global: [] });
      if (intent === "disable") {
        const { response } = await authClient.DELETE(TOTP);
        if (!response.ok) setErrors({ fields: {}, global: [UNAVAILABLE] });
        setStep({ kind: "idle" });
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
      if (!activated.response.ok) {
        setErrors(errorsFrom(activated.response.status, activated.error));
        return;
      }
      setErrors({ fields: {}, global: [] });
      const { data } = await authClient.GET(RECOVERY_CODES);
      setStep({
        kind: "codes",
        codes: data && "unused_codes" in data.data ? data.data.unused_codes : [],
      });
    },
  });

  function onPassword(event: SubmitEvent<HTMLFormElement>, intent: Intent) {
    event.preventDefault();
    reauthenticate.mutate({
      password: textValue(new FormData(event.currentTarget), "password"),
      intent,
    });
  }

  function onCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    activate.mutate(textValue(new FormData(event.currentTarget), "code").replace(/\s+/g, ""));
  }

  function cancel() {
    setStep({ kind: "idle" });
    setErrors({ fields: {}, global: [] });
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
                setStep({ kind: "password", intent: enabled ? "disable" : "enable" });
              }}
            >
              {enabled
                ? "Désactiver la double authentification"
                : "Activer la double authentification"}
            </Button>
          )}
        </>
      )}

      {step.kind === "password" && (
        <form
          method="post"
          noValidate
          onSubmit={(event) => {
            onPassword(event, step.intent);
          }}
          className="flex flex-col gap-4"
        >
          <TextField
            label="Mot de passe, pour confirmer"
            name="password"
            type="password"
            autoComplete="current-password"
            error={errors.fields.password}
          />
          <FormAlert messages={errors.global} />
          <Button
            type="submit"
            variant={step.intent === "disable" ? "danger" : "secondary"}
            disabled={!hydrated || reauthenticate.isPending}
          >
            {step.intent === "disable" ? "Désactiver" : "Continuer"}
          </Button>
          <Button variant="ghost" onClick={cancel}>
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
          <Button type="submit" variant="secondary" disabled={!hydrated || activate.isPending}>
            Activer
          </Button>
          <Button variant="ghost" onClick={cancel}>
            Annuler
          </Button>
        </form>
      )}

      {step.kind === "codes" && (
        <div className="flex flex-col gap-4">
          <p role="status" className="font-semibold">
            {MFA_ENABLED}
          </p>
          <p>
            Notez ces codes de secours et gardez-les à l’abri : chacun permet une connexion si vous
            n’avez plus votre application. Ils ne seront plus affichés.
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
        </div>
      )}
    </section>
  );
}
