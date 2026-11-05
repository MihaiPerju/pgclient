import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { demoGateway } from "./demoGateway";
import "./app.css";
import { tauriGateway } from "./tauriGateway";
import { ThemeProvider } from "./theme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App gateway={"__TAURI_INTERNALS__" in window ? tauriGateway : demoGateway} />
    </ThemeProvider>
  </StrictMode>,
);
