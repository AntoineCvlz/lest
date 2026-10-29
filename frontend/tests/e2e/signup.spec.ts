import { expect, test } from "./fixtures";

const THEMES = ["dark", "light"] as const;

for (const scheme of THEMES) {
  test.describe(`Comptes, thème ${scheme === "dark" ? "sombre" : "clair"}`, () => {
    test.use({ colorScheme: scheme });

    for (const [path, title] of [
      ["/inscription", "Créer un compte"],
      ["/verification", "Vérifiez votre adresse"],
      ["/mot-de-passe-oublie", "Mot de passe oublié"],
      ["/mot-de-passe-oublie/code", "Nouveau mot de passe"],
      ["/compte-supprime", "Compte supprimé"],
      ["/connexion/code", "Code de vérification"],
    ] as const) {
      test(`${path} n’a aucune violation d’accessibilité`, async ({ page, makeAxeBuilder }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

        expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
        const screenshot = test
          .info()
          .outputPath(`${path.slice(1).replaceAll("/", "-")}-${scheme}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        await test.info().attach(`${path.slice(1).replaceAll("/", "-")}-${scheme}`, {
          path: screenshot,
          contentType: "image/png",
        });
      });
    }
  });
}

test("la connexion propose de créer un compte", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Créer un compte" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Créer un compte" })).toBeVisible();
});

test("une page privée ouverte sans session renvoie vers la connexion", async ({ page }) => {
  await page.goto("/profil");

  await expect(page).toHaveURL("/connexion?suivant=%2Fprofil");
  await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();
});
