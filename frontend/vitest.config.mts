import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        // Tests unitaires et de composants (jsdom, API simulée par MSW).
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          restoreMocks: true,
        },
      },
      {
        // Chaque story est rendue dans Chromium et contrôlée par axe (a11y.test = "error").
        plugins: [
          storybookTest({ configDir: fileURLToPath(new URL("./.storybook", import.meta.url)) }),
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
          // Port du serveur du mode navigateur (63315 par défaut). Sous Windows, Hyper-V peut
          // réserver cette plage au démarrage (`netsh int ipv4 show excludedportrange
          // protocol=tcp`) : le port est alors surchargeable par une variable d'environnement.
          api: { port: Number(process.env.VITEST_BROWSER_API_PORT) || 63315 },
          setupFiles: ["./.storybook/vitest.setup.ts"],
        },
      },
    ],
  },
});
