import { expect, test } from "./fixtures";

const THEMES = ["dark", "light"] as const;
// Attente d’une réponse d’allauth (hachage Argon2) : large pour le serveur de dev local.
const RESPONSE_TIMEOUT = 15_000;

for (const scheme of THEMES) {
  test.describe(`Connexion, thème ${scheme === "dark" ? "sombre" : "clair"}`, () => {
    test.use({ colorScheme: scheme });

    test("n’a aucune violation d’accessibilité, même en erreur", async ({
      page,
      makeAxeBuilder,
      cspViolations,
    }) => {
      await page.goto("/connexion");
      await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();
      expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

      // Adresse inconnue : ne consomme pas le quota d'échecs du compte E2E.
      await page.getByRole("textbox", { name: "Adresse e-mail" }).fill("inconnu@example.com");
      await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
      await page.getByRole("button", { name: "Se connecter" }).click();
      // `filter` : Next.js ajoute sa propre région `alert` (annonce des changements de route).
      await expect(
        page.getByRole("alert").filter({ hasText: "Adresse e-mail ou mot de passe incorrect." }),
      ).toBeVisible({ timeout: RESPONSE_TIMEOUT });
      expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

      const screenshot = test.info().outputPath(`connexion-erreur-${scheme}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await test.info().attach(`connexion-erreur-${scheme}`, {
        path: screenshot,
        contentType: "image/png",
      });
      expect(cspViolations).toEqual([]);
    });
  });
}

test.describe("Sans JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("le formulaire ne s’envoie pas tout seul", async ({ page }) => {
    await page.goto("/connexion");
    const requests: string[] = [];
    page.on("request", (request) => requests.push(`${request.method()} ${request.url()}`));

    await page.getByRole("textbox", { name: "Adresse e-mail" }).fill("membre@example.com");
    await page.getByLabel("Mot de passe").fill("un-mot-de-passe");
    await page.getByLabel("Mot de passe").press("Enter");

    await expect(page.getByRole("button", { name: "Se connecter" })).toBeDisabled();
    await expect(page).toHaveURL("/connexion");
    expect(requests).toEqual([]);
  });
});
