import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";
import { storedQueuedWrites, waitForServiceWorker } from "./pwa";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("saisit une série hors ligne, la garde au rechargement et l'envoie au retour du réseau", async ({
  page,
  context,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  // Compte neuf par projet (mobile, desktop) : une seule séance en cours par compte.
  const { email, password } = freshAccount(testInfo, "seance-hors-ligne");
  await signUp(page, email, password);
  await waitForServiceWorker(page);

  await page.goto("/seance");
  await page.getByRole("button", { name: "Démarrer une séance" }).click();
  await page.getByRole("button", { name: "Ajouter un exercice" }).click();
  await page.getByRole("searchbox", { name: "Rechercher un exercice" }).fill("barbell bench press");
  const choice = page.getByRole("button", { name: /^Barbell Bench Press/ }).first();
  await expect(choice).toBeEnabled();
  await choice.click();
  await page.getByRole("button", { name: "Valider la série" }).click();
  await expect(page.getByText(/^Série 1 enregistrée\./)).toBeVisible();

  // Réseau coupé en salle : la série est gardée sur le téléphone.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Valider la série" }).click();
  await expect(
    page.getByText("Série 2 enregistrée sur cet appareil, envoi au retour du réseau."),
  ).toBeVisible();
  const pending = page.getByText("1 saisie en attente d’envoi, gardée sur cet appareil.");
  await expect(pending).toBeVisible();
  await expect(page.getByRole("list", { name: "Séries de la séance" })).toContainText("Série 2");

  // App rouverte sans réseau : la séance et la série en attente sont toujours là.
  await expect.poll(() => storedQueuedWrites(page)).toBe(1);
  await page.reload();
  const plan = page.getByRole("list", { name: "Exercices de la séance" });
  await expect(plan).toContainText("2 séries");
  await expect(pending).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  // Retour du réseau : la série part, puis le serveur la renvoie.
  await context.setOffline(false);
  await expect(pending).toBeHidden();
  await page.reload();
  await expect(plan).toContainText("2 séries");
  expect(cspViolations).toEqual([]);
});
