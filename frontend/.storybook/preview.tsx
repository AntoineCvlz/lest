import "@fontsource-variable/archivo/standard.css";
import type { Preview } from "@storybook/nextjs-vite";
import { useLayoutEffect } from "react";

import "../src/app/globals.css";
import "./preview.css";

type Theme = "dark" | "light";

/** Applique le thème choisi dans la barre d'outils, comme le fera la préférence de profil. */
function ThemeFrame({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  // Layout effect : appliqué avant l'affichage et avant les tests `play` de la story.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = "fr";
  }, [theme]);
  return <div className="bg-ground text-ink min-h-24 p-6 font-sans">{children}</div>;
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Thème « Fonte calibrée »",
      toolbar: {
        title: "Thème",
        items: [
          { value: "dark", title: "Sombre" },
          { value: "light", title: "Clair" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "dark" },
  decorators: [
    (Story, context) => (
      <ThemeFrame theme={context.globals.theme === "light" ? "light" : "dark"}>
        <Story />
      </ThemeFrame>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    // Toute violation axe fait échouer la story (dans Storybook et en CI via Vitest).
    a11y: { test: "error" },
    controls: { expanded: true },
  },
  tags: ["autodocs"],
};

export default preview;
