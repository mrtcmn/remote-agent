import Store from 'electron-store';

export interface StoreSchema {
  apiUrl: string;
  windowBounds: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
}

// Cast to any to work around ESM/CJS type resolution limitations with electron-store v10
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RawStore = Store as any;

export const store: {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
} = new RawStore({
  schema: {
    apiUrl: {
      type: 'string',
      default: '',
    },
    windowBounds: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', default: 1200 },
        height: { type: 'number', default: 800 },
      },
      default: { width: 1200, height: 800 },
    },
  },
});
