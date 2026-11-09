"use client";

import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useState, type ReactNode } from "react";

import { PROFILE_QUERY_KEY } from "@/features/profile/use-profile";
import { isKeptForSession, registerSetWrites } from "@/features/training/use-sets";
import { registerWorkoutWrites } from "@/features/training/use-workout";
import { createQueryClient } from "@/shared/api/query-provider";

import { listenForForget, loadStoredAccount } from "./account";
import { dropQueuedWrites, QUEUED_KEY, resumeQueuedWrites, statusOf } from "./queue";
import { createOfflinePersister, OFFLINE_MAX_AGE } from "./storage";

// Copie invalidée quand le schéma de l'API change (empreinte calculée au build, next.config.ts).
const BUSTER = process.env.LEST_API_SCHEMA ?? "dev";

/** Déclare les saisies en file d'attente : leur fonction est retrouvée par leur clé. */
export function registerQueuedWrites(queryClient: QueryClient): void {
  registerWorkoutWrites(queryClient);
  registerSetWrites(queryClient);
}

/** Requêtes gardées hors ligne (ADR 0015, liste fermée). */
function isOfflineKey(queryClient: QueryClient, key: QueryKey): boolean {
  return key[0] === PROFILE_QUERY_KEY[0] || isKeptForSession(queryClient, key);
}

function keptOffline(queryClient: QueryClient, query: Query): boolean {
  return query.state.status === "success" && isOfflineKey(queryClient, query.queryKey);
}

/** Retire la copie restaurée de la mémoire (et donc de la copie écrite ensuite). */
function forgetCopy(queryClient: QueryClient, failing?: Query): void {
  const cache = queryClient.getQueryCache();
  const kept = cache.getAll().filter((query) => isOfflineKey(queryClient, query.queryKey));
  for (const query of kept) {
    if (query === failing) {
      // Erreur gardée, donnée retirée : l'écran dit de se reconnecter, sans nouvel appel.
      query.setState({ data: undefined, dataUpdatedAt: 0 });
    } else if (query.getObserversCount() === 0) {
      cache.remove(query);
    } else {
      void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

/**
 * Session terminée (une lecture ou une saisie reçoit 401, pas une coupure réseau) : la copie
 * restaurée n'est plus affichée ni gardée, comme le cache privé (`PRIVATE_QUERY_KEYS`). Les
 * saisies en attente restent pour ce compte, jusqu'à la reconnexion.
 */
export function forgetOnSessionEnd(queryClient: QueryClient): () => void {
  const stopQueries = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "error") return;
    if (statusOf(event.action.error) === 401) forgetCopy(queryClient, event.query);
  });
  const stopMutations = queryClient.getMutationCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const { action } = event;
    // `failed` : essai raté avant un nouvel essai ; `error` : dernier essai.
    if (action.type !== "failed" && action.type !== "error") return;
    if (statusOf(action.error) === 401) forgetCopy(queryClient);
  });
  return () => {
    stopQueries();
    stopMutations();
  };
}

function createOfflineQueryClient(): QueryClient {
  const queryClient = createQueryClient();
  registerQueuedWrites(queryClient);
  forgetOnSessionEnd(queryClient);
  if (typeof window !== "undefined") listenForForget(queryClient);
  return queryClient;
}

/**
 * `QueryClientProvider` qui garde dans IndexedDB les saisies en attente et la séance en cours,
 * les restaure au lancement, puis reprend l'envoi des saisies.
 */
export function OfflineQueryProvider({ children }: { children: ReactNode }) {
  // Un client par montage : jamais partagé entre deux requêtes SSR (fuite de données).
  const [queryClient] = useState(createOfflineQueryClient);
  // Un onglet plus récent rejoue la file : celui-ci lâche la sienne (un seul envoi à la fois).
  const [persister] = useState(() =>
    createOfflinePersister(() => {
      dropQueuedWrites(queryClient);
    }),
  );
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: OFFLINE_MAX_AGE,
        buster: BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => keptOffline(queryClient, query),
          shouldDehydrateMutation: (mutation) =>
            mutation.state.status === "pending" &&
            mutation.options.mutationKey?.[0] === QUEUED_KEY[0],
        },
      }}
      onSuccess={async () => {
        await loadStoredAccount();
        // Sans attendre : les écrans attendent la fin de `onSuccess` pour lire le cache, et
        // l'envoi, lui, peut attendre le réseau des heures.
        void resumeQueuedWrites(queryClient);
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
