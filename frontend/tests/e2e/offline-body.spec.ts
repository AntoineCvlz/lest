import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";
import { storedQueuedWrites, waitForServiceWorker } from "./pwa";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

// Saisies rejouées une par une, dans l'ordre : quelques allers-retours.
const QUEUE_DRAIN_TIMEOUT = 15_000;

test("note une pesée hors ligne, la garde au rechargement et l'envoie au retour du réseau", async ({
  page,
  context,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "pesee-hors-ligne");
  await signUp(page, email, password);
  await waitForServiceWorker(page);
  await page.goto("/corps");
  await expect(page.getByText(/^Aucune pesée sur la période\./)).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("textbox", { name: "Poids (kg)" }).fill("81,4");
  await page.getByRole("button", { name: "Enregistrer la pesée" }).click();
  await expect(
    page.getByText(/^Pesée du .* enregistrée sur cet appareil, envoi au retour du réseau\.$/),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("81,4 kg");
  const pending = page.getByText("1 saisie en attente d’envoi, gardée sur cet appareil.");
  await expect(pending).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  // App rouverte sans réseau : la pesée attend toujours son envoi.
  await expect.poll(() => storedQueuedWrites(page)).toBe(1);
  await page.reload();
  await expect(pending).toBeVisible();

  await context.setOffline(false);
  await expect(pending).toBeHidden({ timeout: QUEUE_DRAIN_TIMEOUT });
  await page.reload();
  await expect(page.getByRole("table")).toContainText("81,4 kg");
  expect(cspViolations).toEqual([]);
});
