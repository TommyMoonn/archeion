import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";

import packageMetadata from "../../package.json";

export const APPLICATION_VERSION_FALLBACK = packageMetadata.version;

export async function resolveApplicationVersion(): Promise<string> {
  if (!isTauri()) return APPLICATION_VERSION_FALLBACK;

  try {
    return await getVersion();
  } catch {
    return APPLICATION_VERSION_FALLBACK;
  }
}
