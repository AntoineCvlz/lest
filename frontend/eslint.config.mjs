import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import storybook from "eslint-plugin-storybook";
import tseslint from "typescript-eslint";

// eslint-config-next enregistre déjà les plugins jsx-a11y et @typescript-eslint :
// on ne reprend que les règles des presets stricts pour éviter un double enregistrement.
const rulesOf = (configs) => Object.assign({}, ...configs.map((config) => config.rules ?? {}));

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    name: "lest/a11y-strict",
    rules: jsxA11y.flatConfigs.strict.rules,
  },
  {
    name: "lest/typescript-strict",
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...rulesOf(tseslint.configs.strictTypeChecked),
      ...rulesOf(tseslint.configs.stylisticTypeChecked),
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  ...storybook.configs["flat/recommended"],
  globalIgnores([
    "storybook-static/**",
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/shared/api/schema.d.ts", // généré par `pnpm typegen`
    "src/shared/api/auth-schema.d.ts", // idem, depuis la spécification allauth
  ]),
]);
