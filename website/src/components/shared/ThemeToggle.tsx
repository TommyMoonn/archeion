import { useEffect } from "react";
import { useColorMode } from "@docusaurus/theme-common";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { colorMode, setColorMode } = useColorMode();
  const label = colorMode === "dark" ? "Switch to light theme" : "Switch to dark theme";
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute(
      "content",
      getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
    );
  }, [colorMode]);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      onClick={() => {
        const root = document.documentElement;
        root.classList.add("theme-switching");
        setColorMode(colorMode === "dark" ? "light" : "dark");
        // Flush the new palette while all descendant transitions are suppressed.
        getComputedStyle(root).getPropertyValue("--surface");
        requestAnimationFrame(() =>
          requestAnimationFrame(() => root.classList.remove("theme-switching")),
        );
      }}
    >
      <Sun aria-hidden="true" className="hidden dark:block" />
      <Moon aria-hidden="true" className="block dark:hidden" />
    </Button>
  );
}
