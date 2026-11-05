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

  test("est installable : manifest et icônes servis par l'image de prod", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBe("/manifest.webmanifest");

    const manifest = (await (await request.get("/manifest.webmanifest")).json()) as {
      icons: { src: string }[];
    };
    for (const icon of manifest.icons) {
      const response = await request.get(icon.src);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
    }
  });

  test("change de nonce à chaque requête", async ({ request }) => {
    const nonceOf = async () => {
      const response = await request.get("/");
      return /'nonce-([^']+)'/.exec(response.headers()["content-security-policy"] ?? "")?.[1];
    };

    expect(await nonceOf()).not.toBe(await nonceOf());
  });
});
