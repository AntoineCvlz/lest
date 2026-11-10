import { randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { lastCodeSentTo } from "./mailpit";

// Attente d’une réponse d’allauth (hachage Argon2, envoi d’e-mail).
const RESPONSE_TIMEOUT = 15_000;

/** Pages accessibles seulement connecté : analysées par axe pendant le parcours. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  // Après une navigation côté client, l'URL change avant que Next pose le titre de la page :
  // axe lancé trop tôt verrait un document sans titre. Une page sans titre échoue toujours ici.
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** Identifiants propres à l’exécution : la base E2E garde les comptes créés. */
export function freshAccount(
  testInfo: TestInfo,
  prefix: string,
): { email: string; password: string } {
  return {
    email: `${prefix}-${testInfo.project.name}-${String(Date.now())}@example.com`,
    password: randomBytes(18).toString("base64url"),
  };
}

// Limite d'allauth : 20 inscriptions par minute et par IP. En CI, une seule IP pour toute la
// suite (deux comptes par parcours, un par projet) : on attend la fenêtre suivante au lieu
// d'échouer, sans toucher à la limite elle-même.
const SIGNUP_RATE_WINDOW = 61_000;
const RATE_LIMITED = "Trop d’inscriptions depuis cette connexion. Réessayez dans quelques minutes.";

/** Envoie le formulaire d'inscription, et le renvoie une fois si la limite de débit est atteinte. */
async function submitSignUp(page: Page): Promise<void> {
  const create = page.getByRole("button", { name: "Créer mon compte" });
  await create.click();
  const limited = page.getByText(RATE_LIMITED);
  await expect(
    page.getByText(RATE_LIMITED).or(page.getByRole("textbox", { name: "Code reçu par e-mail" })),
  ).toBeVisible({ timeout: RESPONSE_TIMEOUT });
  if (await limited.isVisible()) {
    test.info().setTimeout(test.info().timeout + SIGNUP_RATE_WINDOW);
    await page.waitForTimeout(SIGNUP_RATE_WINDOW);
    await create.click();
  }
  await expect(page).toHaveURL("/verification", { timeout: RESPONSE_TIMEOUT });
}

/** Inscription complète par l’interface ; renvoie le code reçu, pour l’ignorer ensuite. */
export async function signUp(page: Page, email: string, password: string): Promise<string> {
  await page.goto("/inscription");
  await page.getByRole("textbox", { name: "Adresse e-mail" }).fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await submitSignUp(page);
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
