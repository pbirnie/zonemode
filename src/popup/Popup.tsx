import React, { useEffect } from "react";
import { SettingsPanel } from "../shared/components/SettingsPanel";
import { createLogger } from "../shared/logger";
import { logPrdEvent } from "../shared/prdEventLog";

const log = createLogger("popup");

export const Popup: React.FC = () => {
  useEffect(() => {
    log.log("Popup rendered");
    logPrdEvent("popup", "Popup", "mount", { tabbed: true });
  }, []);
  return (
    <div className="popup-root">
      <div className="popup-scroll-pane">
        <SettingsPanel
          showHeader={true}
          tabbed
          onClose={() => window.close()}
        />
      </div>
    </div>
  );
};
