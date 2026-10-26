import AxeBuilder from "@axe-core/playwright";
import { test as base, expect } from "@playwright/test";

interface Fixtures {
  /** Messages console signalant une violation de CSP pendant le test. */
  cspViolations: string[];
  /** Analyse axe (WCAG 2.2 A/AA) de la page courante. */
  makeAxeBuilder: () => AxeBuilder;
}

// Le second argument des fixtures est nommé `provide` et non `use` (convention Playwright) :
// `use` est pris pour un hook React par eslint-plugin-react-hooks.
export const test = base.extend<Fixtures>({
  cspViolations: async ({ page }, provide) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) violations.push(message.text());
    });
    await provide(violations);
  },
  makeAxeBuilder: async ({ page }, provide) => {
    await provide(() =>
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]),
    );
  },
});

export { expect };
