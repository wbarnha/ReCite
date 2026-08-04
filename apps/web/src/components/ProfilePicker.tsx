import type { BluebookEdition, BluebookProfile, CitationStyle } from "@recite/core";
import { BLUEBOOK_EDITIONS } from "@recite/core";

const EDITION_LABEL: Record<BluebookEdition, string> = {
  20: "20th (2015)",
  21: "21st (2020)",
  22: "22nd (2025)",
};

export interface ProfilePickerProps {
  readonly profile: BluebookProfile;
  readonly onEdition: (edition: BluebookEdition) => void;
  readonly onStyle: (style: CitationStyle) => void;
  readonly disabled?: boolean;
}

/**
 * Which Bluebook to check against.
 *
 * This changes real results, not just wording: from the 21st edition a court
 * filing may close up reporter abbreviations (`119 S.Ct. 662`), so the same
 * document is clean under one setting and flagged under another.
 */
export function ProfilePicker({
  profile,
  onEdition,
  onStyle,
  disabled,
}: ProfilePickerProps) {
  return (
    <div className="toolbar">
      <label className="checkbox">
        Bluebook
        <select
          value={profile.edition}
          disabled={disabled}
          aria-label="Bluebook edition"
          onChange={(event) => onEdition(Number(event.target.value) as BluebookEdition)}
        >
          {BLUEBOOK_EDITIONS.map((edition) => (
            <option key={edition} value={edition}>
              {EDITION_LABEL[edition]}
            </option>
          ))}
        </select>
      </label>

      <label className="checkbox">
        for
        <select
          value={profile.style}
          disabled={disabled}
          aria-label="Citation style"
          onChange={(event) => onStyle(event.target.value as CitationStyle)}
        >
          <option value="practitioner">court documents</option>
          <option value="academic">scholarly writing</option>
        </select>
      </label>
    </div>
  );
}
