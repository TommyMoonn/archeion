import { useEffect, useState } from "react";

import { TooltipProvider } from "../../../src/components/Tooltip";
import {
  ThemeManagerSurface,
  type ThemeManagerServices,
} from "../../../src/features/themes/ThemeManagerSurface";
import { AppearanceRuntime } from "../../../src/themes/AppearanceRuntime";
import { ThemeCatalog } from "../../../src/themes/ThemeCatalog";
import { ThemePreviewSession } from "../../../src/themes/ThemePreviewSession";
import { defaultAppPreferences } from "../../../src/types/appSettings";
import { shellStressThemes } from "../../fixtures/themes/shellStressThemes";

function createFixtureServices(search: URLSearchParams) {
  const packages = new Map<string, string>(
    Object.values(shellStressThemes).map((manifest) => [manifest.id, JSON.stringify(manifest)]),
  );
  packages.set(
    "unreadable-shell",
    JSON.stringify({
      ...shellStressThemes.equal,
      id: "unreadable-shell",
      name: "Unreadable navigation",
      app: { sidebar: "#ffffff", text: "#ffffff" },
    }),
  );
  packages.set(
    "invalid-shell",
    JSON.stringify({ ...shellStressThemes.equal, id: "invalid-shell", schemaVersion: 2 }),
  );
  if (search.get("catalog") === "large") {
    for (let index = 0; index < 200; index += 1) {
      const id = `gallery-${String(index).padStart(3, "0")}`;
      packages.set(
        id,
        JSON.stringify({
          ...(index % 2 ? shellStressThemes.distinct : shellStressThemes.equal),
          id,
          name: `Gallery theme ${String(index).padStart(3, "0")}`,
        }),
      );
    }
  }
  const catalog = new ThemeCatalog(() => ({
    listPackageDirectories: async () => [...packages.keys(), "unavailable-shell"],
    readManifest: async (id) => {
      const source = packages.get(id);
      if (!source) throw new Error("Fixture theme is unavailable.");
      return source;
    },
  }));
  let settings = { ...defaultAppPreferences };
  const listeners = new Set<() => void>();
  const runtime = new AppearanceRuntime({
    catalog,
    globalPreferences: {
      getSnapshot: () => settings,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      update: async (changes) => {
        if (search.has("failSave"))
          throw new Error("Fixture theme preferences could not be saved.");
        settings = { ...settings, ...changes };
        listeners.forEach((listener) => listener());
        return settings;
      },
    },
  });
  let revision = 0;
  const services: ThemeManagerServices = {
    catalog,
    runtime,
    previewSession: new ThemePreviewSession(runtime),
    repository: {
      deletePackage: async (id) => {
        packages.delete(id);
        return { revision: ++revision };
      },
      revealThemesRoot: async () => {
        if (!search.has("holdFolderReveal")) return;
        await new Promise<void>((resolve) => {
          window.addEventListener("release-theme-folder", () => resolve(), { once: true });
        });
      },
      storeManifest: async (manifest) => {
        packages.set(manifest.id, JSON.stringify(manifest));
        return { revision: ++revision };
      },
      replaceManifest: async (manifest) => {
        packages.set(manifest.id, JSON.stringify(manifest));
        return { revision: ++revision };
      },
    },
  };
  return { runtime, services };
}

export function ThemeManagerFixture() {
  const [fixture] = useState(() => createFixtureServices(new URLSearchParams(location.search)));
  useEffect(() => fixture.runtime.start(), [fixture]);
  return (
    <TooltipProvider>
      <main className="flex h-dvh w-full min-h-0 min-w-0">
        <ThemeManagerSurface services={fixture.services} />
      </main>
    </TooltipProvider>
  );
}
