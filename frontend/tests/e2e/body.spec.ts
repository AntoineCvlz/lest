import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("enregistre, corrige et supprime une pesée", async ({
  page,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "corps");
  await signUp(page, email, password);
  await page.getByRole("link", { name: "Corps" }).first().click();
  await expect(page).toHaveURL("/corps");
  await expect(page.getByText(/^Aucune pesée sur la période\./)).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  const weight = page.getByRole("textbox", { name: "Poids (kg)" });
  await weight.fill("81,4");
  await page.getByRole("button", { name: "Enregistrer la pesée" }).click();
  await expect(page.getByText(/^Pesée du .* enregistrée\.$/)).toBeVisible();
  await expect(page.getByRole("figure", { name: "Moyenne sur 7 jours : 81,4 kg." })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("81,4 kg");
  // Le champ reprend la dernière pesée pour la suivante.
  await expect(weight).toHaveValue("81,4");
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await table.getByRole("button", { name: /^Modifier la pesée du / }).click();
  await weight.fill("81,1");
  // Une pesée existe ce jour : le bouton dit qu'elle sera remplacée.
  await page.getByRole("button", { name: "Remplacer la pesée" }).click();
  await expect(table).toContainText("81,1 kg");
  await expect(table.getByRole("row")).toHaveCount(2);

  await page.getByRole("button", { name: /^Supprimer la pesée du / }).click();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /^Confirmer la suppression de la pesée du / }).click();
  await expect(page.getByText(/^Pesée du .* supprimée\.$/)).toBeVisible();
  await expect(page.getByText(/^Aucune pesée sur la période\./)).toBeVisible();
  expect(cspViolations).toEqual([]);
});
