"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { $api } from "@/shared/api/client";
import { authClient } from "@/shared/api/auth-client";
import { Button } from "@/shared/ui/button";

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
        <Button
          onClick={() => {
            logout.mutate();
          }}
          disabled={logout.isPending}
        >
          Se déconnecter
        </Button>
      ) : (
        !me.isPending && (
          <Link
            href="/connexion"
            className="rounded-control bg-accent text-on-accent inline-flex min-h-11 items-center justify-center px-4 font-extrabold"
          >
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
