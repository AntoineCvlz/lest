import type { Page } from "@playwright/test";

import { expect } from "./fixtures";

/** Attend que le service worker contrôle la page (ADR 0015). */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Contrôle acquis au chargement suivant (ou par `clients.claim()`).
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}

/** Copie hors ligne (IndexedDB), lue comme l'app la relit au lancement. */
async function storedCopy(
  page: Page,
): Promise<{ mutations: unknown[]; queries: { queryKey: unknown[] }[] } | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lest-offline");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("IndexedDB illisible"));
      };
    });
    const raw = await new Promise<unknown>((resolve) => {
      const request = db.transaction("keyval").objectStore("keyval").get("query-client");
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    db.close();
    if (typeof raw !== "string") return null;
    const client = JSON.parse(raw) as {
      clientState: { mutations: unknown[]; queries: { queryKey: unknown[] }[] };
    };
    return client.clientState;
  });
}

/** Nombre de saisies en attente dans la copie hors ligne. */
export async function storedQueuedWrites(page: Page): Promise<number> {
  return (await storedCopy(page))?.mutations.length ?? 0;
}

/** Vrai si la copie hors ligne contient une requête dont la clé commence par `prefix`. */
export async function storedQuery(page: Page, prefix: string): Promise<boolean> {
  const copy = await storedCopy(page);
  return copy?.queries.some((query) => query.queryKey[0] === prefix) ?? false;
}

/** État utile pour comprendre une copie hors ligne absente : verrou, clés, visibilité. */
async function offlineDiagnostics(page: Page): Promise<string> {
  const state = await page.evaluate(async () => {
    const locks = "locks" in navigator ? await navigator.locks.query() : null;
    const keys = await new Promise<string[]>((resolve) => {
      const request = indexedDB.open("lest-offline");
      request.onsuccess = () => {
        const db = request.result;
        const all = db.transaction("keyval").objectStore("keyval").getAllKeys();
        all.onsuccess = () => {
          db.close();
          resolve(all.result.map(String));
        };
      };
      request.onerror = () => {
        resolve([]);
      };
    });
    return {
      held: locks?.held?.map((lock) => lock.name) ?? null,
      pending: locks?.pending?.map((lock) => lock.name) ?? null,
      keys,
      visibility: document.visibilityState,
      online: navigator.onLine,
    };
  });
  const copy = await storedCopy(page);
  return JSON.stringify({ ...state, storedWrites: copy?.mutations.length ?? null });
}

/** Attend `count` saisies dans la copie hors ligne ; sinon, l'erreur dit pourquoi. */
export async function expectStoredWrites(page: Page, count: number): Promise<void> {
  try {
    await expect.poll(() => storedQueuedWrites(page)).toBe(count);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}\nCopie hors ligne : ${await offlineDiagnostics(page)}`);
  }
}

/** Attend une requête dont la clé commence par `prefix` dans la copie ; sinon, dit pourquoi. */
export async function expectStoredQuery(page: Page, prefix: string): Promise<void> {
  try {
    await expect.poll(() => storedQuery(page, prefix)).toBe(true);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}\nCopie hors ligne : ${await offlineDiagnostics(page)}`);
  }
}
