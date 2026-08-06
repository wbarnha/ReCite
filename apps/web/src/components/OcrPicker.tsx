import type { OcrMode, OcrSettings } from "../import/ocr-options.js";
import { OCR_MODE_HELP, OCR_MODE_LABEL, OCR_MODES } from "../import/ocr-options.js";

export interface OcrPickerProps {
  readonly settings: OcrSettings;
  readonly onMode: (mode: OcrMode) => void;
  readonly disabled?: boolean;
}

/**
 * When to recognise text from page images.
 *
 * Worth a control rather than a heuristic because the right answer depends on
 * something only the reader knows. `auto` trusts a PDF's text layer, which is
 * correct almost always and wrong for a scanner that baked in its own bad OCR
 * — the text looks native, so `auto` never re-reads it, and the errors sail
 * through. `never` is for the opposite case: a document you know is
 * text-native and want no guessed characters in at all.
 *
 * The worker count is deliberately not exposed here. It changes speed, not
 * results, and a control that makes a document check slower or faster without
 * changing what it says is a support question rather than a feature.
 */
export function OcrPicker({ settings, onMode, disabled }: OcrPickerProps) {
  return (
    <label className="checkbox">
      OCR
      <select
        value={settings.mode}
        disabled={disabled}
        aria-label="When to read text from page images"
        title={OCR_MODE_HELP[settings.mode]}
        onChange={(event) => onMode(event.target.value as OcrMode)}
      >
        {OCR_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {OCR_MODE_LABEL[mode]}
          </option>
        ))}
      </select>
    </label>
  );
}
