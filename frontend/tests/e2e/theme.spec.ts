import { expect, test } from "./fixtures";

// Fond attendu de chaque thème (tokens « Fonte calibrée », docs/design-system.md).
const THEMES = [
  { scheme: "dark", ground: "rgb(27, 36, 45)" },
  { scheme: "light", ground: "rgb(238, 241, 244)" },
] as const;

for (const { scheme, ground } of THEMES) {
  test.describe(`Thème ${scheme === "dark" ? "sombre" : "clair"}`, () => {
    test.use({ colorScheme: scheme });

    test("applique les tokens et la police Archivo auto-hébergée", async ({ page }) => {
      await page.goto("/");
      await expect(
        page.getByRole("region", { name: "État du service" }).getByRole("status"),
      ).not.toHaveText("Vérification de l’API…");

      const body = await page.evaluate(() => {
        const style = getComputedStyle(document.body);
        return { background: style.backgroundColor, font: style.fontFamily };
      });
      expect(body.background).toBe(ground);
      expect(body.font).toMatch(/Archivo/);
      // La police est réellement chargée (servie par l'app : la CSP refuserait un tiers).
      // next/font renomme la famille (« __Archivo_… »), d'où la recherche par motif.
      const archivoLoaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (f) => f.family.includes("Archivo") && f.status === "loaded",
        );
      });
      expect(archivoLoaded).toBe(true);

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
