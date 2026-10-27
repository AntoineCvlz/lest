import { expect, test } from "./fixtures";

test.describe("Accueil", () => {
  test("affiche le titre et l’état de l’API", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Lest" })).toBeVisible();
    // Sans backend (E2E isolé) l'API est injoignable ; avec la stack Compose, elle répond.
    await expect(
      page.getByRole("region", { name: "État du service" }).getByRole("status"),
    ).toHaveText(/API (opérationnelle|dégradée|injoignable)/);

    const screenshot = test.info().outputPath("accueil.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    await test.info().attach("accueil", { path: screenshot, contentType: "image/png" });
  });

  test("n’a aucune violation d’accessibilité WCAG 2.2 AA", async ({ page, makeAxeBuilder }) => {
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "État du service" }).getByRole("status"),
    ).not.toHaveText("Vérification de l’API…");

    const results = await makeAxeBuilder().analyze();

    expect(results.violations).toEqual([]);
  });

  test("applique une CSP à nonce sans violation", async ({ page, cspViolations }) => {
    const response = await page.goto("/");
    await expect(
      page.getByRole("region", { name: "État du service" }).getByRole("status"),
    ).not.toHaveText("Vérification de l’API…");

    const csp = (await response?.allHeaders())?.["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).not.toMatch(/unsafe/);

    // Tous les scripts émis par Next.js portent le nonce de la requête.
    const scriptNonces = await page
      .locator("script")
      .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
    expect(scriptNonces.length).toBeGreaterThan(0);
    expect(new Set(scriptNonces)).toEqual(new Set([nonce]));

    expect(cspViolations).toEqual([]);
  });

  test("change de nonce à chaque requête", async ({ request }) => {
    const nonceOf = async () => {
      const response = await request.get("/");
      return /'nonce-([^']+)'/.exec(response.headers()["content-security-policy"] ?? "")?.[1];
    };

    expect(await nonceOf()).not.toBe(await nonceOf());
  });
});
