import { createRoot } from "react-dom/client";

import { focusPresentationRuntime } from "../../../src/app/inputModality";
import { FontPickerFixture } from "./font-picker-view";
import "../../../src/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Font picker fixture root is missing.");
focusPresentationRuntime.start(document);
createRoot(root).render(<FontPickerFixture />);
