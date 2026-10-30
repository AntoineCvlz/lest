import { expect, test } from "./fixtures";

// Compte E2E et catalogue de test importés par la CI (`create_verified_user`, puis
// `import_exercises --file` avec la fixture wger du back, voir e2e.yml).
const EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@example.com";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "";
const RESPONSE_TIMEOUT = 15_000;

// Ni trace ni capture : elles enregistreraient le mot de passe saisi (artefacts CI publics).
test.use({ trace: "off", screenshot: "off" });

test("cherche un exercice sans accents et filtre le catalogue", async ({
  page,
  makeAxeBuilder,
  cspViolations,
}) => {
  test.skip(!PASSWORD && !process.env.CI, "E2E_USER_PASSWORD non défini (compte E2E local)");
  await page.goto("/connexion?suivant=/exercices");
  await page.getByRole("textbox", { name: "Adresse e-mail" }).fill(EMAIL);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL("/exercices", { timeout: RESPONSE_TIMEOUT });

  await page.getByRole("searchbox", { name: "Rechercher un exercice" }).fill("developpe COUCHE");
  const list = page.getByRole("list", { name: "Exercices" });
  // Premier résultat : vrai en CI (fixture) comme sur le catalogue complet en local.
  await expect(list.getByRole("listitem").first()).toContainText("Développé couché");
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

  await page.getByText("Filtres", { exact: true }).click();
  await page.getByRole("combobox", { name: "Catégorie" }).selectOption({ label: "Mollets" });
  await expect(page.getByText("Aucun exercice ne correspond", { exact: false })).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  expect(cspViolations).toEqual([]);
});

test("la page des sources crédite wger et ses licences", async ({ page, makeAxeBuilder }) => {
  await page.goto("/sources");

  await expect(page.getByRole("link", { name: "wger" })).toHaveAttribute("href", "https://wger.de");
  await expect(page.getByRole("link", { name: "CC BY-SA 4.0" })).toBeVisible();
  expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
});
