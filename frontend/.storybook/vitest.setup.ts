import * as a11yAnnotations from "@storybook/addon-a11y/preview";
import { setProjectAnnotations } from "@storybook/nextjs-vite";

import * as projectAnnotations from "./preview";

// Les stories exécutées par Vitest reçoivent la même configuration que dans Storybook
// (thème, police, et contrôle axe en mode « error »).
setProjectAnnotations([a11yAnnotations, projectAnnotations]);
