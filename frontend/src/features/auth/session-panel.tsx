"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect } from "react";

import { PROFILE_QUERY_KEY, useProfile } from "@/features/profile/use-profile";
import { DEVICE_SESSIONS_KEY, MFA_QUERY_KEY } from "@/features/security/query-keys";
import { WORKOUTS_KEY } from "@/features/training/query-keys";
import { $api } from "@/shared/api/client";
import { authClient } from "@/shared/api/auth-client";
import { Button } from "@/shared/ui/button";

// Lien d’apparence bouton (44 px), pour les navigations du panneau.
const LINK_BUTTON =
  "rounded-control inline-flex min-h-11 items-center justify-center px-4 font-extrabold";
// Données propres au compte, à oublier quand la session prend fin. Toute nouvelle requête privée
// gardée en cache rejoint cette liste.
const PRIVATE_QUERY_KEYS = [PROFILE_QUERY_KEY, DEVICE_SESSIONS_KEY, MFA_QUERY_KEY, WORKOUTS_KEY];
const LOGOUT_FAILED = "Déconnexion impossible pour le moment. Réessayez dans un instant.";

async function signOut(): Promise<void> {
  const { response } = await authClient.DELETE("/api/v1/auth/app/v1/auth/session");
  // allauth répond 401 une fois la session close (le BFF efface alors les cookies). Tout autre
  // statut (403 CSRF, 5xx…) laisse la session ouverte : ne pas faire croire le contraire.
  if (response.status !== 401) throw new Error(`Déconnexion refusée (${String(response.status)})`);
}

/** Compte connecté et déconnexion, ou invitation à se connecter. */
export function SessionPanel() {
  const queryClient = useQueryClient();
  const me = $api.useQuery("get", "/api/v1/me/", {}, { retry: false });
  const profile = useProfile({ enabled: Boolean(me.data) });
  // Session expirée ou révoquée : ne garder en mémoire aucune donnée privée de la session
  // précédente (profil, donnée de santé ; appareils et leurs IP ; facteurs), qu'un autre écran
  // de l'onglet afficherait encore. Les requêtes publiques (état de l'API) restent.
  useEffect(() => {
    if (!me.isError) return;
    for (const queryKey of PRIVATE_QUERY_KEYS) queryClient.removeQueries({ queryKey });
  }, [me.isError, queryClient]);
  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      // Plus aucune donnée de l'utilisateur en mémoire.
      queryClient.clear();
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
          <Link href="/seance" className={`${LINK_BUTTON} border-line bg-surface text-ink border`}>
            Séance
          </Link>
          {profile.data && (
            <Link
              href="/profil"
              className={`${LINK_BUTTON} border-line bg-surface text-ink border`}
            >
              Mon profil
            </Link>
          )}
          <Button
            onClick={() => {
              logout.mutate();
            }}
            disabled={logout.isPending}
          >
            Se déconnecter
          </Button>
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
