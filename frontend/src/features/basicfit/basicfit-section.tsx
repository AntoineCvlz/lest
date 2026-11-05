"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { longDay } from "@/shared/lib/days";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

import {
  BasicFitRequestFailed,
  type Connection,
  useCompleteLogin,
  useConnection,
  useDisconnect,
  useStartLogin,
  useSyncNow,
  useVisits,
  VISIT_DAYS,
} from "./use-basicfit";

export const BASICFIT_UNAVAILABLE = "Liaison Basic-Fit indisponible pour le moment.";
const LINK =
  "text-ink inline-flex min-h-11 items-center font-semibold underline underline-offset-4";
const MOMENT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

/** Message d'un refus de l'API, sans jamais reprendre l'adresse collée. */
export function failureText(error: unknown): string {
  if (!(error instanceof BasicFitRequestFailed)) return BASICFIT_UNAVAILABLE;
  if (error.type.endsWith("basicfit-redirect-refused")) {
    return "Adresse refusée : elle doit être complète, venir de la connexion préparée ici il y a moins de 10 minutes. Recommencez la connexion.";
  }
  if (error.type.endsWith("basicfit-login-refused")) {
    return "Basic-Fit a refusé la connexion (adresse expirée ou déjà utilisée). Recommencez.";
  }
  if (error.type.endsWith("basicfit-too-soon")) {
    return "Synchronisation déjà demandée il y a moins d’une heure.";
  }
  if (error.type.endsWith("basicfit-not-connected")) {
    return "Reliez d’abord votre compte Basic-Fit.";
  }
  if (error.status === 429) return "Trop de tentatives. Réessayez plus tard.";
  if (error.status === 503) return "Basic-Fit ne répond pas. Réessayez plus tard.";
  return BASICFIT_UNAVAILABLE;
}

function Imported() {
  return (
    <div className="flex flex-col gap-2">
      <p>
        Lest relève votre <strong>club principal</strong>, vos <strong>visites en club</strong> et
        le <strong>poids mesuré par les balances du club</strong>, rien d’autre (ni composition
        corporelle, ni données d’abonnement). Une pesée que vous notez vous-même n’est jamais
        remplacée.
      </p>
      <p className="text-ink-muted text-sm">
        L’accès passe par l’application de Basic-Fit, sans accord de leur part : il peut cesser à
        tout moment. Synchronisation au plus une fois par heure.
      </p>
    </div>
  );
}

function Connect({
  connection,
  onNotice,
}: {
  connection: Connection;
  onNotice: (text: string) => void;
}) {
  const hydrated = useHydrated();
  const start = useStartLogin();
  const complete = useCompleteLogin();
  const [url, setUrl] = useState("");
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-4">
      {connection.status === "expired" && (
        <p className="text-danger font-semibold">
          Basic-Fit n’accepte plus l’accès de Lest : reliez à nouveau votre compte.
        </p>
      )}
      <Imported />
      <ol className="marker:text-ink-muted flex list-decimal flex-col gap-3 pl-6 marker:font-bold">
        <li className="pl-1">
          <div className="flex flex-col items-start gap-2">
            <span>Préparez la connexion, puis ouvrez la page de Basic-Fit et connectez-vous.</span>
            {authorizeUrl ? (
              <a href={authorizeUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
                Ouvrir la connexion Basic-Fit (nouvel onglet)
              </a>
            ) : (
              <Button
                variant="secondary"
                disabled={!hydrated}
                aria-disabled={start.isPending}
                onClick={() => {
                  if (start.isPending) return;
                  start.mutate(undefined, {
                    onSuccess: (address) => {
                      setAuthorizeUrl(address);
                      onNotice("Connexion préparée : ouvrez la page de Basic-Fit.");
                    },
                  });
                }}
              >
                Préparer la connexion
              </Button>
            )}
          </div>
        </li>
        <li className="pl-1">
          <div className="flex flex-col gap-2">
            <span>
              Une fois connecté, le navigateur affiche une erreur ou une page vide : copiez
              l’adresse complète de la barre d’adresse (elle commence par «
              com.basicfit.trainingapp: ») et collez-la ci-dessous.
            </span>
            <p className="rounded-control border-danger border p-3 text-sm font-semibold">
              Ne transmettez jamais cette adresse à quelqu’un : elle relierait votre compte
              Basic-Fit à son compte Lest.
            </p>
          </div>
        </li>
      </ol>
      <form
        ref={formRef}
        method="post"
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (complete.isPending) return;
          complete.reset();
          const value = url.trim();
          flushSync(() => {
            setMissing(value === "");
          });
          if (value === "") {
            formRef.current?.querySelector<HTMLElement>("input[name=redirect]")?.focus();
            return;
          }
          complete.mutate(value, {
            onSuccess: () => {
              setUrl("");
              setAuthorizeUrl(null);
              onNotice("Compte Basic-Fit relié. Première synchronisation dans l’heure.");
            },
          });
        }}
      >
        <TextField
          label="Adresse de redirection"
          name="redirect"
          autoComplete="off"
          spellCheck={false}
          value={url}
          error={missing ? "Collez l’adresse copiée après la connexion." : undefined}
          onChange={(event) => {
            setUrl(event.target.value);
          }}
        />
        <div role="alert" className="empty:hidden">
          {(start.isError || complete.isError) && (
            <p className="rounded-control border-danger text-danger border p-4 font-semibold">
              {failureText(start.error ?? complete.error)}
            </p>
          )}
        </div>
        <Button
          type="submit"
          variant="primary"
          block
          disabled={!hydrated}
          aria-disabled={complete.isPending}
        >
          Relier mon compte
        </Button>
      </form>
    </div>
  );
}

