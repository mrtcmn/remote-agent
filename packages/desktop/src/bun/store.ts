import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StoreSchema {
  mode: "local" | "remote";
  apiUrl: string;
  windowBounds: { x?: number; y?: number; width: number; height: number };
}

const DEFAULTS: StoreSchema = {
  mode: "local",
  apiUrl: "",
  windowBounds: { width: 1200, height: 800 },
};

export interface Store {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
}

/**
 * JSON-file-backed settings store (electron-store replacement).
 * Mirrors the schema + defaults of packages/electron/src/store.ts.
 * `dir` is Utils.paths.userData in production; a temp dir in tests.
 */
export function createStore(dir: string): Store {
  const file = join(dir, "settings.json");
  let data: StoreSchema = { ...DEFAULTS };

  if (existsSync(file)) {
    try {
      data = { ...DEFAULTS, ...JSON.parse(readFileSync(file, "utf-8")) };
    } catch {
      // Corrupt file -> fall back to defaults (matches electron-store leniency).
    }
  }

  const persist = () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
  };

  return {
    get: (key) => data[key],
    set: (key, value) => {
      data[key] = value;
      persist();
    },
  };
}
