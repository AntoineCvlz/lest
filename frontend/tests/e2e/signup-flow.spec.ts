import { randomBytes } from "node:crypto";

import { expect, test } from "./fixtures";
import { lastCodeSentTo } from "./mailpit";

// Attente d’une réponse d’allauth (hachage Argon2, envoi d’e-mail).
const RESPONSE_TIMEOUT = 15_000;

// Ni trace ni capture : elles enregistreraient le mot de passe, le code et les cookies de
// session, et les artefacts de CI (dépôt public) ne sont pas masqués comme les journaux.
test.use({ trace: "off", screenshot: "off" });

test("inscription, code reçu par e-mail, puis session ouverte", async ({ page }, testInfo) => {
  // Adresse et mot de passe propres à l’exécution : la base E2E garde les comptes créés.
  const email = `inscription-${testInfo.project.name}-${String(Date.now())}@example.com`;
  const password = randomBytes(18).toString("base64url");

  await page.goto("/inscription");
  await page.getByRole("textbox", { name: "Adresse e-mail" }).fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  await expect(page).toHaveURL("/verification", { timeout: RESPONSE_TIMEOUT });
  const code = await lastCodeSentTo(email);
  await page.getByRole("textbox", { name: "Code reçu par e-mail" }).fill(code.toLowerCase());
  await page.getByRole("button", { name: "Valider le code" }).click();

  await expect(page).toHaveURL("/", { timeout: RESPONSE_TIMEOUT });
  await expect(page.getByText(`Connecté avec ${email}`)).toBeVisible();
});
