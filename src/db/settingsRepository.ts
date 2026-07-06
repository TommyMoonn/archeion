import {
  normalizeReaderSettings,
  type ReaderSettings,
} from "../types/reader";
import { db, type ArcheionDatabase } from "./db";

const READER_SETTINGS_KEY = "reader";

function copyDefaults(): ReaderSettings {
  return normalizeReaderSettings();
}

export function createSettingsRepository(database: ArcheionDatabase) {
  async function get(): Promise<ReaderSettings> {
    const record = await database.settings.get(READER_SETTINGS_KEY);

    return record ? normalizeReaderSettings(record.value) : copyDefaults();
  }

  async function save(settings: ReaderSettings): Promise<ReaderSettings> {
    const value = normalizeReaderSettings(settings);

    await database.settings.put({
      key: READER_SETTINGS_KEY,
      value,
      updatedAt: new Date().toISOString(),
    });

    return value;
  }

  return {
    get,
    save,

    async update(changes: Partial<ReaderSettings>) {
      const currentSettings = await get();

      return save({
        ...currentSettings,
        ...changes,
      });
    },

    async reset() {
      await database.settings.delete(READER_SETTINGS_KEY);

      return copyDefaults();
    },
  };
}

export const settingsRepository = createSettingsRepository(db);
