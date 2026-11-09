import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { $api, fetchClient } from "@/shared/api/client";
import { clearCachedPages } from "@/shared/pwa/service-worker";

import { dropQueuedWrites, resumeQueuedWrites } from "./queue";
import { readStoredAccount, releaseCopy, storeAccount, wipeOfflineStore } from "./storage";

// Déconnexion annoncée aux autres onglets : chacun oublie ce qu'il a en mémoire et n'écrit plus.
const CHANNEL = "lest-offline";
const FORGET = "forget";

// Compte de la copie hors ligne, connu sans réseau après la restauration.
let known: string | null = null;

// Canal écouté par chaque client de cet onglet. L'annonce part par ce canal : un canal ne reçoit
// pas ses propres messages, alors qu'un autre canal du même onglet les recevrait, et le second
// `clear()` annulerait la relecture de la session lancée par le premier.
const listening = new WeakMap<QueryClient, BroadcastChannel>();

/** Lit le compte de la copie restaurée (au démarrage, avant de reprendre la file). */
export async function loadStoredAccount(): Promise<void> {
  known = (await readStoredAccount()) ?? null;
}

/**
 * Lie la copie hors ligne au compte connecté. Si elle appartenait à un autre compte, tout ce
 * qu'elle contient est oublié **sans être rejoué** (ADR 0015).
 */
export async function bindAccount(queryClient: QueryClient, id: string): Promise<void> {
  const previous = known ?? (await readStoredAccount()) ?? null;
  if (previous !== null && previous !== id) {
    dropQueuedWrites(queryClient);
    queryClient.clear();
  }
  known = id;
  if (previous !== id) await storeAccount(id);
}

/**
 * Après une connexion : les données en cache sont oubliées, les saisies en attente gardées si
 * elles sont à ce compte (session expirée hors ligne), puis envoyées.
 */
export async function startSession(queryClient: QueryClient): Promise<void> {
  queryClient.getQueryCache().clear();
  void clearCachedPages();
  try {
    const { data } = await fetchClient.GET("/api/v1/me/");
    if (!data) return;
    await bindAccount(queryClient, data.id);
  } catch {
    // Réseau coupé juste après la connexion : la liaison se fera à la prochaine lecture du
    // compte (`useAccount`), et Django refuse de toute façon une saisie d'un autre compte.
    return;
  }
  await resumeQueuedWrites(queryClient);
}

async function forgetHere(queryClient: QueryClient): Promise<void> {
  releaseCopy();
  queryClient.clear();
  known = null;
  await Promise.all([wipeOfflineStore(), clearCachedPages()]);
}

/** Déconnexion ou suppression du compte : plus rien du compte sur cet appareil, tous onglets. */
export async function forgetAccount(queryClient: QueryClient): Promise<void> {
  const own = listening.get(queryClient);
  if (own) {
    own.postMessage(FORGET);
  } else if ("BroadcastChannel" in globalThis) {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(FORGET);
    channel.close();
  }
  await forgetHere(queryClient);
}

/** Écoute les déconnexions faites dans les autres onglets ; renvoie de quoi arrêter. */
export function listenForForget(queryClient: QueryClient): () => void {
  if (!("BroadcastChannel" in globalThis)) return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event) => {
    if (event.data === FORGET) void forgetHere(queryClient);
  };
  listening.set(queryClient, channel);
  return () => {
    listening.delete(queryClient);
    channel.close();
  };
}

/**
 * Compte pour lequel une saisie est faite : celui de la session, ou, hors ligne, celui de la copie
 * restaurée. `null` s'il est inconnu (la saisie part alors sans contrôle de compte).
 */
export function useAccount(): string | null {
  const queryClient = useQueryClient();
  const me = $api.useQuery("get", "/api/v1/me/", {}, { retry: false });
  const id = me.data?.id;
  useEffect(() => {
    if (id) void bindAccount(queryClient, id);
  }, [id, queryClient]);
  return id ?? known;
}
