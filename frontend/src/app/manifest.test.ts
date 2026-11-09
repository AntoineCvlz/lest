import { existsSync } from "node:fs";
import { join } from "node:path";

import manifest from "./manifest";

describe("manifest", () => {
  const app = manifest();

  it("décrit une app installable qui s'ouvre sur l'accueil", () => {
    expect(app).toMatchObject({ name: "Lest", start_url: "/", scope: "/", display: "standalone" });
    expect(app.lang).toBe("fr");
  });

  it("n'impose pas d'orientation (WCAG 1.3.4)", () => {
    expect(app).not.toHaveProperty("orientation");
  });

  it("fournit les icônes 192 et 512 px, dont une masquable, présentes dans public/", () => {
    const icons = app.icons ?? [];
    expect(icons.map((icon) => `${icon.sizes ?? ""} ${icon.purpose ?? ""}`)).toEqual([
      "192x192 any",
      "512x512 any",
      "512x512 maskable",
    ]);
    for (const icon of icons) {
      expect(existsSync(join(process.cwd(), "public", icon.src))).toBe(true);
    }
  });
});
