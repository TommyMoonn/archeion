import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { AppWindowMode } from "./windowMode";

// AppWindow mounts after the appearance authority applies tokens. Optional
// feature imports and catalogs do not own the committed shell's reveal signal.
export function useManagedWindowShellReady(mode: AppWindowMode) {
  useEffect(() => {
    if (mode === "main") return;
    let active = true;
    let reported = false;
    let observer: MutationObserver | undefined;
    if (import.meta.env.DEV) {
      const checkContent = () => {
        if (!document.querySelector('[data-utility-ready="true"]')) return;
        performance.mark("archeion:utility:interactive-ready");
        observer?.disconnect();
      };
      observer = new MutationObserver(checkContent);
      observer.observe(document.getElementById("root") ?? document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-utility-ready"],
      });
      checkContent();
    }
    const report = () => {
      if (!active || reported) return;
      reported = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      if (import.meta.env.DEV) performance.mark("archeion:utility:shell-ready");
      const instance = new URLSearchParams(location.search).get("windowInstance");
      if (!isTauri() || !instance) return;
      void invoke("managed_window_shell_ready", { instance }).then(
        () => {
          if (active && import.meta.env.DEV) performance.mark("archeion:utility:native-reveal-ack");
        },
        (error: unknown) => console.error("Utility window could not be revealed", error),
      );
    };
    // Hidden WebView2 instances may suppress animation frames. This deadline
    // bounds scheduling, with the same already committed, themed DOM shell.
    const timer = setTimeout(report, 250);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(report);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [mode]);
}
