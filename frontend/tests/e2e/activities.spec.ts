import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("note une course, la corrige puis la supprime", async ({
  page,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "activites");
  await signUp(page, email, password);
  await page.goto("/seance");
  await page.getByRole("link", { name: /^Autres sports/ }).click();
  await expect(page).toHaveURL("/seance/activites");
  await expect(page.getByText(/^Aucune activité sur les 30 derniers jours\./)).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await page.getByLabel("Sport").selectOption("running");
  await page.getByRole("textbox", { name: "Durée (min)" }).fill("45");
  await page.getByRole("textbox", { name: "Distance (km)" }).fill("10,2");
  await page.getByRole("textbox", { name: "Dénivelé positif (m)" }).fill("120");
  await page.getByLabel("Ressenti").selectOption("4");
  await page.getByRole("button", { name: "Enregistrer l’activité" }).click();
  await expect(page.getByText(/^Activité enregistrée : course à pied, /)).toBeVisible();
  const list = page.getByRole("list", { name: "Activités, les plus récentes d’abord" });
  await expect(list).toContainText("10,2");
  await expect(list).toContainText("dénivelé positif 120");
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await list.getByRole("button", { name: /^Modifier l’activité : course à pied/ }).click();
  await page.getByRole("textbox", { name: "Durée (min)" }).fill("50");
  await page.getByRole("button", { name: "Enregistrer les modifications" }).click();
  await expect(page.getByText(/^Activité modifiée : course à pied, /)).toBeVisible();
  await expect(list).toContainText("50");

  await list.getByRole("button", { name: /^Modifier l’activité : course à pied/ }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(page.getByText(/^Activité supprimée : course à pied, /)).toBeVisible();
  await expect(page.getByText(/^Aucune activité sur les 30 derniers jours\./)).toBeVisible();
  expect(cspViolations).toEqual([]);
});
