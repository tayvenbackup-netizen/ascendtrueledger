import { createRoot } from "react-dom/client";
import GateRoot from "./GateRoot.tsx";
import "./index.css";
import { installDevtoolsShield } from "./lib/shield";

// Install client-side hardening as early as possible
try { installDevtoolsShield(); } catch {}

let rootEl = document.getElementById("root");
if (!rootEl) {
  rootEl = document.createElement("div");
  rootEl.id = "root";
  document.body.appendChild(rootEl);
}

let appGate = document.getElementById("app-gate");
if (!appGate) {
  appGate = document.createElement("div");
  appGate.id = "app-gate";
  rootEl.appendChild(appGate);
}

if (!document.getElementById("protected-root")) {
  const protectedRoot = document.createElement("div");
  protectedRoot.id = "protected-root";
  rootEl.appendChild(protectedRoot);
}

createRoot(appGate).render(<GateRoot />);
