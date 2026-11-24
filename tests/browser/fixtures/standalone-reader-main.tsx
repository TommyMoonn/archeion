import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { StandaloneReaderStartup } from "../../../src/app/StandaloneReaderStartup";
import { buildReaderFixture } from "../../fixtures/reader/readerFixtures";
import "../../../src/styles/index.css";

const malformed = new URLSearchParams(location.search).has("malformed");
const bytes = malformed ? new Uint8Array([1, 2, 3]) : await buildReaderFixture("short-cover");
mockWindows("external-reader-1");
Object.defineProperty(globalThis, "isTauri", { value: true, configurable: true });
mockIPC(
  (command) => {
    if (command === "standalone_reader_archive_match") return null;
    if (command === "standalone_reader_window_ready") return;
    if (command === "read_external_reader_epub") return bytes.buffer;
    if (command === "plugin:window|is_maximized" || command === "plugin:window|is_fullscreen")
      return false;
    if (command === "list_installed_font_families") return [];
    if (command === "close_standalone_reader_window") {
      document.documentElement.dataset.closedReader = "true";
      return;
    }
    throw new Error(`Unexpected standalone Reader IPC: ${command}`);
  },
  { shouldMockEvents: true },
);
const root = document.getElementById("root");
if (!root) throw new Error("Standalone Reader fixture root is missing.");
createRoot(root).render(
  <StandaloneReaderStartup
    request={{ token: "fixture-reader", fileName: "External 日本語.epub" }}
  />,
);
