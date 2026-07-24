import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const COMMAND_MODULES = ["appCommands", "commandBindings", "commandResolver"] as const;

function source(name: (typeof COMMAND_MODULES)[number]): string {
  return readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
}

function commandDomainDependencies(
  name: (typeof COMMAND_MODULES)[number],
): readonly (typeof COMMAND_MODULES)[number][] {
  const imports = source(name).matchAll(/from\s+["']\.\/([^"']+)["']/g);
  return [...imports]
    .map((match) => match[1])
    .filter((dependency): dependency is (typeof COMMAND_MODULES)[number] =>
      COMMAND_MODULES.includes(dependency as (typeof COMMAND_MODULES)[number]),
    ) as readonly (typeof COMMAND_MODULES)[number][];
}

describe("application command architecture", () => {
  it("keeps command types and resolution independent from Quick Actions search", () => {
    for (const moduleName of COMMAND_MODULES) {
      const imports = [...source(moduleName).matchAll(/from\s+["']([^"']+)["']/g)].map(
        (match) => match[1],
      );
      expect(imports).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/quick-actions|quickActions/i)]),
      );
    }

    const quickActionsSource = readFileSync(
      new URL("../quick-actions/quickActions.ts", import.meta.url),
      "utf8",
    );
    expect(quickActionsSource).toContain('from "../commands/appCommands"');
    expect(quickActionsSource).toContain("type QuickActionRegistration");
    expect(quickActionsSource).toContain("keywords?: readonly string[]");
  });

  it("contains no cycle within the command-domain module graph", () => {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (moduleName: (typeof COMMAND_MODULES)[number]): void => {
      expect(visiting.has(moduleName), `cycle reached through ${moduleName}`).toBe(false);
      if (visited.has(moduleName)) return;

      visiting.add(moduleName);
      for (const dependency of commandDomainDependencies(moduleName)) {
        visit(dependency);
      }
      visiting.delete(moduleName);
      visited.add(moduleName);
    };

    for (const moduleName of COMMAND_MODULES) visit(moduleName);
    expect(visited).toEqual(new Set(COMMAND_MODULES));
  });
});
