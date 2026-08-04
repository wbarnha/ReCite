/**
 * Draw the add-in icons.
 *
 * A rounded square in the product blue with four white bars — three long, one
 * short — reading as lines of a document with one line marked. Office shows
 * these at 16px in the ribbon, so the mark has to survive being tiny; anything
 * more detailed turns to mush.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Rgba } from "./png.js";
import { encodePng } from "./png.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "..", "apps", "web", "public", "icons");

const BLUE: Rgba = { r: 26, g: 79, b: 138, a: 255 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
const AMBER: Rgba = { r: 224, g: 179, b: 65, a: 255 };
const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** Bars as fractions of the icon: [top, left, width, height, colour]. */
const BARS: ReadonlyArray<readonly [number, number, number, number, Rgba]> = [
  [0.26, 0.22, 0.56, 0.075, WHITE],
  [0.42, 0.22, 0.56, 0.075, WHITE],
  [0.58, 0.22, 0.34, 0.075, AMBER],
  [0.74, 0.22, 0.46, 0.075, WHITE],
];

function draw(size: number): Buffer {
  const pixels: Rgba[] = Array.from({ length: size * size }, () => CLEAR);
  const radius = size * 0.22;

  const inRoundedSquare = (x: number, y: number): boolean => {
    const inset = size * 0.04;
    const min = inset;
    const max = size - inset;
    if (x < min || y < min || x > max || y > max) return false;

    // Only the four corners need the distance check.
    const cx = x < min + radius ? min + radius : x > max - radius ? max - radius : x;
    const cy = y < min + radius ? min + radius : y > max - radius ? max - radius : y;
    if (cx === x && cy === y) return true;
    return Math.hypot(x - cx, y - cy) <= radius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRoundedSquare(x + 0.5, y + 0.5)) pixels[y * size + x] = BLUE;
    }
  }

  for (const [top, left, width, height, colour] of BARS) {
    const y0 = Math.round(top * size);
    const y1 = Math.max(y0 + 1, Math.round((top + height) * size));
    const x0 = Math.round(left * size);
    const x1 = Math.max(x0 + 1, Math.round((left + width) * size));

    for (let y = y0; y < y1 && y < size; y++) {
      for (let x = x0; x < x1 && x < size; x++) {
        if (pixels[y * size + x] !== CLEAR) pixels[y * size + x] = colour;
      }
    }
  }

  return encodePng(size, pixels);
}

/** Sizes an Office add-in manifest can reference. */
export const ICON_SIZES = [16, 32, 64, 80, 128] as const;

export function generateIcons(outDir: string = OUT_DIR): string[] {
  mkdirSync(outDir, { recursive: true });

  return ICON_SIZES.map((size) => {
    const path = join(outDir, `icon-${size}.png`);
    writeFileSync(path, draw(size));
    return path;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const written = generateIcons();
  console.log(`Wrote ${written.length} icons to ${OUT_DIR}`);
}
