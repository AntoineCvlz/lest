import { randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { lastCodeSentTo } from "./mailpit";

// Attente d’une réponse d’allauth (hachage Argon2, envoi d’e-mail).
const RESPONSE_TIMEOUT = 15_000;

// Ni trace ni capture : elles enregistreraient le mot de passe, le code et les cookies de
// session, et les artefacts de CI (dépôt public) ne sont pas masqués comme les journaux.
test.use({ trace: "off", screenshot: "off" });

/** Pages accessibles seulement connecté : analysées par axe pendant le parcours. */
async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** Identifiants propres à l’exécution : la base E2E garde les comptes créés. */
function freshAccount(testInfo: TestInfo, prefix: string): { email: string; password: string } {
  return {
    email: `${prefix}-${testInfo.project.name}-${String(Date.now())}@example.com`,
    password: randomBytes(18).toString("base64url"),
  };
}

/** Inscription complète par l’interface ; renvoie le code reçu, pour l’ignorer ensuite. */
async function signUp(page: Page, email: string, password: string): Promise<string> {
  await page.goto("/inscription");
  await page.getByRole("textbox", { name: "Adresse e-mail" }).fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  await expect(page).toHaveURL("/verification", { timeout: RESPONSE_TIMEOUT });
  const code = await lastCodeSentTo(email);
  await page.getByRole("textbox", { name: "Code reçu par e-mail" }).fill(code.toLowerCase());
  await page.getByRole("button", { name: "Valider le code" }).click();

  // Onboarding : objectif, unités par défaut (métriques) et taille.
  await expect(page).toHaveURL("/bienvenue", { timeout: RESPONSE_TIMEOUT });
  await expectNoAxeViolations(page);
  await page.getByText("Prise de masse").click();
  await page.getByRole("textbox", { name: "Taille (cm)" }).fill("180");
  await page.getByRole("button", { name: "Commencer" }).click();

  await expect(page).toHaveURL("/", { timeout: RESPONSE_TIMEOUT });
  await expect(page.getByText(`Connecté avec ${email}`)).toBeVisible();
  return code;
}

test("inscription, code, onboarding, puis modification du profil", async ({ page }, testInfo) => {
  const { email, password } = freshAccount(testInfo, "inscription");
  await signUp(page, email, password);

  await page.getByRole("link", { name: "Mon profil" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Prise de masse" })).toBeChecked();
  await expectNoAxeViolations(page);
  await page.getByText("Maintien").click();
  await page.getByText("lb, ft").click();
  await expect(page.getByRole("textbox", { name: "Pieds" })).toHaveValue("5");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Profil enregistré.")).toBeVisible({ timeout: RESPONSE_TIMEOUT });

  await page.reload();
  await expect(page.getByRole("radio", { name: "Maintien" })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Pouces" })).toHaveValue("11");
});

test("mot de passe oublié : code reçu, nouveau mot de passe, reconnexion", async ({
  page,
}, testInfo) => {
  const { email, password } = freshAccount(testInfo, "oubli");
  const signupCode = await signUp(page, email, password);
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByText("Vous n’êtes pas connecté.")).toBeVisible();

  await page.goto("/connexion");
  await page.getByRole("link", { name: "Mot de passe oublié ?" }).click();
  // Navigation côté client : attendre la nouvelle page, sinon le champ « Adresse e-mail » de la
  // connexion, encore affiché, serait rempli à la place du sien.
  await expect(page.getByRole("heading", { level: 1, name: "Mot de passe oublié" })).toBeVisible();
  await page.getByRole("textbox", { name: "Adresse e-mail" }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  await expect(page).toHaveURL("/mot-de-passe-oublie/code", { timeout: RESPONSE_TIMEOUT });

  const code = await lastCodeSentTo(email, { except: signupCode });
  const newPassword = randomBytes(18).toString("base64url");
  await page.getByRole("textbox", { name: "Code reçu par e-mail" }).fill(code);
  await page.getByLabel("Nouveau mot de passe").fill(newPassword);
  await page.getByRole("button", { name: "Changer le mot de passe" }).click();
  await expect(page.getByText("Mot de passe modifié. Vous pouvez vous connecter.")).toBeVisible({
    timeout: RESPONSE_TIMEOUT,
  });

  await page.getByRole("link", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();
  await page.getByRole("textbox", { name: "Adresse e-mail" }).fill(email);
  await page.getByLabel("Mot de passe").fill(newPassword);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL("/", { timeout: RESPONSE_TIMEOUT });
  await expect(page.getByText(`Connecté avec ${email}`)).toBeVisible();
});

test("connexion depuis une page privée : retour sur cette page", async ({ page }, testInfo) => {
  const { email, password } = freshAccount(testInfo, "retour");
  await signUp(page, email, password);
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByText("Vous n’êtes pas connecté.")).toBeVisible();

  await page.goto("/profil");
  await expect(page).toHaveURL("/connexion?suivant=%2Fprofil");
  await page.getByRole("textbox", { name: "Adresse e-mail" }).fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();

  await expect(page).toHaveURL("/profil", { timeout: RESPONSE_TIMEOUT });
  await expect(page.getByRole("radio", { name: "Prise de masse" })).toBeChecked();
});
