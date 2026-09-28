import { createRoot } from "react-dom/client";

import { BrowserFixture } from "./views";
import "../../../src/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Browser fixture root is missing.");
createRoot(root).render(<BrowserFixture />);
