"use client";

import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useState, type ReactNode } from "react";

import { PROFILE_QUERY_KEY } from "@/features/profile/use-profile";
import { createQueryClient } from "@/shared/api/query-provider";

import { loadStoredAccount } from "./account";
import { dropQueuedWrites, QUEUED_KEY, resumeQueuedWrites, statusOf } from "./queue";
import { createOfflinePersister, OFFLINE_MAX_AGE } from "./storage";

// Copie invalidée quand le schéma de l'API change (empreinte calculée au build, next.config.ts).
const BUSTER = process.env.LEST_API_SCHEMA ?? "dev";

/** Requêtes gardées hors ligne (ADR 0015, liste fermée). */
function isOfflineKey(key: QueryKey): boolean {
  return key[0] === PROFILE_QUERY_KEY[0];
}

function keptOffline(query: Query): boolean {
  return query.state.status === "success" && isOfflineKey(query.queryKey);
}

/**
 * Session terminée (une lecture reçoit 401, pas une coupure réseau) : la copie restaurée n'est
 * plus affichée ni gardée, comme le cache privé (`PRIVATE_QUERY_KEYS`). Les saisies en attente
 * restent pour ce compte, jusqu'à la reconnexion.
 */
export function forgetOnSessionEnd(queryClient: QueryClient): () => void {
  const cache = queryClient.getQueryCache();
  return cache.subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "error") return;
    if (statusOf(event.action.error) !== 401) return;
    const kept = cache.getAll().filter((query) => isOfflineKey(query.queryKey));
    for (const query of kept) {
      if (query === event.query) {
        // Erreur gardée, donnée retirée : l'écran dit de se reconnecter, sans nouvel appel.
        query.setState({ data: undefined, dataUpdatedAt: 0 });
      } else if (query.getObserversCount() === 0) {
        cache.remove(query);
      } else {
        void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      }
    }
  });
}

function createOfflineQueryClient(): QueryClient {
  const queryClient = createQueryClient();
  forgetOnSessionEnd(queryClient);
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
          shouldDehydrateQuery: keptOffline,
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
