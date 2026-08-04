import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import regexp from "eslint-plugin-regexp";
import tseslint from "typescript-eslint";

/**
 * Lint configuration.
 *
 * Rules are scoped to the code they can actually say something about, so a
 * failure always means what it says. Four sets carry most of the weight, and
 * each is here because of something this repository specifically does:
 *
 * - **regexp** — the parser is built out of regular expressions. This is the
 *   only linter that reads them as a language rather than as strings.
 * - **react-hooks** — the app's state lives in `useMemo`/`useCallback`
 *   dependency arrays, which nothing else checks. A stale dependency there
 *   shows up as a check that silently uses the previous Bluebook profile.
 * - **type-checked TypeScript** — the engine is async. Untyped linting cannot
 *   see a promise that is never awaited.
 * - **vitest** — a `.only` left in a test file would make CI pass while
 *   running almost nothing.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-types/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.d.ts",
      "**/tsconfig.tsbuildinfo",
    ],
  },

  js.configs.recommended,
  regexp.configs["flat/recommended"],

  {
    rules: {
      eqeqeq: ["error", "smart"],
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // The parser hands user text to regular expressions; these are the rules
      // that read those patterns rather than trusting them.
      "regexp/no-super-linear-backtracking": "error",
      "regexp/no-potentially-useless-backreference": "error",
      "regexp/optimal-quantifier-concatenation": "error",
      "regexp/no-useless-character-class": "error",
      "regexp/prefer-character-class": "error",
      "regexp/no-obscure-range": "error",
      "regexp/no-misleading-capturing-group": "error",
    },
  },

  // ------------------------------------------------------------ TypeScript --
  // Type-aware rules need a program, so everything below is scoped to the
  // files the TypeScript projects actually include. `eslint.config.js` and the
  // other loose `.js` files are in no project, and a type-aware rule that
  // reaches one crashes the whole run rather than skipping the file.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Build-tool config sits outside the projects it configures.
          allowDefaultProject: ["vitest.config.ts", "apps/web/vite.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // A citation checker that quietly drops a rejected promise would report
      // a clean document because the check never ran.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },

  // ------------------------------------------------------------- the app ---
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      // TypeScript checks prop types, and does it better than a runtime
      // declaration nobody reads.
      "react/prop-types": "off",

      // The whole reason this plugin is here.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // React escapes children; explicit HTML injection would not be.
      "react/no-danger": "error",
      // The task pane runs inside Office, where an unguarded external link is
      // more surprising than in a browser tab.
      "react/jsx-no-target-blank": "error",
    },
  },

  // ------------------------------------------------------------- the tests --
  {
    files: ["**/test/**/*.ts", "**/*.test.ts"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      // A focused or skipped test that reaches main is worse than no test:
      // the suite still passes and nobody looks again.
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "error",
      "vitest/no-identical-title": "error",
      "vitest/expect-expect": "error",
      // Vitest, unlike Jest, takes a message as `expect`'s second argument —
      // which the fixture suites use to say which case a failure came from.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
    },
  },

  // ------------------------------------------------------------- tooling ---
  {
    // Build tooling is a CLI: printing is the point.
    files: ["tools/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
