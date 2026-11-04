import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("le Bilan accueille le compte, puis reflète une pesée et une activité", async ({
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

  await page.goto("/seance/activites");
  await page.getByRole("textbox", { name: "Durée (min)" }).fill("45");
  await page.getByRole("button", { name: "Enregistrer l’activité" }).click();
  await expect(page.getByText(/^Activité enregistrée : /)).toBeVisible();

  await page.getByRole("link", { name: "Bilan" }).click();
  await expect(page.getByText(/^80\skg$/)).toBeVisible();
  await expect(page.getByText(/^Cette semaine : 1 activité d’autres sports/)).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  // Le compte reste sur l'accueil : la déconnexion efface le Bilan.
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByText("Vous n’êtes pas connecté.")).toBeVisible();
  expect(cspViolations).toEqual([]);
});
