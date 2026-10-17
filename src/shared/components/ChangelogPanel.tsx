import React from "react";
import { POPUP_CHANGELOG } from "../popupChangelog";

/** Changelog / “What’s new” for the extension (used in popup Info tab). */
export const ChangelogPanel: React.FC = () => {
  return (
    <section
      className="popup-changelog"
      aria-labelledby="popup-changelog-heading"
    >
      <h4 id="popup-changelog-heading" className="popup-changelog-title">
        What&apos;s new
      </h4>
      <p className="popup-changelog-note">
        See <strong>ENHANCEMENTS.md</strong> in the repo for the full log.
      </p>
      <div className="popup-changelog-sections">
        {POPUP_CHANGELOG.map((section) => (
          <div key={section.title} className="popup-changelog-block">
            <h5 className="popup-changelog-version">{section.title}</h5>
            <ul className="popup-changelog-list">
              {section.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
};
