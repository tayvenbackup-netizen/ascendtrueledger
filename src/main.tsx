import { createRoot } from "react-dom/client";
import GateRoot from "./GateRoot.tsx";
import "./index.css";
import { installDevtoolsShield } from "./lib/shield";

// Install client-side hardening as early as possible
try { installDevtoolsShield(); } catch {}

const mountId = "app-gate";
let el = document.getElementById(mountId);
if (!el) {
  el = document.createElement("div");
  el.id = mountId;
  document.body.appendChild(el);
}
createRoot(el).render(<GateRoot />);
