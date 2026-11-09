"use client";

import { ACTIVITIES_KEY } from "@/features/activities/query-keys";
import { BASICFIT_KEY } from "@/features/basicfit/query-keys";
import { INSIGHTS_KEY } from "@/features/insights/query-keys";
import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import { BODY_KEY } from "@/features/body/query-keys";
import { NUTRITION_KEY } from "@/features/nutrition/query-keys";
import { forgetAccount } from "@/features/offline/account";
import { QUEUED_KEY } from "@/features/offline/queue";
import { PROFILE_QUERY_KEY, useProfile } from "@/features/profile/use-profile";
import { DEVICE_SESSIONS_KEY, MFA_QUERY_KEY } from "@/features/security/query-keys";
import { PROGRAMS_KEY, WORKOUTS_KEY } from "@/features/training/query-keys";
import { $api } from "@/shared/api/client";
import { authClient } from "@/shared/api/auth-client";
import { clearCachedPages } from "@/shared/pwa/service-worker";
import { Button } from "@/shared/ui/button";

// Lien d’apparence bouton (44 px), pour les navigations du panneau.
const LINK_BUTTON =
  "rounded-control inline-flex min-h-11 items-center justify-center px-4 font-extrabold";
// Données propres au compte, à oublier quand la session prend fin. Toute nouvelle requête privée
// gardée en cache rejoint cette liste.
const PRIVATE_QUERY_KEYS = [
  PROFILE_QUERY_KEY,
  DEVICE_SESSIONS_KEY,
  MFA_QUERY_KEY,
  WORKOUTS_KEY,
  PROGRAMS_KEY,
  BODY_KEY,
  NUTRITION_KEY,
  ACTIVITIES_KEY,
  INSIGHTS_KEY,
  BASICFIT_KEY,
];
const LOGOUT_FAILED = "Déconnexion impossible pour le moment. Réessayez dans un instant.";
export const OFFLINE_COPY =
  "Pour la séance hors ligne, la séance en cours et les saisies en attente sont gardées en clair sur cet appareil, 7 jours au plus. La déconnexion les efface.";

/** Avertissement avant une déconnexion qui abandonnerait des saisies. */
export function unsentText(count: number): string {
  return count === 1
    ? "1 saisie n’est pas encore envoyée. Se déconnecter l’efface de cet appareil."
    : `${String(count)} saisies ne sont pas encore envoyées. Se déconnecter les efface de cet appareil.`;
}

async function signOut(): Promise<void> {
  const { response } = await authClient.DELETE("/api/v1/auth/app/v1/auth/session");
  // allauth répond 401 une fois la session close (le BFF efface alors les cookies). Tout autre
  // statut (403 CSRF, 5xx…) laisse la session ouverte : ne pas faire croire le contraire.
  if (response.status !== 401) throw new Error(`Déconnexion refusée (${String(response.status)})`);
}

/** Compte connecté et déconnexion, ou invitation à se connecter. */
export function SessionPanel({ shortcuts = true }: { shortcuts?: boolean } = {}) {
  const queryClient = useQueryClient();
  const me = $api.useQuery("get", "/api/v1/me/", {}, { retry: false });
  const profile = useProfile({ enabled: Boolean(me.data) });
  // Session expirée ou révoquée : ne garder en mémoire aucune donnée privée de la session
  // précédente (profil, donnée de santé ; appareils et leurs IP ; facteurs), qu'un autre écran
  // de l'onglet afficherait encore. Les requêtes publiques (état de l'API) restent.
  // Réseau coupé (`TypeError` de `fetch`) : la session n'a pas pris fin, la séance hors ligne reste.
  const offline = (me.error as unknown) instanceof TypeError;
  useEffect(() => {
    if (!me.isError || offline) return;
    for (const queryKey of PRIVATE_QUERY_KEYS) queryClient.removeQueries({ queryKey });
    void clearCachedPages();
  }, [me.isError, offline, queryClient]);
  const pending = useMutationState({ filters: { mutationKey: QUEUED_KEY, status: "pending" } });
  const [confirming, setConfirming] = useState(false);
  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      // Plus aucune donnée de l'utilisateur en mémoire ni sur l'appareil (copie hors ligne,
      // saisies en attente, pages gardées).
      void forgetAccount(queryClient);
    },
    onError: () => queryClient.invalidateQueries(),
  });

  return (
    <section aria-labelledby="session-title" className="flex flex-col gap-4">
      <h2 id="session-title" className="text-ink-muted text-sm font-semibold">
        Compte
      </h2>
      <div role="status">
        {me.isPending
          ? "Vérification de la session…"
          : me.data
            ? `Connecté avec ${me.data.email}`
            : "Vous n’êtes pas connecté."}
      </div>
      {me.data ? (
        <>
          {profile.data === null && (
            <Link href="/bienvenue" className={`${LINK_BUTTON} bg-accent text-on-accent`}>
              Compléter mon profil
            </Link>
          )}
          {shortcuts && (
            <>
              <Link
                href="/seance"
                className={`${LINK_BUTTON} border-line bg-surface text-ink border`}
              >
                Séance
              </Link>
              <Link
                href="/repas"
                className={`${LINK_BUTTON} border-line bg-surface text-ink border`}
              >
                Repas
              </Link>
              <Link
                href="/corps"
                className={`${LINK_BUTTON} border-line bg-surface text-ink border`}
              >
                Corps
              </Link>
            </>
          )}
          {shortcuts && profile.data && (
            <Link
              href="/profil"
              className={`${LINK_BUTTON} border-line bg-surface text-ink border`}
            >
              Mon profil
            </Link>
          )}
          {confirming && pending.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="font-semibold">{unsentText(pending.length)}</p>
              <Button
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Attendre l’envoi
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  logout.mutate();
                }}
                disabled={logout.isPending}
              >
                Abandonner et se déconnecter
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => {
                if (pending.length > 0) setConfirming(true);
                else logout.mutate();
              }}
              disabled={logout.isPending}
            >
              Se déconnecter
            </Button>
          )}
          <p className="text-ink-muted text-sm">{OFFLINE_COPY}</p>
        </>
      ) : (
        !me.isPending && (
          <Link href="/connexion" className={`${LINK_BUTTON} bg-accent text-on-accent`}>
            Se connecter
          </Link>
        )
      )}
      <div role="alert" className="empty:hidden">
        {logout.isError && (
          <p className="rounded-control border-danger text-danger border p-4 font-semibold">
            {LOGOUT_FAILED}
          </p>
        )}
      </div>
    </section>
  );
}
