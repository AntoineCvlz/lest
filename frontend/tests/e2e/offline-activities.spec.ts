import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";
import { storedQuery, expectStoredWrites, waitForServiceWorker } from "./pwa";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

// Saisies rejouées une par une, dans l'ordre : quelques allers-retours.
const QUEUE_DRAIN_TIMEOUT = 15_000;

test("note une activité hors ligne sur une page rouverte sans réseau, puis l'envoie", async ({
  page,
  context,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "activite-hors-ligne");
  await signUp(page, email, password);
  await waitForServiceWorker(page);
  // Page ouverte une fois en ligne : la page et le catalogue des sports sont gardés.
  await page.goto("/seance/activites");
  await expect(page.getByText(/^Aucune activité sur les 30 derniers jours\./)).toBeVisible();

  // Catalogue écrit dans la copie avant de couper : sinon le rechargement peut la devancer.
  await expect.poll(() => storedQuery(page, "sports")).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText(/^Hors ligne : l’historique s’affichera au retour du réseau\./),
  ).toBeVisible();
  await page.getByLabel("Sport").selectOption("running");
  await page.getByRole("textbox", { name: "Durée (min)" }).fill("45");
  await page.getByRole("button", { name: "Enregistrer l’activité" }).click();
  await expect(
    page.getByText(/^Activité enregistrée sur cet appareil, envoi au retour du réseau : course/),
  ).toBeVisible();
  const pending = page.getByText("1 saisie en attente d’envoi, gardée sur cet appareil.");
  await expect(pending).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  await expectStoredWrites(page, 1);

  await context.setOffline(false);
  await expect(pending).toBeHidden({ timeout: QUEUE_DRAIN_TIMEOUT });
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Activités, les plus récentes d’abord" }),
  ).toContainText("45");
  expect(cspViolations).toEqual([]);
});
