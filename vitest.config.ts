import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { tessdataDir } from "./tools/tessdata/generate.js";

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  // `apps/web` reads these through Vite's `define`, so a module that touches
  // one is unimportable here without them. Derived from the same functions
  // the real build uses, so a test never sees a value the app could not.
  define: {
    __RECITE_VERSION__: JSON.stringify("0.0.0.0"),
    __RECITE_COMMIT__: JSON.stringify("0".repeat(40)),
    __RECITE_BUILT_AT__: JSON.stringify("1970-01-01T00:00:00.000Z"),
    __RECITE_REPO_URL__: JSON.stringify("https://github.com/wbarnha/ReCite"),
    __RECITE_TESSDATA_DIR__: JSON.stringify(tessdataDir()),
  },
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
