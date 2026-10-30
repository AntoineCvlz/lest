import { randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

import { expect } from "./fixtures";
import { lastCodeSentTo } from "./mailpit";

// Attente d’une réponse d’allauth (hachage Argon2, envoi d’e-mail).
const RESPONSE_TIMEOUT = 15_000;

/** Pages accessibles seulement connecté : analysées par axe pendant le parcours. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
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

/** Inscription complète par l’interface ; renvoie le code reçu, pour l’ignorer ensuite. */
export async function signUp(page: Page, email: string, password: string): Promise<string> {
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
