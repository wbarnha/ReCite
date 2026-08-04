import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const versionFile = JSON.parse(
  readFileSync(new URL("../../version.json", import.meta.url), "utf8"),
) as { product: string; semver: string };

/** The commit the bundle was built from, so a published page can be traced. */
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * One build, two entry points.
 *
 * `index.html` is the web app; `taskpane.html` is what Word loads inside the
 * add-in. They share every component, so the Word pane is the web app with a
 * different document source rather than a second implementation that drifts.
 *
 * `base` must match the GitHub Pages sub-path, because Pages serves the site
 * from `/<repo>/` and Office will not load assets that 404.
 */
export default defineConfig(({ mode }) => ({
  base: process.env.RECITE_BASE ?? (mode === "production" ? "/ReCite/" : "/"),
  plugins: [react()],
  define: {
    __RECITE_VERSION__: JSON.stringify(versionFile.product),
    __RECITE_COMMIT__: JSON.stringify(commit()),
    // Fixed at build time rather than read at runtime, so the string in the
    // bundle is exactly what the checksum in `integrity.json` covers.
    __RECITE_BUILT_AT__: JSON.stringify(
      process.env.SOURCE_DATE_EPOCH
        ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
        : new Date().toISOString(),
    ),
  },
  resolve: {
    alias: {
      "@recite/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@recite/rules": fileURLToPath(
        new URL("../../packages/rules/src/index.ts", import.meta.url),
      ),
      "@recite/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        taskpane: fileURLToPath(new URL("taskpane.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 3000,
  },
}));
