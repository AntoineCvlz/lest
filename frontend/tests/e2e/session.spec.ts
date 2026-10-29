import { expect, test } from "./fixtures";

// Compte vérifié créé avant les E2E (`manage.py create_verified_user`, voir e2e.yml) ;
// mot de passe aléatoire, propre à chaque exécution.
const EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@example.com";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "";
// Attente d’une réponse d’allauth (hachage Argon2) : large pour le serveur de dev local.
const RESPONSE_TIMEOUT = 15_000;

// Ni trace ni capture pour ce fichier : elles enregistreraient le mot de passe saisi, et les
// artefacts de CI (dépôt public) ne sont pas masqués comme les journaux.
test.use({ trace: "off", screenshot: "off" });

test("connexion puis déconnexion, sans jeton lisible par le JavaScript", async ({ page }) => {
  test.skip(!PASSWORD && !process.env.CI, "E2E_USER_PASSWORD non défini (compte E2E local)");
  // Aucun envoi natif du formulaire : les identifiants ne doivent jamais figurer dans une URL.
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));

  await page.goto("/connexion");
  await page.getByRole("textbox", { name: "Adresse e-mail" }).fill(EMAIL);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();

  await expect(page).toHaveURL("/", { timeout: RESPONSE_TIMEOUT });
  await expect(page.getByRole("status").filter({ hasText: "Connecté avec" })).toHaveText(
    `Connecté avec ${EMAIL}`,
  );
  // Seul le jeton CSRF est lisible ; les jetons d'authentification sont HttpOnly.
  const readable = await page.evaluate(() => document.cookie);
  expect(readable).toMatch(/lest_csrf=/);
  expect(readable).not.toMatch(/lest_(at|rt|st)=/);

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByText("Vous n’êtes pas connecté.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Se connecter" })).toBeVisible();
  expect(urls.filter((url) => url.includes("password"))).toEqual([]);
});
