import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";
import { expectStoredWrites, waitForServiceWorker } from "./pwa";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

// Saisies rejouées une par une, dans l'ordre : quelques allers-retours.
const QUEUE_DRAIN_TIMEOUT = 15_000;

test("note une pesée et des mensurations hors ligne, les garde au rechargement et les envoie au retour du réseau", async ({
  page,
  context,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "corps-hors-ligne");
  await signUp(page, email, password);
  await waitForServiceWorker(page);
  // Pages ouvertes une fois en ligne : le service worker les garde pour la salle.
  await page.goto("/corps");
  await expect(page.getByText(/^Aucune pesée sur la période\./)).toBeVisible();
  await page.goto("/corps/mensurations");
  await expect(page.getByText(/^Aucune mensuration sur l’année\./)).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("textbox", { name: "Bras (cm)" }).fill("38,5");
  await page.getByRole("button", { name: "Enregistrer les mesures" }).click();
  await expect(
    page.getByText(
      /^Mensurations du .* enregistrées sur cet appareil, envoi au retour du réseau\.$/,
    ),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Mensurations par date" })).toContainText(
    "Bras 38,5 cm",
  );
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  // Page rouverte sans réseau : la courbe n'est pas gardée (ADR 0015), la saisie si.
  await page.goto("/corps");
  await expect(
    page.getByText(/^Hors ligne : la courbe s’affichera au retour du réseau\./),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Poids (kg)" }).fill("81,4");
  await page.getByRole("button", { name: "Enregistrer la pesée" }).click();
  await expect(
    page.getByText(/^Pesée du .* enregistrée sur cet appareil, envoi au retour du réseau\.$/),
  ).toBeVisible();
  const pending = page.getByText("2 saisies en attente d’envoi, gardées sur cet appareil.");
  await expect(pending).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  // App rouverte sans réseau : les deux saisies attendent toujours leur envoi.
  await expectStoredWrites(page, 2);
  await page.reload();
  await expect(pending).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText(/en attente d’envoi/)).toBeHidden({ timeout: QUEUE_DRAIN_TIMEOUT });
  await page.reload();
  await expect(page.getByRole("table")).toContainText("81,4 kg");
  await page.goto("/corps/mensurations");
  await expect(page.getByRole("list", { name: "Mensurations par date" })).toContainText(
    "Bras 38,5 cm",
  );
  expect(cspViolations).toEqual([]);
});
