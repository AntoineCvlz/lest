import { freshAccount, signUp } from "./accounts";
import { expect, test } from "./fixtures";

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("crée un programme, une séance type et règle la cible d'un exercice", async ({
  page,
  makeAxeBuilder,
  cspViolations,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "programme");
  await signUp(page, email, password);
  await page.getByRole("link", { name: "Séance" }).first().click();
  await page.getByRole("link", { name: "Mes programmes" }).click();
  await expect(page).toHaveURL("/seance/programmes");
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await page.getByRole("textbox", { name: "Nom du nouveau programme" }).fill("PPL");
  await page.getByRole("button", { name: "Créer le programme" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "PPL" })).toBeVisible();

  const newDay = page.getByRole("region", { name: "Nouvelle séance type" });
  await newDay.getByRole("textbox", { name: "Nom de la séance type" }).fill("Poussée");
  await newDay.getByRole("button", { name: "Ajouter la séance type" }).click();
  const day = page.getByRole("region", { name: "Poussée" });
  await expect(day).toBeVisible();

  await day.getByRole("button", { name: "Ajouter un exercice" }).click();
  await page.getByRole("searchbox", { name: "Rechercher un exercice" }).fill("barbell bench press");
  const choice = page.getByRole("button", { name: /^Barbell Bench Press/ }).first();
  await expect(choice).toBeEnabled();
  await choice.click();
  const planned = day.getByRole("list", { name: "Poussée" });
  await expect(planned.getByRole("listitem")).toContainText("3 × 10");

  await day.getByRole("button", { name: "Modifier la cible de Barbell Bench Press" }).click();
  await day.getByRole("button", { name: "+1 série" }).click();
  await day.getByRole("button", { name: "−1 répétition" }).click();
  await day.getByRole("button", { name: "−1 répétition" }).click();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  await day.getByRole("button", { name: "Enregistrer la cible" }).click();
  await expect(planned.getByRole("listitem")).toContainText("4 × 8");

  await page.getByRole("link", { name: "Tous les programmes" }).click();
  await expect(page.getByRole("list", { name: "Mes programmes" })).toContainText(
    "1 séance type, 1 exercice",
  );
  expect(cspViolations).toEqual([]);
});
