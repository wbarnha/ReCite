import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Point workspace imports at source, not `dist`. Tests should exercise the
    // code as written — otherwise a stale build silently passes a suite whose
    // fix is sitting uncompiled in `src`.
    alias: {
      "@recite/core": src("core"),
      "@recite/rules": src("rules"),
      "@recite/engine": src("engine"),
    },
  },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
      "tools/test/**/*.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
