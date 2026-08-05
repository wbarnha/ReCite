/**
 * Stands in for `@scribe.js/canvas` in the browser build.
 *
 * Scribe reaches for that package only behind `typeof process !== 'undefined'`
 * — it is the Node canvas implementation, and in a browser Scribe uses
 * `OffscreenCanvas` instead. A bundler cannot see that guard, so it follows the
 * import anyway and tries to load a native `.node` binary, which fails the
 * build.
 *
 * Aliasing it here removes the Node implementation from the browser bundle
 * entirely. That is not only a build fix: it is several megabytes of native
 * image code that would otherwise be shipped to every user of a tool that only
 * needs the browser's own canvas.
 *
 * If any of this is ever reached, something has gone wrong in a way worth
 * hearing about rather than silently degrading.
 */

const unavailable = (): never => {
  throw new Error(
    "@scribe.js/canvas is the Node canvas implementation and is not part of " +
      "the browser build. This code path should be unreachable in a browser.",
  );
};

export const createCanvas = unavailable;
export const loadImage = unavailable;
export const ImageData = undefined;
export const DOMMatrix = undefined;
export const GlobalFonts = { register: unavailable, registerFromPath: unavailable };

export default { createCanvas, loadImage, ImageData, DOMMatrix, GlobalFonts };
