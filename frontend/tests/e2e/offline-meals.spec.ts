import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";
import { expectStoredWrites, waitForServiceWorker } from "./pwa";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

// Saisies rejouées une par une, dans l'ordre : quelques allers-retours.
const QUEUE_DRAIN_TIMEOUT = 15_000;

test("ajoute un aliment récent et de l'eau hors ligne, les garde au rechargement et les envoie au retour du réseau", async ({
  page,
  context,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "repas-hors-ligne");
  await signUp(page, email, password);
  await waitForServiceWorker(page);

  // En ligne : un premier repas, qui rend l'aliment « récent ».
  await page.goto("/repas");
  await page.getByRole("button", { name: "Ajouter au déjeuner" }).click();
  await page.getByRole("searchbox", { name: "Rechercher un aliment" }).fill("pates cuites");
  const result = page.getByRole("button", { name: /^Pâtes/ }).first();
  await expect(result).toBeEnabled();
  await result.click();
  await page.getByRole("button", { name: "Ajouter au déjeuner" }).click();
  await expect(page.getByText(/ ajouté au déjeuner\.$/)).toBeVisible();

  // Hors ligne : le même aliment au dîner, depuis les récents, et un verre d'eau.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Ajouter au dîner" }).click();
  await page
    .getByRole("button", { name: /^Pâtes/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Ajouter au dîner" }).click();
  await expect(
    page.getByText(/ ajouté au dîner sur cet appareil, envoi au retour du réseau\.$/),
  ).toBeVisible();
  await page.getByRole("button", { name: "+250 millilitres" }).click();
  await expect(page.getByRole("group", { name: "Eau bue" })).toContainText("250");
  const pending = page.getByText("2 saisies en attente d’envoi, gardées sur cet appareil.");
  await expect(pending).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  // App rouverte sans réseau : le journal du jour et les saisies en attente sont toujours là.
  await expectStoredWrites(page, 2);
  await page.reload();
  await expect(page.getByRole("list", { name: "Dîner" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Eau bue" })).toContainText("250");
  await expect(pending).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText(/en attente d’envoi/)).toBeHidden({ timeout: QUEUE_DRAIN_TIMEOUT });
  await page.reload();
  await expect(page.getByRole("list", { name: "Dîner" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Eau bue" })).toContainText("250");
  expect(cspViolations).toEqual([]);
});
