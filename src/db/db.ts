import Dexie, { type Table } from "dexie";

import type { Book } from "../types/book";
import type { Folder } from "../types/folder";
import type { ReaderSettings } from "../types/reader";
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  databaseStores,
} from "./schema";

export type SettingRecord = {
  key: string;
  value: ReaderSettings;
  updatedAt: string;
};

export class EpubArchiveDatabase extends Dexie {
  books!: Table<Book, string>;
  folders!: Table<Folder, string>;
  settings!: Table<SettingRecord, string>;

  constructor(name = DATABASE_NAME) {
    super(name);

    this.version(DATABASE_VERSION).stores(databaseStores);
  }
}

export const db = new EpubArchiveDatabase();
