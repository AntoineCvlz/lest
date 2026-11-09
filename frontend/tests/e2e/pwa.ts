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

/** Nombre de saisies en attente dans la copie hors ligne (IndexedDB), lu comme l'app la relit. */
export function storedQueuedWrites(page: Page): Promise<number> {
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
    if (typeof raw !== "string") return 0;
    const client = JSON.parse(raw) as { clientState: { mutations: unknown[] } };
    return client.clientState.mutations.length;
  });
}
