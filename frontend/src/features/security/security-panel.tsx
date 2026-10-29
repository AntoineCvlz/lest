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
import { ConfirmForm, type Proof } from "./confirm-form";
import { DEVICE_SESSIONS_KEY, MFA_QUERY_KEY } from "./query-keys";
import { PasskeyList, type Passkey } from "./passkey-list";
import { QrCode } from "./qr-code";
import {
  createPasskey,
  PASSKEY_FAILED,
  PasskeyError,
  passkeysSupported,
} from "@/shared/lib/webauthn";

export { MFA_QUERY_KEY };

const AUTHENTICATORS = "/api/v1/auth/app/v1/account/authenticators";
const TOTP = "/api/v1/auth/app/v1/account/authenticators/totp";
const WEBAUTHN = "/api/v1/auth/app/v1/account/authenticators/webauthn";
const RECOVERY_CODES = "/api/v1/auth/app/v1/account/authenticators/recovery-codes";
export const MFA_ENABLED = "Double authentification activée (application).";
export const PASSKEY_ADDED = "Passkey ajoutée : vous pouvez l’utiliser pour vous connecter.";
export const PASSKEY_REMOVED = "Passkey retirée.";
export const CONFIRM_AGAIN = "Votre confirmation a expiré : confirmez à nouveau pour continuer.";
export const CODES_UNAVAILABLE =
  "Vos codes de secours n’ont pas pu être affichés. Affichez-les avant de quitter cet écran.";
export const PASSKEY_REFUSED = "Passkey refusée. Utilisez une passkey enregistrée sur ce compte.";
export const FACTORS_UNAVAILABLE =
  "Vos méthodes de connexion n’ont pas pu être chargées. Réessayez pour les gérer.";

/**
 * Ce que l'utilisateur confirme. Tant que le compte n'a aucun facteur, le mot de passe suffit
 * pour en ajouter un ; ensuite, toute action sur les facteurs ou les codes de secours exige un
 * second facteur (code ou passkey), pour qu'un mot de passe vu par-dessus l'épaule ne suffise
 * pas. L'API l'impose aussi (`apps/accounts/mfa_views.py`).
 */
type Intent =
  | { kind: "enable-totp" }
  | { kind: "disable-totp" }
  | { kind: "codes" }
  | { kind: "add-passkey" }
  | { kind: "remove-passkey"; passkey: Passkey };

type Step =
  | { kind: "idle" }
  | { kind: "confirm"; intent: Intent }
  | { kind: "setup"; secret: string; url: string }
  | { kind: "name-passkey"; options: unknown }
  | { kind: "codes"; codes: string[]; notice: string };

const SUBMIT_LABELS: Record<Intent["kind"], string> = {
  "enable-totp": "Continuer",
  "disable-totp": "Désactiver",
  codes: "Continuer",
  "add-passkey": "Continuer",
  "remove-passkey": "Retirer la passkey",
};

function errorsFrom(status: number, body: unknown, messages?: Record<string, string>): FormErrors {
  if (status === 400) return formErrors(body, messages);
  return { fields: {}, global: [status === 429 ? RATE_LIMITED : UNAVAILABLE] };
}

const failure = (message: string): FormErrors => ({ fields: {}, global: [message] });

/** Facteurs du compte : application (`totp`) et passkeys. */
function useAuthenticators() {
  return useQuery({
    queryKey: MFA_QUERY_KEY,
    queryFn: async () => {
      const { data, response } = await authClient.GET(AUTHENTICATORS);
      if (!data) throw new Error(`Méthodes indisponibles (${String(response.status)})`);
      const passkeys: Passkey[] = [];
      for (const authenticator of data.data) {
        if (authenticator.type === "webauthn") {
          const { id, name, created_at } = authenticator;
          passkeys.push({ id, name, createdAt: created_at });
        }
      }
      return { totp: data.data.some(({ type }) => type === "totp"), passkeys };
    },
    retry: false,
  });
}

