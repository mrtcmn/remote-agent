import Store from 'electron-store';

interface StoreSchema {
  apiUrl: string;
  windowBounds: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
}

export const store = new Store<StoreSchema>({
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
