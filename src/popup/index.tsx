import React from "react";
import { createRoot } from "react-dom/client";
import { Popup } from "./Popup";
import { createLogger } from "../shared/logger";

const log = createLogger("popup");

log.log("popup entry loading");
const rootElement = document.getElementById("root");
if (!rootElement) {
  log.error("root element not found");
} else {
  const root = createRoot(rootElement);
  root.render(<Popup />);
  log.log("popup mounted");
}