function Linked({
  connection,
  onNotice,
}: {
  connection: Connection;
  onNotice: (text: string) => void;
}) {
  const sync = useSyncNow();
  const disconnect = useDisconnect();
  const visits = useVisits(true);
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const rows = (visits.data ?? []).toReversed();

  function focus(selector: string) {
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <dl className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-ink-muted">Club principal :</dt>
          <dd className="font-semibold">{connection.home_club || "pas encore relevé"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-ink-muted">Dernière synchronisation :</dt>
          <dd className="font-semibold">
            {connection.last_sync_at
              ? MOMENT.format(new Date(connection.last_sync_at))
              : "pas encore faite"}
          </dd>
        </div>
      </dl>
      {connection.last_error === "unavailable" && (
        <p className="text-ink-muted">
          Basic-Fit n’a pas répondu à la dernière tentative ; un nouvel essai est prévu.
        </p>
      )}
      <Imported />
      <div role="alert" className="empty:hidden">
        {(sync.isError || disconnect.isError) && (
          <p className="rounded-control border-danger text-danger border p-4 font-semibold">
            {failureText(sync.error ?? disconnect.error)}
          </p>
        )}
      </div>
      {confirming ? (
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Délier Basic-Fit ?</p>
          <p className="text-ink-muted text-sm">
            Les visites et pesées déjà relevées restent dans Lest. Pour fermer aussi la session
            ouverte chez Basic-Fit, déconnectez les appareils depuis leur application.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="danger"
              aria-disabled={disconnect.isPending}
              onClick={() => {
                if (disconnect.isPending) return;
                disconnect.mutate(undefined, {
                  onSuccess: () => {
                    onNotice("Compte Basic-Fit délié.");
                  },
                });
              }}
            >
              Délier
            </Button>
            <Button
              variant="secondary"
              data-focus="keep"
              onClick={() => {
                flushSync(() => {
                  setConfirming(false);
                });
                focus("[data-focus=unlink]");
              }}
            >
              Garder
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(12rem,100%),1fr))] gap-3">
          <Button
            variant="secondary"
            aria-disabled={sync.isPending}
            onClick={() => {
              if (sync.isPending) return;
              sync.reset();
              sync.mutate(undefined, {
                onSuccess: () => {
                  onNotice("Synchronisation demandée : elle aura lieu dans quelques instants.");
                },
              });
            }}
          >
            Synchroniser maintenant
          </Button>
          <Button
            variant="danger"
            data-focus="unlink"
            onClick={() => {
              flushSync(() => {
                setConfirming(true);
              });
              focus("[data-focus=keep]");
            }}
          >
            Délier Basic-Fit
          </Button>
        </div>
      )}
      <h3 className="text-ink-muted text-sm font-semibold">
        {`Visites des ${String(VISIT_DAYS)} derniers jours`}
      </h3>
      {visits.isPending && <p className="text-ink-muted">Chargement des visites…</p>}
      {visits.isError && <p className="text-danger font-semibold">{BASICFIT_UNAVAILABLE}</p>}
      {visits.isSuccess &&
        (rows.length === 0 ? (
          <p className="text-ink-muted">Aucune visite relevée sur cette période.</p>
        ) : (
          <ul
            aria-label="Visites en club, les plus récentes d’abord"
            className="border-line-subtle border-t"
          >
            {rows.map((visit) => (
              <li key={visit.date} className="border-line-subtle flex flex-col gap-1 border-b py-2">
                <time dateTime={visit.date} className="font-semibold">
                  {longDay(visit.date)}
                </time>
                {visit.club && <span className="text-ink-muted text-sm">{visit.club}</span>}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/**
 * Liaison Basic-Fit (ADR 0014), dans le profil : connexion en deux étapes (page de Basic-Fit,
 * puis adresse de redirection collée), puis club, visites et synchronisation. Absente quand
 * l'intégration est désactivée.
 */
export function BasicFitSection() {
  const connection = useConnection();
  const [notice, setNotice] = useState("");
  const data = connection.data;

  if (data && !data.enabled) return null;
  return (
    <section
      aria-labelledby="basicfit-title"
      className="border-line-subtle flex flex-col gap-4 border-t pt-8"
    >
      <h2 id="basicfit-title" className="text-xl font-extrabold [font-stretch:112%]">
        Basic-Fit
      </h2>
      {connection.isPending && <p className="text-ink-muted">Chargement de la liaison…</p>}
      {connection.isError && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-danger font-semibold">{BASICFIT_UNAVAILABLE}</p>
          <Button
            variant="secondary"
            onClick={() => {
              void connection.refetch();
            }}
          >
            Réessayer
          </Button>
        </div>
      )}
      {data &&
        (data.status === "connected" ? (
          <Linked connection={data} onNotice={setNotice} />
        ) : (
          <Connect connection={data} onNotice={setNotice} />
        ))}
      <p aria-live="polite" className="text-ink-muted empty:sr-only">
        {notice}
      </p>
    </section>
  );
}
