import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { initializeHotkeys } from "@/lib/hotkeys";
import { installLocalHotkeys } from "@/lib/localHotkeys";
import "@/styles.css";

initializeHotkeys();
installLocalHotkeys();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