async function reauthenticate(proof: Proof) {
  switch (proof.by) {
    case "password":
      return authClient.POST("/api/v1/auth/app/v1/auth/reauthenticate", {
        body: { password: proof.password },
      });
    case "code":
      return authClient.POST("/api/v1/auth/app/v1/auth/2fa/reauthenticate", {
        body: { code: proof.code },
      });
    case "passkey":
      return authClient.POST("/api/v1/auth/app/v1/auth/webauthn/reauthenticate", {
        body: { credential: proof.credential },
      });
  }
}

/**
 * Double authentification, optionnelle : application (QR code, premier code, codes de secours)
 * et passkeys. Les secrets ne quittent pas cet écran : rien n'est gardé dans le cache de
 * requêtes, et les mutations sont remises à zéro une fois réglées (ni mot de passe ni code dans
 * leurs variables).
 */
export function SecurityPanel() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const authenticators = useAuthenticators();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [notice, setNotice] = useState<string | null>(null);
  // Change à chaque confirmation et après un refus : un défi de passkey ne sert qu'une fois.
  const [challenge, setChallenge] = useState(0);

  const totpEnabled = authenticators.data?.totp ?? false;
  const passkeys = authenticators.data?.passkeys ?? [];
  const hasFactor = totpEnabled || passkeys.length > 0;
  const supported = hydrated && passkeysSupported();
  const bySecondFactor = (intent: Intent): boolean =>
    hasFactor || (intent.kind !== "enable-totp" && intent.kind !== "add-passkey");

  const confirming = step.kind === "confirm" && bySecondFactor(step.intent);
  const passkeyOptions = useQuery({
    queryKey: ["passkey-reauthentication", challenge],
    enabled: confirming && supported && passkeys.length > 0,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data } = await authClient.GET("/api/v1/auth/app/v1/auth/webauthn/reauthenticate");
      if (!data) throw new Error("Options de passkey indisponibles");
      return data.data.request_options;
    },
  });

  function startConfirm(intent: Intent, message?: string) {
    setChallenge((value) => value + 1);
    setNotice(null);
    setStep({ kind: "confirm", intent });
    setErrors(message ? failure(message) : NO_ERRORS);
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: MFA_QUERY_KEY });
    // Un facteur ajouté déconnecte les autres appareils (API) : la liste change aussi.
    await queryClient.invalidateQueries({ queryKey: DEVICE_SESSIONS_KEY });
  }

  /** 401 de réauthentification : les facteurs ont pu changer (autre session), le mode de
   * confirmation aussi. On les recharge avant de redemander. */
  async function confirmAgain(intent: Intent) {
    await refresh();
    startConfirm(intent, CONFIRM_AGAIN);
  }

  async function showRecoveryCodes(notice: string): Promise<void> {
    const { data, error, response } = await authClient.GET(RECOVERY_CODES);
    if (requiresReauthentication(response.status, error)) {
      await confirmAgain({ kind: "codes" });
      return;
    }
    // Liste vide : l'écran le signale et propose de réessayer (jamais une liste vide « à noter »).
    setStep({
      kind: "codes",
      codes: data && "unused_codes" in data.data ? data.data.unused_codes : [],
      notice,
    });
  }

  /** Action confirmée : chaque branche décide de l'étape suivante. */
  async function perform(intent: Intent): Promise<void> {
    switch (intent.kind) {
      case "codes":
        await showRecoveryCodes(MFA_ENABLED);
        return;
      case "disable-totp": {
        const { response } = await authClient.DELETE(TOTP);
        setStep({ kind: "idle" });
        if (!response.ok) setErrors(failure(UNAVAILABLE));
        await refresh();
        return;
      }
      case "remove-passkey": {
        const { response } = await authClient.DELETE(WEBAUTHN, {
          body: { authenticators: [intent.passkey.id] },
        });
        setStep({ kind: "idle" });
        if (response.ok) setNotice(PASSKEY_REMOVED);
        else setErrors(failure(UNAVAILABLE));
        await refresh();
        return;
      }
      case "add-passkey": {
        // `passwordless` : clé résidente et vérification de l'utilisateur exigées (connexion
        // sans mot de passe). Options chargées avant le geste qui ouvre la passkey.
        const { data, error, response } = await authClient.GET(WEBAUTHN, {
          params: { query: { passwordless: true } },
        });
        if (requiresReauthentication(response.status, error)) {
          await confirmAgain(intent);
          return;
        }
        if (!data) {
          setErrors(failure(UNAVAILABLE));
          return;
        }
        setStep({ kind: "name-passkey", options: data.data.creation_options });
        return;
      }
      case "enable-totp": {
        // 404 : pas encore actif ; allauth propose alors un secret et son URL `otpauth://`.
        const { error, response } = await authClient.GET(TOTP);
        const meta = response.status === 404 && error && "meta" in error ? error.meta : undefined;
        if (!meta || !("secret" in meta)) {
          setErrors(failure(UNAVAILABLE));
          return;
        }
        setStep({ kind: "setup", secret: meta.secret, url: meta.totp_url });
        return;
      }
    }
  }

  const confirm = useMutation({
    gcTime: 0,
    mutationFn: async ({ proof, intent }: { proof: Proof; intent: Intent }) => {
      const reauth = await reauthenticate(proof);
      if (!reauth.response.ok) {
        const { status } = reauth.response;
        if (proof.by === "passkey") {
          // allauth rattache le refus au paramètre `credential`, sans champ à l'écran.
          setErrors(status === 400 ? failure(PASSKEY_REFUSED) : errorsFrom(status, reauth.error));
          setChallenge((value) => value + 1);
        } else {
          setErrors(errorsFrom(status, reauth.error, SECOND_FACTOR_MESSAGES));
        }
        return;
      }
      setErrors(NO_ERRORS);
      await perform(intent);
    },
  });

  const activate = useMutation({
    gcTime: 0,
    mutationFn: async (code: string) => {
      const activated = await authClient.POST(TOTP, { body: { code } });
      // Confirmation trop ancienne (QR code scanné après le délai d'allauth) : la refaire.
      if (requiresReauthentication(activated.response.status, activated.error)) {
        await confirmAgain({ kind: "enable-totp" });
        return;
      }
      if (!activated.response.ok) {
        setErrors(errorsFrom(activated.response.status, activated.error));
        return;
      }
      setErrors(NO_ERRORS);
      await showRecoveryCodes(MFA_ENABLED);
    },
  });

  const addPasskey = useMutation({
    gcTime: 0,
    mutationFn: async ({ options, name }: { options: unknown; name: string }) => {
      let credential: Record<string, unknown>;
      try {
        credential = await createPasskey(options);
      } catch (error) {
        // Annulation : l'étape reste ouverte, les mêmes options resservent.
        setErrors(failure(error instanceof PasskeyError ? error.message : PASSKEY_FAILED));
        return;
      }
      const added = await authClient.POST(WEBAUTHN, { body: { name, credential } });
      if (requiresReauthentication(added.response.status, added.error)) {
        await confirmAgain({ kind: "add-passkey" });
        return;
      }
      if (!added.data) {
        // Défi consommé ou réponse refusée : tout recommencer depuis la liste.
        setStep({ kind: "idle" });
        setErrors(failure(PASSKEY_FAILED));
        return;
      }
      setErrors(NO_ERRORS);
      if (added.data.meta.recovery_codes_generated) {
        await showRecoveryCodes(PASSKEY_ADDED);
      } else {
        setStep({ kind: "idle" });
        setNotice(PASSKEY_ADDED);
      }
      await refresh();
    },
  });

  const busy = confirm.isPending || activate.isPending || addPasskey.isPending;

  function onCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    activate.mutate(textValue(new FormData(event.currentTarget), "code").replace(/\s+/g, ""), {
      onSettled: () => {
        activate.reset();
      },
    });
  }

  function onName(event: SubmitEvent<HTMLFormElement>, options: unknown) {
    event.preventDefault();
    const name = textValue(new FormData(event.currentTarget), "name").trim();
    addPasskey.mutate(
      { options, name },
      {
        onSettled: () => {
          addPasskey.reset();
        },
      },
    );
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
          <h3 className="text-lg font-bold [font-stretch:112%]">Application d’authentification</h3>
          <p role="status" className={totpEnabled ? "text-ink font-semibold" : "text-ink-muted"}>
            {authenticators.isPending
              ? "Vérification…"
              : authenticators.isError
                ? FACTORS_UNAVAILABLE
                : totpEnabled
                  ? MFA_ENABLED
                  : "Ajoutez un code de vérification à la connexion : votre compte reste protégé même si votre mot de passe fuite."}
          </p>
          <FormAlert messages={errors.global} />
          {authenticators.isError && (
            <Button
              variant="secondary"
              onClick={() => {
                void authenticators.refetch();
              }}
            >
              Réessayer
            </Button>
          )}
          {/* Sans la liste des facteurs, pas d'action : l'écran mentirait sur leur état. */}
          {authenticators.isSuccess && (
            <>
              <Button
                variant={totpEnabled ? "danger" : "secondary"}
                onClick={() => {
                  startConfirm({ kind: totpEnabled ? "disable-totp" : "enable-totp" });
                }}
              >
                {totpEnabled
                  ? "Désactiver la double authentification"
                  : "Activer la double authentification"}
              </Button>
              <PasskeyList
                passkeys={passkeys}
                supported={supported}
                hydrated={hydrated}
                notice={notice}
                onAdd={() => {
                  startConfirm({ kind: "add-passkey" });
                }}
                onRemove={(passkey) => {
                  startConfirm({ kind: "remove-passkey", passkey });
                }}
              />
            </>
          )}
        </>
      )}

      {step.kind === "confirm" && (
        <>
          {step.intent.kind === "remove-passkey" && (
            <p>
              Retirer la passkey « {step.intent.passkey.name} » : elle ne permettra plus de vous
              connecter.
            </p>
          )}
          <ConfirmForm
            bySecondFactor={bySecondFactor(step.intent)}
            appCode={totpEnabled || passkeys.length === 0}
            passkeyOptions={passkeyOptions.data}
            submitLabel={SUBMIT_LABELS[step.intent.kind]}
            danger={step.intent.kind === "disable-totp" || step.intent.kind === "remove-passkey"}
            busy={busy}
            // Un défi de passkey en cours d'enregistrement écraserait le suivant (une seule clé
            // de session côté allauth) : pas d'envoi avant sa réponse.
            loadingChallenge={passkeyOptions.isFetching}
            errors={errors}
            onProof={(proof) => {
              confirm.mutate(
                { proof, intent: step.intent },
                {
                  onSettled: () => {
                    confirm.reset();
                  },
                },
              );
            }}
            onPasskeyError={(message) => {
              setErrors(failure(message));
            }}
            onCancel={cancel}
          />
        </>
      )}

      {step.kind === "name-passkey" && (
        <form
          method="post"
          noValidate
          onSubmit={(event) => {
            onName(event, step.options);
          }}
          className="flex flex-col gap-4"
        >
          <TextField
            label="Nom de la passkey"
            name="name"
            defaultValue="Passkey"
            maxLength={100}
            hint="Pour la reconnaître dans la liste : téléphone, ordinateur, clé de sécurité…"
          />
          <FormAlert messages={errors.global} />
          <Button type="submit" variant="secondary" disabled={!hydrated || busy}>
            Créer la passkey
          </Button>
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
            {step.notice}
          </p>
          {step.codes.length === 0 ? (
            <>
              <FormAlert messages={[CODES_UNAVAILABLE]} />
              <Button
                variant="secondary"
                onClick={() => {
                  startConfirm({ kind: "codes" });
                }}
              >
                Afficher mes codes de secours
              </Button>
            </>
          ) : (
            <>
              <p>
                Notez ces codes de secours maintenant et gardez-les à l’abri : chacun permet une
                connexion si vous n’avez plus votre application ni votre passkey.
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
                  void refresh();
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
