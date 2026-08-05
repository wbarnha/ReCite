/**
 * Check a generated manifest against what AppSource will reject it for.
 *
 * Microsoft publishes an official validator (`office-addin-manifest
 * validate`), and it is worth running before a submission. It is not what this
 * is. That tool posts the manifest to a Microsoft web service, which means it
 * needs a network and cannot run on every commit — and this project has no
 * runtime dependencies precisely so that nothing is pulled in that does not
 * have to be.
 *
 * So this checks, offline and on every build, the subset of the store's rules
 * that are checkable from the file itself: the ones that come back as a
 * rejection weeks after submission rather than as a build failure. Passing
 * here does not mean the submission will be accepted. Failing here means it
 * will not be.
 *
 * Sources: the Office Add-ins XML manifest schema, and Microsoft's AppSource
 * validation policies for Office Add-ins.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "..", "apps", "web", "dist");

/** AppSource limits, in characters. */
const LIMITS = {
  displayName: 125,
  description: 250,
} as const;

/** Icon sizes AppSource expects, by the element that must point at them. */
const ICON_EXPECTATIONS = [
  { element: "IconUrl", size: 64 },
  { element: "HighResolutionIconUrl", size: 128 },
] as const;

export interface Problem {
  readonly severity: "error" | "warning";
  readonly rule: string;
  readonly detail: string;
}

/** Pull the text of a top-level element, or the `DefaultValue` attribute. */
function field(xml: string, tag: string): string | undefined {
  const withValue = new RegExp(`<${tag}\\b[^>]*DefaultValue="([^"]*)"`, "i").exec(xml);
  if (withValue?.[1] !== undefined) return withValue[1];

  const withText = new RegExp(`<${tag}\\b[^>]*>([^<]*)</${tag}>`, "i").exec(xml);
  return withText?.[1];
}

/**
 * Every absolute URL the manifest points at.
 *
 * Both spellings matter and it is easy to catch only one: URLs appear as
 * `DefaultValue="https://…"` on most elements but as element text inside
 * `<AppDomain>`. An earlier version of this required whitespace after
 * `DefaultValue` and so silently checked nothing but the app domains.
 */
export function urls(xml: string): string[] {
  const found = [
    ...xml.matchAll(/DefaultValue\s*=\s*"(https?:\/\/[^"]+)"/gi),
    ...xml.matchAll(/>\s*(https?:\/\/[^<\s]+)\s*</gi),
  ];
  return found
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
}

export function validateManifest(xml: string): Problem[] {
  const problems: Problem[] = [];
  const error = (rule: string, detail: string) =>
    problems.push({ severity: "error", rule, detail });
  const warn = (rule: string, detail: string) =>
    problems.push({ severity: "warning", rule, detail });

  // --- Version -----------------------------------------------------------
  const version = field(xml, "Version");
  if (!version) {
    error("version", "No <Version> element.");
  } else if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    error(
      "version",
      `<Version> is ${JSON.stringify(version)}; Office requires exactly four ` +
        "numeric components and does not accept semver.",
    );
  } else {
    const parts = version.split(".").map(Number);
    if (parts.some((part) => part > 65535)) {
      error("version", `<Version> ${version} has a component above 65535.`);
    }
    if (parts[3] !== 0) {
      error(
        "version",
        `<Version> ${version} must end in .0 — the fourth component is fixed ` +
          "at zero so it cannot drift from the release tag.",
      );
    }
    if (parts.every((part) => part === 0)) {
      error("version", "<Version> 0.0.0.0 will be rejected as unset.");
    }
  }

  // --- Identity ----------------------------------------------------------
  const id = field(xml, "Id");
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    error("id", `<Id> must be a GUID; found ${JSON.stringify(id ?? "")}.`);
  }

  const displayName = field(xml, "DisplayName");
  if (!displayName) {
    error("display-name", "No <DisplayName>.");
  } else if (displayName.length > LIMITS.displayName) {
    error(
      "display-name",
      `<DisplayName> is ${displayName.length} characters; the limit is ${LIMITS.displayName}.`,
    );
  }

  const description = field(xml, "Description");
  if (!description) {
    error("description", "No <Description>. AppSource requires one.");
  } else {
    if (description.length > LIMITS.description) {
      error(
        "description",
        `<Description> is ${description.length} characters; the limit is ${LIMITS.description}.`,
      );
    }
    if (description.length < 30) {
      warn(
        "description",
        `<Description> is only ${description.length} characters; a listing this ` +
          "thin tends to come back for revision.",
      );
    }
  }

  if (!field(xml, "ProviderName")) error("provider", "No <ProviderName>.");

  // --- Support and icons -------------------------------------------------
  if (!field(xml, "SupportUrl")) {
    error("support-url", "No <SupportUrl>. AppSource requires a support page.");
  }

  for (const { element, size } of ICON_EXPECTATIONS) {
    const value = field(xml, element);
    if (!value) {
      error("icons", `No <${element}>.`);
      continue;
    }
    if (!value.includes(`-${size}.`)) {
      warn(
        "icons",
        `<${element}> points at ${value}, which does not look like the ` +
          `${size}x${size} icon AppSource expects.`,
      );
    }
  }

  // --- Transport ---------------------------------------------------------
  // Office refuses to load an add-in over plain HTTP, and a mixed-content
  // manifest fails at install time rather than at submission.
  for (const url of urls(xml)) {
    if (url.startsWith("http://")) {
      error("https", `${url} is not HTTPS. Office requires HTTPS for every URL.`);
    }
    if (/localhost|127\.0\.0\.1/i.test(url)) {
      error("https", `${url} points at a development host.`);
    }
  }

  if (!/<AppDomains>/.test(xml)) {
    warn(
      "app-domains",
      "No <AppDomains>. Any origin the add-in navigates to must be listed.",
    );
  }

  // --- Permissions -------------------------------------------------------
  const permissions = field(xml, "Permissions");
  if (!permissions) {
    error("permissions", "No <Permissions>.");
  } else if (permissions !== "ReadWriteDocument") {
    warn(
      "permissions",
      `<Permissions> is ${permissions}. Ask for the least that works — a ` +
        "broader request draws review attention and is harder to justify.",
    );
  }

  // --- Well-formedness ---------------------------------------------------
  if (!xml.startsWith("<?xml")) {
    error("xml", "Missing the XML declaration.");
  }
  if (!/xsi:type="TaskPaneApp"/.test(xml)) {
    error("xml", 'Root <OfficeApp> is not xsi:type="TaskPaneApp".');
  }

  return problems;
}

function main(): void {
  const path = process.argv[2] ?? join(DIST, "manifest.xml");
  const xml = readFileSync(path, "utf8");
  const problems = validateManifest(xml);

  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");

  console.log(`Validating ${path}`);

  for (const problem of problems) {
    const line = `  ${problem.severity}: [${problem.rule}] ${problem.detail}`;
    if (problem.severity === "error") console.error(line);
    else console.warn(line);
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::${problem.severity}::${problem.rule}: ${problem.detail}`);
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log("  No problems found.");
  }
  console.log(
    `\n${errors.length} error(s), ${warnings.length} warning(s). ` +
      "This covers what is checkable offline; run `npx office-addin-manifest " +
      "validate` against Microsoft's service before submitting.",
  );

  if (errors.length > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
