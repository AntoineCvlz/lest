import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("démarre une séance, ajoute un exercice, saisit une série et la termine", async ({
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

  // Saisie ouverte sur l'exercice ajouté : barre à vide proposée, une série d'un appui.
  await expect(page.getByText("Première fois pour cet exercice.")).toBeVisible();
  await page.getByRole("button", { name: "+2,5 kilos" }).click();
  await page.getByRole("button", { name: "Valider la série" }).click();
  await expect(page.getByText(/^Série 1 enregistrée\. Nouveau record/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Séries de la séance" })).toContainText(
    "Série 1 : 22,5 kg × 8",
  );
  // Repos lancé à la validation, à côté de l'action principale.
  await expect(page.getByRole("timer", { name: "Repos" })).toHaveText(/^[12]:\d\d$/);
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Passer" }).click();
  await expect(page.getByRole("timer")).toBeHidden();

  // Correction d'une série déjà saisie.
  await page.getByRole("button", { name: "Modifier la série 1" }).click();
  await expect(page.getByRole("heading", { name: "Modifier la série 1" })).toBeFocused();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "+1 répétition" }).click();
  await page.getByRole("button", { name: "Enregistrer la série 1" }).click();
  await expect(page.getByText("Série 1 modifiée.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Séries de la séance" })).toContainText(
    "Série 1 : 22,5 kg × 9",
  );
  await page.getByRole("button", { name: "Retour à la séance" }).click();

  const plan = page.getByRole("list", { name: "Exercices de la séance" });
  await expect(plan.getByRole("listitem")).toHaveCount(1);
  await expect(plan).toContainText("1 série");
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
