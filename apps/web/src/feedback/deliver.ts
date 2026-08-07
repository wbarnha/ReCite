/**
 * Handing a report to the person who wrote it.
 *
 * ReCite has no server, so it cannot receive a bug report — which turns out to
 * be the right shape anyway: the reporter decides where a piece of their
 * document goes, having read it. This module is the whole of that decision,
 * and it is one file so that `tools/test/privacy-claims.test.ts` can pin it.
 * Three ways out, in order of how much they tell anyone:
 *
 * | | Who sees it |
 * | --- | --- |
 * | {@link copyReport} | the clipboard on this machine |
 * | {@link saveReport} | a file on this disk |
 * | {@link openIssue} | GitHub, and then the public |
 *
 * The first two involve no network at all. The third leaves the page, and the
 * caller must have shown the reporter exactly what it carries first — which is
 * why the dialog's preview is not decoration.
 */

import { downloadBlob } from "../export/index.js";

/**
 * Put the report on the clipboard.
 *
 * The default action, because it is the one that tells nobody anything: the
 * text goes to this machine's clipboard and stops there. Returns whether it
 * worked, because a clipboard write can be refused — an insecure context, a
 * permission policy, a browser that wants a gesture it did not get — and a
 * button that quietly failed would lose the report the person just wrote.
 */
export async function copyReport(markdown: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(markdown);
    return true;
  } catch {
    return false;
  }
}

/** Save it as a file, for an internal tracker or an email. */
export function saveReport(markdown: string, name: string): void {
  downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), name);
}

/**
 * Open a prefilled issue.
 *
 * This is the one action in ReCite that sends a piece of a document anywhere,
 * and it is a navigation the user asked for, carrying only what the preview
 * showed them. It is deliberately not the default.
 *
 * Word gets its own call: a task pane is a frame inside Office, and
 * `window.open` from one is unreliable and would try to navigate the pane in
 * some hosts. `openBrowserWindow` hands the URL to the system browser, which
 * is where a bug report belongs anyway.
 */
export function openIssue(url: string): boolean {
  const office = officeUi();
  if (office) {
    office.openBrowserWindow(url);
    return true;
  }
  return window.open(url, "_blank", "noopener,noreferrer") !== null;
}

/** Office's UI namespace, when running inside a host that has it. */
function officeUi(): { openBrowserWindow(url: string): void } | undefined {
  if (typeof Office === "undefined") return undefined;
  const ui = Office.context?.ui as
    { openBrowserWindow?: (url: string) => void } | undefined;
  return typeof ui?.openBrowserWindow === "function"
    ? { openBrowserWindow: ui.openBrowserWindow.bind(ui) }
    : undefined;
}
