import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("démarre une séance, ajoute un exercice et la termine", async ({
  page,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  // Compte neuf par projet (mobile, desktop) : une seule séance en cours par compte.
  const { email, password } = freshAccount(testInfo, "seance");
  await signUp(page, email, password);
  await page.getByRole("link", { name: "Séance" }).click();
  await expect(page).toHaveURL("/seance");
  const tabs = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(tabs.getByRole("link", { name: "Séance" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Démarrer une séance" }).click();
  await expect(page.getByText("Ajoutez un premier exercice pour commencer.")).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Ajouter un exercice" }).click();
  await page.getByRole("searchbox", { name: "Rechercher un exercice" }).fill("developpe couche");
  const choice = page.getByRole("button", { name: /^Développé couché/ }).first();
  await expect(choice).toBeEnabled();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  await choice.click();

  const plan = page.getByRole("list", { name: "Exercices de la séance" });
  await expect(plan.getByRole("listitem")).toHaveCount(1);
  await expect(plan).toContainText("Aucune série");
  // Rechargement : la séance en cours est reprise.
  await page.reload();
  await expect(plan).toContainText("Développé couché");

  await page.getByRole("button", { name: "Terminer la séance" }).click();
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(page.getByText("Séance terminée et enregistrée.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Démarrer une séance" })).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  expect(cspViolations).toEqual([]);
});
