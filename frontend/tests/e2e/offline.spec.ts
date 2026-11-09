import type { Page } from "@playwright/test";

import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";
import { waitForServiceWorker } from "./pwa";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

/** Adresses et contenus de tous les caches du service worker. */
function cachedEntries(page: Page): Promise<{ cache: string; url: string; body: string }[]> {
  return page.evaluate(async () => {
    const entries: { cache: string; url: string; body: string }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const type = response?.headers.get("content-type") ?? "";
        const body = response && type.startsWith("text/html") ? await response.text() : "";
        entries.push({ cache: name, url: new URL(request.url).pathname, body });
      }
    }
    return entries;
  });
}

test("ouvre hors ligne une page déjà vue, sans garder aucune donnée de l'API", async ({
  page,
  context,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "hors-ligne");
  await signUp(page, email, password);
  await waitForServiceWorker(page);

  await page.goto("/corps");
  await page.getByRole("textbox", { name: "Poids (kg)" }).fill("81,4");
  await page.getByRole("button", { name: "Enregistrer la pesée" }).click();
  await expect(page.getByRole("table")).toContainText("81,4 kg");
  await page.reload();
  await expect(page.getByRole("table")).toContainText("81,4 kg");

  const entries = await cachedEntries(page);
  // La coque de la page est gardée ; aucune réponse de l'API, et rien de personnel dedans.
  expect(entries.some((entry) => entry.cache === "lest-pages" && entry.url === "/corps")).toBe(
    true,
  );
  expect(entries.filter((entry) => entry.url.startsWith("/api/"))).toEqual([]);
  for (const entry of entries) {
    expect(entry.body).not.toMatch(/81[,.]4/);
    expect(entry.body).not.toContain(email);
  }

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Poids" })).toBeVisible();
  // Page jamais ouverte sur cet appareil : la page « hors ligne ».
  await page.goto("/sources");
  await expect(page.getByRole("heading", { level: 1, name: "Hors ligne" })).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  await context.setOffline(false);

  await page.goto("/");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByRole("link", { name: "Se connecter" }).first()).toBeVisible();
  // L'accueil diffère selon la session : les pages gardées sont oubliées à la déconnexion.
  await expect
    .poll(async () => (await cachedEntries(page)).filter((entry) => entry.cache === "lest-pages"))
    .toEqual([]);
  expect(cspViolations).toEqual([]);
});
