import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Persister } from "@tanstack/react-query-persist-client";
import { clear, createStore, del, get, set, type UseStore } from "idb-keyval";

/**
 * Copie hors ligne dans IndexedDB (ADR 0015) : saisies en attente et quelques requêtes, en
 * clair, 7 jours au plus, effacées à la déconnexion. Rien n'y est écrit côté serveur.
 */
export const OFFLINE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const CLIENT_KEY = "query-client";
const ACCOUNT_KEY = "account";
// Tenu par un seul onglet tant qu'il est ouvert : lui seul restaure, garde et rejoue la file.
const LOCK = "lest-offline";

let store: UseStore | undefined;
/** Ouverte au premier usage, jamais au chargement du module (rendu serveur, tests). */
function offlineStore(): UseStore {
  return (store ??= createStore("lest-offline", "keyval"));
}

/** Sans IndexedDB (rendu serveur, certaines navigations privées) : rien n'est gardé. */
function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

// Faux dès qu'un onglet plus récent (ou la page rechargée) a pris le verrou.
let holding = false;

/**
 * Prend le verrou, au besoin à un autre onglet : le plus récent garde et rejoue la file. Sans
 * vol, une page rechargée le demanderait avant que l'ancienne l'ait rendu, et ne restaurerait
 * rien. `onLost` : l'onglet dépossédé lâche sa file, déjà copiée pour le nouveau.
 */
function takeLock(onLost: () => void): Promise<void> {
  return new Promise((resolve) => {
    if (!("locks" in navigator)) {
      holding = true;
      resolve();
      return;
    }
    navigator.locks
      .request(LOCK, { steal: true }, () => {
        holding = true;
        resolve();
        // Gardé jusqu'à la fermeture de l'onglet, ou jusqu'au vol.
        return new Promise<never>(() => undefined);
      })
      .catch(() => {
        holding = false;
        onLost();
      });
  });
}

/**
 * Persister de TanStack Query sur IndexedDB, actif dans un seul onglet : le dernier ouvert.
 */
export function createOfflinePersister(onLost: () => void): Persister {
  if (typeof window === "undefined" || !hasIndexedDb()) {
    return createAsyncStoragePersister({ storage: undefined });
  }
  const inner = createAsyncStoragePersister({
    storage: {
      getItem: (key) => get<string>(key, offlineStore()).then((value) => value ?? null),
      setItem: (key, value) => set(key, value, offlineStore()),
      removeItem: (key) => del(key, offlineStore()),
    },
    key: CLIENT_KEY,
    // Écrite dès le changement : une série validée juste avant de fermer l'app doit y être.
    // La copie ne pèse que quelques Ko (liste fermée de requêtes).
    throttleTime: 0,
  });
  const locked = takeLock(onLost);
  return {
    persistClient: async (client) => {
      await locked;
      if (holding) await inner.persistClient(client);
    },
    restoreClient: async () => {
      await locked;
      return holding ? inner.restoreClient() : undefined;
    },
    removeClient: async () => {
      await locked;
      if (holding) await inner.removeClient();
    },
  };
}

/** Compte auquel appartient la copie, ou `undefined`. */
export async function readStoredAccount(): Promise<string | undefined> {
  return hasIndexedDb() ? get<string>(ACCOUNT_KEY, offlineStore()) : undefined;
}

export async function storeAccount(id: string): Promise<void> {
  if (hasIndexedDb()) await set(ACCOUNT_KEY, id, offlineStore());
}

/** Efface toute la copie hors ligne de cet appareil (déconnexion, suppression du compte). */
export async function wipeOfflineStore(): Promise<void> {
  if (hasIndexedDb()) await clear(offlineStore());
}
