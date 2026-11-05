"use client";

import { useEffect, useRef, useState } from "react";
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
/** Message d'état ; `moveFocus` : le bloc va être remplacé, le focus ira au titre. */
type Announce = (text: string, moveFocus?: boolean) => void;

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

function Connect({ connection, onNotice }: { connection: Connection; onNotice: Announce }) {
  const hydrated = useHydrated();
  const start = useStartLogin();
  const complete = useCompleteLogin();
  const [url, setUrl] = useState("");
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

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
            <span>
              Préparez la connexion, puis ouvrez la page de Basic-Fit et connectez-vous (le lien est
              valable 10 minutes).
            </span>
            {authorizeUrl ? (
              <a
                ref={linkRef}
                href={authorizeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK}
              >
                Ouvrir la connexion Basic-Fit (nouvel onglet)
              </a>
            ) : (
              <Button
                variant="secondary"
                disabled={!hydrated}
                aria-disabled={start.isPending}
                onClick={() => {
                  if (start.isPending) return;
                  complete.reset();
                  start.mutate(undefined, {
                    onSuccess: (address) => {
                      // Le bouton laisse place au lien : le focus le suit.
                      flushSync(() => {
                        setAuthorizeUrl(address);
                      });
                      linkRef.current?.focus();
                      onNotice("Connexion préparée : ouvrez la page de Basic-Fit.");
                    },
                  });
                }}
              >
                Préparer la connexion
              </Button>
            )}
            <div role="alert" className="empty:hidden">
              {start.isError && (
                <p className="text-danger font-semibold">{failureText(start.error)}</p>
              )}
            </div>
          </div>
        </li>
        <li className="pl-1">
          <div className="flex flex-col gap-2">
            <span>
              Une fois connecté, le navigateur affiche une erreur ou une page vide : copiez
              l’adresse complète de la barre d’adresse et collez-la ci-dessous.
            </span>
            <p className="rounded-control border-danger border p-3 text-sm">
              <strong>Attention :</strong> ne transmettez jamais cette adresse à quelqu’un : elle
              relierait votre compte Basic-Fit à son compte Lest.
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
          start.reset();
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
              onNotice("Compte Basic-Fit relié. Première synchronisation dans l’heure.", true);
            },
          });
        }}
      >
        <TextField
          label="Adresse de redirection"
          name="redirect"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="url"
          spellCheck={false}
          value={url}
          hint="Elle commence par « com.basicfit.trainingapp: »."
          error={missing ? "Collez l’adresse copiée après la connexion." : undefined}
          onChange={(event) => {
            setUrl(event.target.value);
            setMissing(false);
          }}
        />
        <div role="alert" className="empty:hidden">
          {complete.isError && (
            <p className="rounded-control border-danger text-danger border p-4 font-semibold">
              {failureText(complete.error)}
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

function Linked({ connection, onNotice }: { connection: Connection; onNotice: Announce }) {
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
            {failureText(disconnect.error ?? sync.error)}
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
                sync.reset();
                disconnect.mutate(undefined, {
                  onSuccess: () => {
                    onNotice("Compte Basic-Fit délié.", true);
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
              disconnect.reset();
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
      {visits.isError && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-danger font-semibold">{BASICFIT_UNAVAILABLE}</p>
          <Button
            variant="secondary"
            aria-disabled={visits.isFetching}
            onClick={() => {
              if (!visits.isFetching) void visits.refetch();
            }}
          >
            Réessayer
          </Button>
        </div>
      )}
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
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Nouvel essai du chargement : le bouton disparaît au succès, le focus ira au titre.
  const focusTitle = useRef(false);
  const data = connection.data;
  const status = data?.status;

  useEffect(() => {
    if (!focusTitle.current || status === undefined) return;
    focusTitle.current = false;
    titleRef.current?.focus();
  }, [status]);

  const announce: Announce = (text, moveFocus = false) => {
    // Vidée puis remplie : un même message est annoncé de nouveau.
    flushSync(() => {
      setNotice("");
    });
    setNotice(text);
    // Le titre reste dans les deux états : il reçoit le focus avant que le bloc soit remplacé.
    if (moveFocus) titleRef.current?.focus();
  };

  // Rien tant que l'on ignore si l'intégration est activée (pas de titre éphémère).
  if (connection.isPending || (data && !data.enabled)) return null;
  return (
    <section
      aria-labelledby="basicfit-title"
      className="border-line-subtle flex flex-col gap-4 border-t pt-8"
    >
      <h2
        ref={titleRef}
        id="basicfit-title"
        tabIndex={-1}
        className="text-xl font-extrabold [font-stretch:112%]"
      >
        Basic-Fit
      </h2>
      {connection.isError && (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-danger font-semibold">
            {BASICFIT_UNAVAILABLE}
          </p>
          <Button
            variant="secondary"
            aria-disabled={connection.isFetching}
            onClick={() => {
              if (connection.isFetching) return;
              focusTitle.current = true;
              void connection.refetch();
            }}
          >
            {connection.isFetching ? "Nouvel essai…" : "Réessayer"}
          </Button>
        </div>
      )}
      {data &&
        (data.status === "connected" ? (
          <Linked connection={data} onNotice={announce} />
        ) : (
          <Connect connection={data} onNotice={announce} />
        ))}
      <p aria-live="polite" className="text-ink-muted empty:sr-only">
        {notice}
      </p>
    </section>
  );
}
