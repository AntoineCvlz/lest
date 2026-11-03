import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("ajoute un aliment au déjeuner, corrige la quantité puis le retire", async ({
  page,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "repas");
  await signUp(page, email, password);
  await page.getByRole("link", { name: "Repas" }).first().click();
  await expect(page).toHaveURL("/repas");
  await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Ajouter au déjeuner" }).click();
  await page.getByRole("searchbox", { name: "Rechercher un aliment" }).fill("pates cuites");
  const result = page.getByRole("button", { name: /^Pâtes/ }).first();
  await expect(result).toBeEnabled();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  await result.click();
  await page.getByRole("textbox", { name: "Quantité (g)" }).fill("150");
  await page.getByRole("button", { name: "Ajouter au déjeuner" }).click();
  await expect(page.getByText(/ ajouté au déjeuner\.$/)).toBeVisible();

  const lunch = page.getByRole("list", { name: "Déjeuner" });
  await expect(lunch.getByRole("listitem")).toHaveCount(1);
  await expect(lunch).toContainText("150 g");
  await page.getByRole("button", { name: "+250 millilitres" }).click();
  await expect(page.getByRole("group", { name: "Eau bue" })).toContainText("250");
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await lunch.getByRole("button", { name: /^Modifier Pâtes/ }).click();
  await page.getByRole("textbox", { name: /^Quantité de Pâtes/ }).fill("200");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(lunch).toContainText("200 g");

  await lunch.getByRole("button", { name: /^Modifier Pâtes/ }).click();
  await page.getByRole("button", { name: /^Retirer Pâtes/ }).click();
  await page.getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(page.getByText(/ retiré\.$/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Déjeuner" })).toHaveCount(0);
  expect(cspViolations).toEqual([]);
});
