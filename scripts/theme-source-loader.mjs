import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

// The generator uses the production resolver, whose web imports omit TS extensions.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts")) {
    return {
      format: "module",
      source: stripTypeScriptTypes(await readFile(new URL(url), "utf8")),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
