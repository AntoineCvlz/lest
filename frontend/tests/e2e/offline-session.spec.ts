import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";
import { expectStoredWrites, waitForServiceWorker } from "./pwa";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

const QUEUE_DRAIN_TIMEOUT = 15_000;

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
  await expectStoredWrites(page, 1);
  await page.reload();
  const plan = page.getByRole("list", { name: "Exercices de la séance" });
  await expect(plan).toContainText("2 séries");
  await expect(pending).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  // Un exercice déjà consulté s'ajoute sans réseau : le catalogue vu est gardé.
  await page.getByRole("button", { name: "Ajouter un exercice" }).click();
  await page.getByRole("searchbox", { name: "Rechercher un exercice" }).fill("bench press");
  await expect(
    page.getByText(/^Hors ligne : \d+ exercices? déjà consultés? sur cet appareil\.$/),
  ).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: /^Barbell Bench Press/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Valider la série" })).toBeVisible();
  await expect(
    page.getByText("2 saisies en attente d’envoi, gardées sur cet appareil."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retour à la séance" }).click();

  // Retour du réseau : la série part, puis le serveur la renvoie.
  // Saisies rejouées une par une, dans l'ordre : quelques allers-retours.
  await context.setOffline(false);
  await expect(page.getByText(/en attente d’envoi/)).toBeHidden({ timeout: QUEUE_DRAIN_TIMEOUT });
  await page.reload();
  await expect(plan).toContainText("2 séries");
  await expect(plan.getByRole("listitem")).toHaveCount(2);
  expect(cspViolations).toEqual([]);
});

test("termine une séance et démarre la suivante sans réseau, puis les envoie dans l'ordre", async ({
  page,
  context,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "cycle-hors-ligne");
  await signUp(page, email, password);
  await waitForServiceWorker(page);
  await page.goto("/seance");
  const start = page.getByRole("button", { name: "Démarrer une séance" });
  await expect(start).toBeVisible();

  await context.setOffline(true);
  await start.click();
  await expect(page.getByText("Ajoutez un premier exercice pour commencer.")).toBeVisible();
  await page.getByRole("button", { name: "Terminer la séance" }).click();
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(
    page.getByText("Séance terminée sur cet appareil, envoi au retour du réseau."),
  ).toBeVisible();
  await start.click();
  const pending = page.getByText("3 saisies en attente d’envoi, gardées sur cet appareil.");
  await expect(pending).toBeVisible();

  // App rouverte sans réseau : la seconde séance est toujours en cours.
  await expectStoredWrites(page, 3);
  await page.reload();
  await expect(page.getByText("Ajoutez un premier exercice pour commencer.")).toBeVisible();
  await expect(pending).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  // Retour du réseau : la première séance rejoint l'historique, la seconde reste en cours.
  await context.setOffline(false);
  await expect(page.getByText(/en attente d’envoi/)).toBeHidden();
  await page.reload();
  await expect(page.getByText("Ajoutez un premier exercice pour commencer.")).toBeVisible();
  await page.getByRole("button", { name: "Terminer la séance" }).click();
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Séances passées" }).getByRole("listitem"),
  ).toHaveCount(2);
  expect(cspViolations).toEqual([]);
});
