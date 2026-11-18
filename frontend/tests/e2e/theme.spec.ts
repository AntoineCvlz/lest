import { expect, test } from "./fixtures";

// Fond attendu de chaque thème (tokens « Magnésie », docs/design-system.md).
const THEMES = [
  { scheme: "dark", ground: "rgb(26, 34, 44)" },
  { scheme: "light", ground: "rgb(243, 245, 248)" },
] as const;

for (const { scheme, ground } of THEMES) {
  test.describe(`Thème ${scheme === "dark" ? "sombre" : "clair"}`, () => {
    test.use({ colorScheme: scheme });

    test("applique les tokens et la police Public Sans auto-hébergée", async ({ page }) => {
      await page.goto("/");
      await expect(
        page.getByRole("region", { name: "État du service" }).getByRole("status"),
      ).not.toHaveText("Vérification de l’API…");

      const body = await page.evaluate(() => {
        const style = getComputedStyle(document.body);
        return { background: style.backgroundColor, font: style.fontFamily };
      });
      expect(body.background).toBe(ground);
      expect(body.font).toMatch(/Public Sans/);
      // La police est réellement chargée (servie par l'app : la CSP refuserait un tiers).
      // next/font renomme la famille (« Public Sans » suivi d'un suffixe), d'où la recherche par motif.
      const textFontLoaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (f) => f.family.includes("Public Sans") && f.status === "loaded",
        );
      });
      expect(textFontLoaded).toBe(true);

      const screenshot = test.info().outputPath(`accueil-${scheme}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await test.info().attach(`accueil-${scheme}`, { path: screenshot, contentType: "image/png" });
    });

    test("n’a aucune violation d’accessibilité WCAG 2.2 AA", async ({ page, makeAxeBuilder }) => {
      await page.goto("/");
      await expect(
        page.getByRole("region", { name: "État du service" }).getByRole("status"),
      ).not.toHaveText("Vérification de l’API…");

      expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
    });
  });
}
