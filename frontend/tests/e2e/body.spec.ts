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

test("note des mensurations partielles puis en retire une", async ({
  page,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "mensurations");
  await signUp(page, email, password);
  await page.goto("/corps");
  await page.getByRole("link", { name: "Mensurations" }).click();
  await expect(page).toHaveURL("/corps/mensurations");
  await expect(page.getByRole("link", { name: "Mensurations" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText(/^Aucune mensuration sur l’année\./)).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await page.getByRole("textbox", { name: "Bras (cm)" }).fill("38,5");
  await page.getByRole("textbox", { name: "Taille (cm)" }).fill("82");
  await page.getByRole("button", { name: "Enregistrer les mesures" }).click();
  await expect(page.getByText(/^Mensurations du .* enregistrées\.$/)).toBeVisible();
  const history = page.getByRole("list", { name: "Mensurations par date" });
  await expect(history).toContainText("Bras 38,5 cm, Taille 82 cm");
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await history.getByRole("button", { name: /^Modifier les mensurations du / }).click();
  await page.getByRole("textbox", { name: "Taille (cm)" }).fill("");
  await page.getByRole("button", { name: "Enregistrer les mesures" }).click();
  // Retirer une mesure se confirme.
  await expect(page.getByRole("button", { name: "Garder" })).toBeFocused();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Retirer" }).click();
  await expect(page.getByText(/mesure retirée : Taille\.$/)).toBeVisible();
  await expect(history).toContainText("Bras 38,5 cm");
  await expect(history).not.toContainText("Taille");
  expect(cspViolations).toEqual([]);
});
