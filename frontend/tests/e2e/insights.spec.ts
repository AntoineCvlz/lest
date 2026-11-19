import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("le Bilan accueille le compte, puis reflète une pesée et une séance de cardio", async ({
  page,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "bilan");
  await signUp(page, email, password);
  await expect(page.getByRole("heading", { level: 1, name: "Bilan" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bilan" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Noter une pesée" })).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Noter une pesée" }).click();
  await page.getByRole("textbox", { name: "Poids (kg)" }).fill("80");
  await page.getByRole("button", { name: "Enregistrer la pesée" }).click();
  await expect(page.getByText(/^Pesée du .* enregistrée\.$/)).toBeVisible();

  // Une course notée dans la séance (exercice de cardio de Lest, ADR 0017).
  await page.getByRole("link", { name: "Séance", exact: true }).click();
  await page.getByRole("button", { name: "Démarrer une séance" }).click();
  await page.getByRole("button", { name: "Ajouter un exercice" }).click();
  await page.getByRole("searchbox", { name: "Rechercher un exercice" }).fill("course");
  await page
    .getByRole("button", { name: /^Course à pied/ })
    .first()
    .click();
  await page.getByRole("button", { name: "+1 minute" }).click();
  await page.getByRole("button", { name: "Valider la série" }).click();
  await expect(page.getByRole("list", { name: "Séries de la séance" })).toContainText("31:00");
  await page.getByRole("button", { name: "Retour à la séance" }).click();
  await page.getByRole("button", { name: "Terminer la séance" }).click();
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Démarrer une séance" })).toBeVisible();

  await page.getByRole("link", { name: "Bilan" }).click();
  await expect(page.getByText(/^80\skg$/)).toBeVisible();
  await expect(page.getByText(/^Cette semaine : 1 séance, \d+\smin\.$/)).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  // Le compte reste sur l'accueil : la déconnexion efface le Bilan.
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByText("Vous n’êtes pas connecté.")).toBeVisible();
  expect(cspViolations).toEqual([]);
});
