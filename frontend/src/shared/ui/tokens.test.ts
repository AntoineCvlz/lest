// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

/** Déclarations `--lest-*` du premier bloc `{…}` qui suit `selector`. */
function declarations(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Sélecteur introuvable : ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const block = css.slice(open + 1, close);
  return new Map(
    [...block.matchAll(/(--lest-[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = "", value = ""]) => [
      name,
      value.trim(),
    ]),
  );
}

describe("tokens.css", () => {
  const dark = declarations(":root {");
  const lightBySystem = declarations(':root:not([data-theme="dark"])');
  const lightByChoice = declarations(':root[data-theme="light"]');

  it("déclare le même thème clair pour le réglage système et pour le choix explicite", () => {
    expect(lightByChoice).toEqual(lightBySystem);
  });

  it("redéfinit en clair chaque couleur du thème sombre qui dépend du fond", () => {
    const themed = [...lightBySystem.keys()];
    expect(themed.length).toBeGreaterThan(10);
    for (const name of themed) expect(dark.has(name)).toBe(true);
  });

  it("garde le jaune comme fond dans les deux thèmes, jamais comme texte en clair", () => {
    expect(dark.get("--lest-accent")).toBe("#f2c230");
    expect(lightBySystem.has("--lest-accent")).toBe(false);
    expect(lightBySystem.get("--lest-accent-ink")).not.toBe("#f2c230");
  });
});
