export interface StoreSchema {
  mode: 'local' | 'remote';
  apiUrl: string;
  windowBounds: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
}

type StoreInstance = {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
};

let _store: StoreInstance | null = null;

export async function getStore(): Promise<StoreInstance> {
  if (_store) return _store;

  // Use Function to prevent tsc from transforming dynamic import() into require()
  // electron-store v10 is native ESM only
  const { default: Store } = await (new Function('return import("electron-store")')() as Promise<any>);

  const instance: StoreInstance = new Store({
    schema: {
      mode: {
        type: 'string',
        enum: ['local', 'remote'],
        default: 'local',
      },
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

  _store = instance;
  return instance;
}
