import type { BluebookEdition, BluebookProfile, CitationStyle } from "@recite/core";
import {
  BLUEBOOK_EDITIONS,
  CITATION_STYLES,
  STYLE_NAME,
  STYLE_SCOPE,
} from "@recite/core";

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
 * Which Bluebook to check against: the edition, and which half of it.
 *
 * Both settings change real results, not just wording. From the 21st edition
 * the Bluepages permit closing up reporter abbreviations (`119 S.Ct. 662`),
 * which the Whitepages never do — so the same document is clean under one
 * setting and flagged under another, and the user has to be able to say which
 * one they are writing to.
 *
 * The options are labelled Bluepages and Whitepages because that is what the
 * book calls them and what a brief-writer will look for.
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
        rules
        <select
          value={profile.style}
          disabled={disabled}
          aria-label="Bluebook rule set: Bluepages or Whitepages"
          title="Bluepages rules govern court filings; Whitepages rules govern scholarly writing."
          onChange={(event) => onStyle(event.target.value as CitationStyle)}
        >
          {CITATION_STYLES.map((style) => (
            <option key={style} value={style}>
              {STYLE_NAME[style]} — {STYLE_SCOPE[style]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
