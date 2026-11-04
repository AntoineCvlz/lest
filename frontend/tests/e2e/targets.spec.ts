import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("active les objectifs, les calcule après une pesée et les montre au journal", async ({
  page,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "objectifs");
  await signUp(page, email, password);
  await page.goto("/profil");
  await expect(page.getByRole("heading", { name: "Objectifs nutritionnels" })).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  // Case radio masquée visuellement (ChoiceGroup) : on clique son libellé, comme un utilisateur.
  await page.getByText("Formule masculine", { exact: true }).click();
  await page.getByLabel("Date de naissance").fill("1996-11-04");
  await page.getByLabel("Niveau d’activité").selectOption("moderate");
  await page.getByRole("button", { name: "Activer mes objectifs" }).click();
  await expect(page.getByText(/^Objectifs enregistrés./)).toBeVisible();
  // Pas encore de pesée : rien à calculer, et l'écran le dit.
  await expect(page.getByText(/^Pour calculer, notez une première pesée/)).toBeVisible();

  await page.goto("/corps");
  await page.getByRole("textbox", { name: "Poids (kg)" }).fill("80");
  await page.getByRole("button", { name: "Enregistrer la pesée" }).click();
  await expect(page.getByText(/^Pesée du .* enregistrée\.$/)).toBeVisible();

  await page.goto("/profil");
  const chosen = page.getByRole("heading", { name: "Objectifs retenus" }).locator("..");
  await expect(chosen).toContainText("kcal");
  await expect(chosen).toContainText("160");
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await page.goto("/repas");
  await expect(page.getByText(/^sur .*\skcal, reste /)).toBeVisible();
  await expect(page.getByText(/sur 160\sg$/)).toBeVisible();
  expect(cspViolations).toEqual([]);
});
