import { create } from 'zustand';

/** Progress of drag-and-drop file uploads into a terminal, shown in the status bar. */
interface DropUploadState {
  done: number;
  total: number;
  start: (total: number) => void;
  tick: () => void;
  clear: () => void;
}

export const useDropUpload = create<DropUploadState>((set) => ({
  done: 0,
  total: 0,
  start: (total) => set({ done: 0, total }),
  tick: () => set((s) => ({ done: s.done + 1 })),
  clear: () => set({ done: 0, total: 0 }),
}));
