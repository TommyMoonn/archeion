import {
  defaultReaderSettings,
  type ReaderSettings,
} from "../types/reader";
import { db, type EpubArchiveDatabase } from "./db";

const READER_SETTINGS_KEY = "reader";

function copyDefaults(): ReaderSettings {
  return { ...defaultReaderSettings };
}

export function createSettingsRepository(database: EpubArchiveDatabase) {
  async function get(): Promise<ReaderSettings> {
    const record = await database.settings.get(READER_SETTINGS_KEY);

    return record
      ? { ...defaultReaderSettings, ...record.value }
      : copyDefaults();
  }

  async function save(settings: ReaderSettings): Promise<ReaderSettings> {
    const value = {
      ...defaultReaderSettings,
      ...settings,
    };

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
